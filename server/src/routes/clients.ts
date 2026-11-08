import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import type { ClientFiles } from "../lib/clientFiles.js";
import { HttpError } from "../lib/errors.js";
import { optionalMobile } from "../lib/mobile.js";
import { likePattern, optionalText, parsePaging } from "../lib/paging.js";

const COLUMNS =
  "id, name, phone, email, address, city, pan, gstin, referred_by, file_no, group_id, (SELECT g.name FROM client_groups g WHERE g.id = clients.group_id) AS group_name, folder_name, is_deleted, created_at, updated_at";

const clientSchema = z.object({
  name: z.string().trim().min(1, "is required").max(150),
  /** The client's mobile number: 10 digits (a leading +91 or 0 is removed). Stored in the "phone" column. */
  phone: optionalMobile(),
  email: optionalText(150).refine((v) => v === null || /^\S+@\S+\.\S+$/.test(v), "is not valid, for example name@example.com"),
  address: optionalText(300),
  city: optionalText(100),
  pan: optionalText(10).transform((v) => v?.toUpperCase() ?? null),
  gstin: optionalText(15).transform((v) => v?.toUpperCase() ?? null),
  referred_by: optionalText(150),
  /** The firm's file reference for this client, printed on bills as "File No.". */
  file_no: optionalText(50),
  /** The group (e.g. family) this client belongs to, or null for none. Left out: no group. */
  group_id: z.number().int().positive().nullish(),
});

async function assertGroupExists(db: Db, groupId: number | null | undefined) {
  if (groupId == null) return;
  if (!(await db.query("SELECT 1 FROM client_groups WHERE id = $1", [groupId])).rowCount) throw new HttpError(400, "That group does not exist");
}

export function clientRoutes(db: Db, files: ClientFiles): Router {
  const router = Router();

  // Updates the client's folder on disk, then returns the client as stored (including the folder name).
  const refreshed = async (id: number) => {
    await files.syncClient(id);
    return (await db.query(`SELECT ${COLUMNS} FROM clients WHERE id = $1`, [id])).rows[0];
  };

  router.get("/", async (req, res) => {
    const { page, limit, offset } = parsePaging(req.query);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const includeDeleted = req.query.include_deleted === "true";
    const groupId = req.query.group_id ? Number(req.query.group_id) : null;
    if (groupId !== null && !Number.isInteger(groupId)) throw new HttpError(400, "group_id must be a number");
    const params = [q ? likePattern(q) : null, includeDeleted, groupId];
    const where =
      "($1::text IS NULL OR name ILIKE $1 OR phone ILIKE $1 OR referred_by ILIKE $1 OR file_no ILIKE $1) AND ($2::boolean OR NOT is_deleted) AND ($3::int IS NULL OR group_id = $3::int)";
    const total = await db.query<{ n: number }>(`SELECT count(*) AS n FROM clients WHERE ${where}`, params);
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM clients WHERE ${where} ORDER BY lower(name), id LIMIT $4 OFFSET $5`,
      [...params, limit, offset],
    );
    res.json({ items: rows, total: total.rows[0].n, page, limit });
  });

  router.get("/:id", async (req, res) => {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM clients WHERE id = $1`, [Number(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, "Client not found");
    res.json(rows[0]);
  });

  router.post("/", async (req, res) => {
    const c = clientSchema.parse(req.body);
    await assertGroupExists(db, c.group_id);
    const { rows } = await db.query(
      `INSERT INTO clients (name, phone, email, address, city, pan, gstin, referred_by, file_no, group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUMNS}`,
      [c.name, c.phone, c.email, c.address, c.city, c.pan, c.gstin, c.referred_by, c.file_no, c.group_id ?? null],
    );
    res.status(201).json(await refreshed(rows[0].id));
  });

  router.put("/:id", async (req, res) => {
    const c = clientSchema.parse(req.body);
    await assertGroupExists(db, c.group_id);
    const { rows } = await db.query(
      `UPDATE clients SET name = $2, phone = $3, email = $4, address = $5, city = $6,
              pan = $7, gstin = $8, referred_by = $9, file_no = $10, group_id = $11, updated_at = now()
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [Number(req.params.id), c.name, c.phone, c.email, c.address, c.city, c.pan, c.gstin, c.referred_by, c.file_no, c.group_id ?? null],
    );
    if (!rows[0]) throw new HttpError(404, "Client not found");
    res.json(await refreshed(rows[0].id));
  });

  // Soft delete: the row stays so old bills still point at a real client.
  router.delete("/:id", async (req, res) => {
    const { rowCount } = await db.query("UPDATE clients SET is_deleted = TRUE, updated_at = now() WHERE id = $1", [
      Number(req.params.id),
    ]);
    if (!rowCount) throw new HttpError(404, "Client not found");
    await files.syncClient(Number(req.params.id)); // the folder stays; its details file now says "DELETED"
    res.status(204).end();
  });

  router.post("/:id/restore", async (req, res) => {
    const { rows } = await db.query(
      `UPDATE clients SET is_deleted = FALSE, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      [Number(req.params.id)],
    );
    if (!rows[0]) throw new HttpError(404, "Client not found");
    res.json(await refreshed(rows[0].id));
  });

  return router;
}
