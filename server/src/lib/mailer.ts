import nodemailer from "nodemailer";
import type { Db, Queryable } from "../db/index.js";
import { HttpError } from "./errors.js";

/**
 * Sends email through the firm's own mail server (SMTP), set up by an admin under Settings → Email.
 * Used for password reset links. Works with Gmail (smtp.gmail.com, port 587, an "app password"), Outlook / Microsoft
 * 365 (smtp.office365.com, 587), Zoho, or any provider that gives SMTP details.
 */

export interface MailSettings {
  host: string;
  port: number;
  /** true = SSL from the start (usually port 465); false = upgrade with STARTTLS (usually port 587). */
  secure: boolean;
  user: string;
  password: string;
  from: string;
  /** The address staff type to open the software, e.g. http://OFFICE-PC:4000. Used in links inside emails. */
  appUrl: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

const KEYS = ["smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_password", "smtp_from", "app_url"] as const;

export async function loadMailSettings(q: Queryable): Promise<MailSettings> {
  const { rows } = await q.query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key = ANY($1::text[])", [KEYS]);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    host: m.smtp_host ?? "",
    port: Number(m.smtp_port || 587),
    secure: m.smtp_secure === "true",
    user: m.smtp_user ?? "",
    password: m.smtp_password ?? "",
    from: m.smtp_from ?? "",
    appUrl: m.app_url ?? "",
  };
}

export const mailConfigured = (s: MailSettings) => Boolean(s.host && s.from);

/** The real mailer: reads the settings each time, so a change in Settings applies at once. */
export function createSmtpMailer(db: Db): Mailer {
  return {
    async send(mail) {
      const s = await loadMailSettings(db);
      if (!mailConfigured(s)) throw new HttpError(409, "Email is not set up. An admin can add the mail server under Settings → Email.");
      const transport = nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: s.user ? { user: s.user, pass: s.password } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 20_000,
      });
      await transport.sendMail({ from: s.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}
