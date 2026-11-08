import crypto from "node:crypto";
import os from "node:os";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { HttpError } from "./errors.js";
import { loadMailSettings, mailConfigured, type Mailer } from "./mailer.js";

/**
 * "Forgot password" for administrators: a one-time link, valid for 30 minutes, sent to the admin's email address.
 *
 * - Only a SHA-256 hash of the token is stored; the token itself exists only in the email.
 * - The reply is the same whether or not the account exists, so the page can't be used to find usernames.
 * - The link starts with the address set under Settings → Email (or this computer's own name), never with an
 *   address taken from the request, which an attacker could fake to make the email point at their own site.
 * - Using a link changes the password, uses up every outstanding link for that account, and ends its other sessions.
 * Staff accounts are reset by an admin (Staff → Reset password), as before.
 */

export const RESET_MINUTES = 30;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** The address used in links: the configured one, or this computer's name and the server's port. */
export async function appBaseUrl(db: Db): Promise<string> {
  const s = await loadMailSettings(db);
  return (s.appUrl || `http://${os.hostname()}:${config.port}`).replace(/\/$/, "");
}

/** Starts a reset for an admin found by username or email. Resolves quietly when there is nothing to send. */
export async function requestReset(db: Db, mailer: Mailer, login: string): Promise<void> {
  const key = login.trim().toLowerCase();
  const user = (
    await db.query<{ id: number; full_name: string; username: string; email: string | null }>(
      `SELECT id, full_name, username, email FROM users
       WHERE is_active AND role = 'admin' AND email IS NOT NULL AND (username = $1 OR lower(email) = $1)
       ORDER BY id LIMIT 1`,
      [key],
    )
  ).rows[0];
  if (!user?.email) return;
  if (!mailConfigured(await loadMailSettings(db))) return;

  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [user.id, hash(token), RESET_MINUTES],
  );
  const link = `${await appBaseUrl(db)}/reset-password?token=${token}`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  await mailer.send({
    to: user.email,
    subject: "Reset your Billing Software password",
    text:
      `Hello ${user.full_name},\n\nSomeone (hopefully you) asked to reset the password for the Billing Software account "${user.username}".\n\n` +
      `Open this link to choose a new password. It works once, for ${RESET_MINUTES} minutes:\n${link}\n\n` +
      `If you did not ask for this, ignore this email: your password stays as it is.`,
    html:
      `<p>Hello ${esc(user.full_name)},</p><p>Someone (hopefully you) asked to reset the password for the Billing Software account <strong>${esc(user.username)}</strong>.</p>` +
      `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#0071e3;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Choose a new password</a></p>` +
      `<p>The link works once, for ${RESET_MINUTES} minutes. If the button does not work, copy this address into your browser:<br>${esc(link)}</p>` +
      `<p style="color:#6e6e73">If you did not ask for this, ignore this email: your password stays as it is.</p>`,
  });
}

/** Sets a new password from a reset link. Throws a clear error when the link is wrong, used or expired. */
export async function completeReset(db: Db, token: string, password: string): Promise<{ username: string }> {
  return db.tx(async (q) => {
    const row = (
      await q.query<{ id: number; user_id: number; used: boolean; expired: boolean; username: string; is_active: boolean }>(
        `SELECT r.id, r.user_id, r.used_at IS NOT NULL AS used, r.expires_at < now() AS expired, u.username, u.is_active
         FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = $1 FOR UPDATE OF r`,
        [hash(token)],
      )
    ).rows[0];
    if (!row || !row.is_active) throw new HttpError(400, "This reset link is not valid. Ask for a new one.");
    if (row.used) throw new HttpError(400, "This reset link has already been used. Ask for a new one if you still need it.");
    if (row.expired) throw new HttpError(400, `This reset link has expired (links work for ${RESET_MINUTES} minutes). Ask for a new one.`);
    await q.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [row.user_id, await bcrypt.hash(password, 10)]);
    await q.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [row.user_id]);
    return { username: row.username };
  });
}
