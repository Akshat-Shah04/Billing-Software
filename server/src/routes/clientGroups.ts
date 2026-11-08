import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { HttpError } from "../lib/errors.js";
import { optionalText } from "../lib/paging.js";

const groupSchema = z.object({
  name: z.string().trim().min(1, "is required").max(100),
  notes: optionalText(300),
});

const COLUMNS = `g.id, g.name, g.notes, g.created_at,
  (SELECT count(*) FROM clients c WHERE c.group_id = g.id AND NOT c.is_deleted)::int AS member_count`;

/**
 * Mounted at /api/client-groups. A group is a set of related clients handled together, e.g. a family: each member
 * stays a separate client with their own bills, and the group gives a combined ledger and fees report.
 */
export function clientGroupRoutes(db: Db): Router {
  const router = Router();

  const one = async (id: number) => (await db.query(`SELECT ${COLUMNS} FROM client_groups g WHERE g.id = $1`, [id])).rows[0];
  const assertNameFree = async (name: string, exceptId: number | null) => {
    const { rowCount } = await db.query("SELECT 1 FROM client_groups WHERE lower(name) = lower($1) AND ($2::int IS NULL OR id <> $2)", [name, exceptId]);
    if (rowCount) throw new HttpError(409, `There is already a group called "${name}"`);
  };

  router.get("/", async (_req, res) => {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM client_groups g ORDER BY lower(g.name)`);
    res.json({ items: rows });
  });

  // A group with its members (deleted clients included, marked), for the group's page and ledger.
  router.get("/:id", async (req, res) => {
    const group = await one(Number(req.params.id));
    if (!group) throw new HttpError(404, "Group not found");
    const members = (
      await db.query("SELECT id, name, phone, city, pan, is_deleted FROM clients WHERE group_id = $1 ORDER BY is_deleted, lower(name)", [group.id])
    ).rows;
    res.json({ ...group, members });
  });

  router.post("/", async (req, res) => {
    const g = groupSchema.parse(req.body);
    await assertNameFree(g.name, null);
    const { rows } = await db.query<{ id: number }>("INSERT INTO client_groups (name, notes) VALUES ($1, $2) RETURNING id", [g.name, g.notes]);
    res.status(201).json(await one(rows[0].id));
  });

  router.put("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const g = groupSchema.parse(req.body);
    await assertNameFree(g.name, id);
    const { rowCount } = await db.query("UPDATE client_groups SET name = $2, notes = $3 WHERE id = $1", [id, g.name, g.notes]);
    if (!rowCount) throw new HttpError(404, "Group not found");
    res.json(await one(id));
  });

  // Deleting a group only removes the grouping: its clients and their bills stay exactly as they are.
  router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    await db.tx(async (q) => {
      await q.query("UPDATE clients SET group_id = NULL WHERE group_id = $1", [id]);
      const { rowCount } = await q.query("DELETE FROM client_groups WHERE id = $1", [id]);
      if (!rowCount) throw new HttpError(404, "Group not found");
    });
    res.status(204).end();
  });

  return router;
}
