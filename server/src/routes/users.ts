import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { HttpError } from "../lib/errors.js";

const USER_COLUMNS = "id, username, full_name, role, is_active, created_at";

const passwordSchema = z.string().min(8, "must be at least 8 characters").max(100);

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, "Username must be 3-30 characters: lowercase letters, numbers, dot, dash or underscore"),
  password: passwordSchema,
  full_name: z.string().trim().min(1).max(100),
  role: z.enum(["admin", "staff"]).default("staff"),
});

const updateSchema = z.object({
  full_name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "staff"]).optional(),
  is_active: z.boolean().optional(),
  password: passwordSchema.optional(),
});

/** Mounted behind requireAuth + requireAdmin. */
export function userRoutes(db: Db): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY is_active DESC, full_name`);
    res.json({ items: rows });
  });

  router.post("/", async (req, res) => {
    const input = createSchema.parse(req.body);
    const taken = await db.query("SELECT 1 FROM users WHERE username = $1", [input.username]);
    if (taken.rowCount) throw new HttpError(409, "That username is already taken");
    const hash = await bcrypt.hash(input.password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
      [input.username, hash, input.full_name, input.role],
    );
    res.status(201).json(rows[0]);
  });

  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const input = updateSchema.parse(req.body);
    // Stops the only admin from locking everyone out by accident.
    if (id === req.user!.id && (input.is_active === false || input.role === "staff")) {
      throw new HttpError(400, "You cannot deactivate or demote your own account");
    }
    const hash = input.password ? await bcrypt.hash(input.password, 10) : null;
    const { rows } = await db.query(
      `UPDATE users SET
         full_name     = COALESCE($2, full_name),
         role          = COALESCE($3, role),
         is_active     = COALESCE($4, is_active),
         password_hash = COALESCE($5, password_hash)
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, input.full_name ?? null, input.role ?? null, input.is_active ?? null, hash],
    );
    if (!rows[0]) throw new HttpError(404, "User not found");
    res.json(rows[0]);
  });

  return router;
}
