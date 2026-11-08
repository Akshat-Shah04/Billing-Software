import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { HttpError } from "../lib/errors.js";

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: "admin" | "staff";
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: String(user.id) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/**
 * Checks the Bearer token, then loads the user from the database on every
 * request. That way a deactivated or demoted user loses access immediately,
 * instead of keeping it until their token expires.
 */
export function requireAuth(db: Db): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Please log in");
    let userId: number;
    let issuedAt: number;
    try {
      const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
      userId = Number(payload.sub);
      issuedAt = Number(payload.iat ?? 0);
    } catch {
      throw new HttpError(401, "Session expired, please log in again");
    }
    const { rows } = await db.query<AuthUser & { is_active: boolean; password_changed_at: Date | string | null }>(
      "SELECT id, username, full_name, role, is_active, password_changed_at FROM users WHERE id = $1",
      [userId],
    );
    const user = rows[0];
    if (!user || !user.is_active) throw new HttpError(401, "Account is not active");
    // A password change (reset link, or an admin resetting it) ends sessions that started before it.
    if (user.password_changed_at && issuedAt < Math.floor(new Date(user.password_changed_at).getTime() / 1000)) {
      throw new HttpError(401, "Your password was changed. Please log in again.");
    }
    req.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    next();
  };
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "admin") throw new HttpError(403, "Admin access required");
  next();
};
