import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { HttpError } from "../lib/errors.js";
import { optionalText } from "../lib/paging.js";

const COLUMNS = "id, name, description, price_paise, is_active, created_at, updated_at";

const serviceSchema = z.object({
  name: z.string().trim().min(1, "is required").max(150),
  description: optionalText(500),
  price_paise: z.number().int().min(0).max(100_000_000_000),
  is_active: z.boolean().default(true),
});

export function serviceRoutes(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const includeInactive = req.query.include_inactive === "true";
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM services WHERE ($1::boolean OR is_active) ORDER BY is_active DESC, lower(name)`,
      [includeInactive],
    );
    res.json({ items: rows });
  });

  router.post("/", async (req, res) => {
    const s = serviceSchema.parse(req.body);
    const { rows } = await db.query(
      `INSERT INTO services (name, description, price_paise, is_active) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [s.name, s.description, s.price_paise, s.is_active],
    );
    res.status(201).json(rows[0]);
  });

  router.put("/:id", async (req, res) => {
    const s = serviceSchema.parse(req.body);
    const { rows } = await db.query(
      `UPDATE services SET name = $2, description = $3, price_paise = $4, is_active = $5, updated_at = now()
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [Number(req.params.id), s.name, s.description, s.price_paise, s.is_active],
    );
    if (!rows[0]) throw new HttpError(404, "Service not found");
    res.json(rows[0]);
  });

  return router;
}
