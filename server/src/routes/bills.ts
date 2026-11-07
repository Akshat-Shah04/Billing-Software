import { Router } from "express";
import { z } from "zod";
import type { Db, Queryable } from "../db/index.js";
import type { ClientFiles } from "../lib/clientFiles.js";
import { HttpError } from "../lib/errors.js";
import { calculateTotals } from "../lib/money.js";
import { likePattern, optionalText, parsePaging } from "../lib/paging.js";
import { loadSettings } from "./settings.js";

const itemSchema = z.object({
  service_id: z.number().int().positive().nullish(),
  description: z.string().trim().min(1, "is required").max(300),
  details: optionalText(500),
  quantity: z.number().int().min(1).max(100_000),
  unit_price_paise: z.number().int().min(0).max(100_000_000_000),
});

const billSchema = z.object({
  client_id: z.number().int().positive(),
  bill_date: z.iso.date().nullish(),
  notes: optionalText(1000),
  items: z.array(itemSchema).min(1, "Add at least one item to the bill").max(100, "A bill can have at most 100 items"),
});

// Quantity times price can multiply to more than the system can add up exactly (a quantity of 100,000 at the
// largest price is 10 quadrillion paise). No real bill comes anywhere near this, so refuse it with a clear message.
const MAX_SUBTOTAL_PAISE = 1_000_000_000_000; // 100 crore rupees
function assertReasonableTotal(items: { quantity: number; unit_price_paise: number }[]) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price_paise, 0);
  if (subtotal > MAX_SUBTOTAL_PAISE) {
    throw new HttpError(400, "The bill total is too large: the items add up to more than ₹100 crore. Check the quantities and prices.");
  }
}

type BillInput = z.infer<typeof billSchema>;

// Indian financial year: 1 April to 31 March. Bills dated Jan-Mar belong to the FY that started the year before.
// fy_start 2026 means FY 2026-27 (1 Apr 2026 to 31 Mar 2027).
export const FY_START_SQL = `(EXTRACT(YEAR FROM b.bill_date)::int - CASE WHEN EXTRACT(MONTH FROM b.bill_date) < 4 THEN 1 ELSE 0 END)`;

const LIST_SQL = `
  SELECT b.id, b.bill_no, b.bill_date::text AS bill_date, ${FY_START_SQL} AS fy_start, b.total_paise,
         b.client_id, c.name AS client_name, c.phone AS client_phone,
         c.city AS client_city, c.is_deleted AS client_deleted
  FROM bills b JOIN clients c ON c.id = b.client_id`;

