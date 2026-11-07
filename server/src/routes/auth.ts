import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { HttpError } from "../lib/errors.js";
import { requireAuth, signToken, type AuthUser } from "../middleware/auth.js";

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

// Compared against when the username does not exist, so a wrong username takes
// as long to reject as a wrong password (prevents guessing which users exist).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

// Very small in-memory brute-force guard: 10 failed attempts per username+IP
// per 15 minutes. Good enough for one server; use a shared store if you scale out.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

function tooManyFailures(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else entry.count++;
}

export function authRoutes(db: Db): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const name = username.toLowerCase();
    const key = `${req.ip}|${name}`;
    if (tooManyFailures(key)) throw new HttpError(429, "Too many failed attempts. Try again in a few minutes.");

    const { rows } = await db.query<AuthUser & { password_hash: string; is_active: boolean }>(
      "SELECT id, username, full_name, role, password_hash, is_active FROM users WHERE username = $1",
      [name],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) {
      recordFailure(key);
      throw new HttpError(401, "Incorrect username or password");
    }
    failures.delete(key);
    const authUser: AuthUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    res.json({ token: signToken(authUser), user: authUser });
  });

  router.get("/me", requireAuth(db), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