export async function getBill(q: Queryable, id: number) {
  const bill = (
    await q.query(
      `SELECT b.id, b.bill_no, b.bill_date::text AS bill_date, ${FY_START_SQL} AS fy_start, b.notes,
              b.subtotal_paise, b.gst_rate_percent, b.gst_paise, b.total_paise,
              b.client_id, c.name AS client_name, c.phone AS client_phone, c.city AS client_city,
              c.address AS client_address, c.gstin AS client_gstin, c.pan AS client_pan,
              b.created_at, b.updated_at,
              cu.full_name AS created_by_name, uu.full_name AS updated_by_name
       FROM bills b
       JOIN clients c ON c.id = b.client_id
       JOIN users cu ON cu.id = b.created_by
       LEFT JOIN users uu ON uu.id = b.updated_by
       WHERE b.id = $1`,
      [id],
    )
  ).rows[0];
  if (!bill) return null;
  const items = (
    await q.query(
      `SELECT id, service_id, description, details, quantity, unit_price_paise, line_total_paise
       FROM bill_items WHERE bill_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;
  return { ...bill, items };
}

async function assertClientUsable(q: Queryable, clientId: number) {
  const { rows } = await q.query<{ is_deleted: boolean }>("SELECT is_deleted FROM clients WHERE id = $1", [clientId]);
  if (!rows[0]) throw new HttpError(400, "client_id: that client does not exist");
  if (rows[0].is_deleted) throw new HttpError(400, "client_id: that client has been deleted");
}

async function assertServicesExist(q: Queryable, input: BillInput) {
  const ids = [...new Set(input.items.map((i) => i.service_id).filter((v): v is number => !!v))];
  if (!ids.length) return;
  const { rows } = await q.query<{ id: number }>("SELECT id FROM services WHERE id = ANY($1::int[])", [ids]);
  if (rows.length !== ids.length) throw new HttpError(400, "items: one of the services does not exist");
}

async function insertItems(q: Queryable, billId: number, input: BillInput) {
  for (const i of input.items) {
    await q.query(
      `INSERT INTO bill_items (bill_id, service_id, description, details, quantity, unit_price_paise, line_total_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [billId, i.service_id ?? null, i.description, i.details, i.quantity, i.unit_price_paise, i.quantity * i.unit_price_paise],
    );
  }
}

export function billRoutes(db: Db, files: ClientFiles): Router {
  const router = Router();

  // The financial years that have bills (newest first), always including the current one, for the dropdown.
  router.get("/financial-years", async (_req, res) => {
    const { rows } = await db.query<{ fy_start: number }>(
      `SELECT DISTINCT ${FY_START_SQL} AS fy_start FROM bills b ORDER BY fy_start DESC`,
    );
    const now = new Date();
    const current = now.getFullYear() - (now.getMonth() < 3 ? 1 : 0); // getMonth() is 0-based: 3 = April
    const years = new Set([current, ...rows.map((r) => r.fy_start)]);
    res.json({
      items: [...years]
        .sort((a, b) => b - a)
        .map((fy_start) => ({ fy_start, label: `${fy_start}-${String(fy_start + 1).slice(2)}` })),
    });
  });

  // Search: ?q=<client name or bill number>&client_id=&fy=<start year, e.g. 2026 for 2026-27>&page=&limit=
  // Newest first.
  router.get("/", async (req, res) => {
    const { page, limit, offset } = parsePaging(req.query);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const clientId = req.query.client_id ? Number(req.query.client_id) : null;
    if (clientId !== null && !Number.isInteger(clientId)) throw new HttpError(400, "client_id must be a number");
    const fy = req.query.fy ? Number(req.query.fy) : null;
    if (fy !== null && (!Number.isInteger(fy) || fy < 1990 || fy > 2200)) throw new HttpError(400, "fy must be a year like 2026");
    const params = [q ? likePattern(q) : null, clientId, fy];
    const where = `WHERE ($1::text IS NULL OR c.name ILIKE $1 OR b.bill_no ILIKE $1)
      AND ($2::int IS NULL OR b.client_id = $2)
      AND ($3::int IS NULL OR (b.bill_date >= make_date($3::int, 4, 1) AND b.bill_date < make_date($3::int + 1, 4, 1)))`;
    const total = await db.query<{ n: number }>(
      `SELECT count(*) AS n FROM bills b JOIN clients c ON c.id = b.client_id ${where}`,
      params,
    );
    const { rows } = await db.query(
      `${LIST_SQL} ${where} ORDER BY b.bill_date DESC, b.id DESC LIMIT $4 OFFSET $5`,
      [...params, limit, offset],
    );
    res.json({ items: rows, total: total.rows[0].n, page, limit });
  });

  router.get("/:id", async (req, res) => {
    const bill = await getBill(db, Number(req.params.id));
    if (!bill) throw new HttpError(404, "Bill not found");
    res.json(bill);
  });

  router.post("/", async (req, res) => {
    const input = billSchema.parse(req.body);
    assertReasonableTotal(input.items);
    const id = await db.tx(async (q) => {
      await assertClientUsable(q, input.client_id);
      await assertServicesExist(q, input);
      // GST is read once, here, and stored on the bill as a snapshot.
      const settings = await loadSettings(q);
      const rate = settings.gst_enabled ? settings.gst_rate_percent : 0;
      const totals = calculateTotals(input.items, rate);
      const billNo = (
        await q.query<{ bill_no: string }>("SELECT 'INV-' || lpad(nextval('bill_no_seq')::text, 6, '0') AS bill_no")
      ).rows[0].bill_no;
      const bill = (
        await q.query<{ id: number }>(
          `INSERT INTO bills (bill_no, client_id, bill_date, notes, subtotal_paise,
                              gst_rate_percent, gst_paise, total_paise, created_by)
           VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9) RETURNING id`,
          [billNo, input.client_id, input.bill_date ?? null, input.notes, totals.subtotal_paise,
           rate, totals.gst_paise, totals.total_paise, req.user!.id],
        )
      ).rows[0];
      await insertItems(q, bill.id, input);
      return bill.id;
    });
    await files.syncBill(id);
    res.status(201).json(await getBill(db, id));
  });

  router.put("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const input = billSchema.parse(req.body);
    assertReasonableTotal(input.items);
    const oldClientId = await db.tx(async (q) => {
      const existing = (
        await q.query<{ client_id: number; gst_rate_percent: number }>(
          "SELECT client_id, gst_rate_percent FROM bills WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!existing) throw new HttpError(404, "Bill not found");
      // A bill may keep belonging to a client deleted since, but cannot be moved to one.
      if (input.client_id !== existing.client_id) await assertClientUsable(q, input.client_id);
      await assertServicesExist(q, input);
      // Recalculate with the rate stored on THIS bill, never the current setting.
      const totals = calculateTotals(input.items, existing.gst_rate_percent);
      await q.query(
        `UPDATE bills SET client_id = $2, bill_date = COALESCE($3::date, bill_date), notes = $4,
                subtotal_paise = $5, gst_paise = $6, total_paise = $7,
                updated_by = $8, updated_at = now()
         WHERE id = $1`,
        [id, input.client_id, input.bill_date ?? null, input.notes, totals.subtotal_paise,
         totals.gst_paise, totals.total_paise, req.user!.id],
      );
      await q.query("DELETE FROM bill_items WHERE bill_id = $1", [id]);
      await insertItems(q, id, input);
      return existing.client_id;
    });
    await files.syncBill(id);
    // If the bill was moved to another client, the previous client's folder must drop its copy.
    if (oldClientId !== input.client_id) await files.syncClient(oldClientId);
    res.json(await getBill(db, id));
  });

  return router;
}
