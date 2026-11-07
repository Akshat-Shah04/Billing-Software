import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import {
  BALANCE_SQL, BILL_LIST_COLUMNS, CREDITED_JOIN, DISCOUNT_JOIN, PAID_JOIN, billFilterSql, billSnapshot, FY_START_SQL, getBill, withSettlement,
} from "../lib/billData.js";
import { assertClientUsable, assertReasonableTotal, assertServicesExist, insertItems, itemSchema } from "../lib/billInput.js";
import type { ClientFiles } from "../lib/clientFiles.js";
import { HttpError } from "../lib/errors.js";
import { addDays, fyLabel, fyStartOf, todayISO } from "../lib/fy.js";
import { addHistory, itemsDiffer, rupeesText, summarizeEdit, type BillSnapshot } from "../lib/history.js";
import { calculateTotals } from "../lib/money.js";
import { nextDocumentNumber } from "../lib/numbering.js";
import { likePattern, optionalText, parsePaging } from "../lib/paging.js";
import { requireAdmin } from "../middleware/auth.js";
import { loadSettings } from "./settings.js";

const billSchema = z.object({
  client_id: z.number().int().positive(),
  bill_date: z.iso.date().nullish(),
  /**
   * The financial year the bill belongs to (2026 = FY 2026-27). Independent of the bill date.
   * Create: left out means the year the bill date falls in. Edit: left out keeps it; it can't be changed.
   */
  fy_start: z.number().int().min(1990, "Financial year must be 1990-91 or later").max(2200).nullish(),
  /** Create: left out means bill date plus the payment terms. Edit: left out keeps it, null clears it. */
  due_date: z.iso.date().nullish(),
  notes: optionalText(1000),
  items: z.array(itemSchema).min(1, "Add at least one item to the bill").max(100, "A bill can have at most 100 items"),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(300),
});

const STATUSES = ["outstanding", "overdue", "paid", "cancelled"] as const;
type StatusFilter = (typeof STATUSES)[number];

function readFilters(query: Record<string, unknown>) {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const clientId = query.client_id ? Number(query.client_id) : null;
  if (clientId !== null && !Number.isInteger(clientId)) throw new HttpError(400, "client_id must be a number");
  const fy = query.fy ? Number(query.fy) : null;
  if (fy !== null && (!Number.isInteger(fy) || fy < 1990 || fy > 2200)) throw new HttpError(400, "fy must be a year like 2026");
  const status = query.status ? String(query.status) : null;
  if (status !== null && !STATUSES.includes(status as StatusFilter)) {
    throw new HttpError(400, `status must be one of: ${STATUSES.join(", ")}`);
  }
  return { q, clientId, fy, status: status as StatusFilter | null };
}

export function billRoutes(db: Db, files: ClientFiles): Router {
  const router = Router();

  // The financial years that have bills (newest first), always including the current one, for the dropdown.
  router.get("/financial-years", async (_req, res) => {
    const { rows } = await db.query<{ fy_start: number }>(
      `SELECT DISTINCT ${FY_START_SQL} AS fy_start FROM bills b ORDER BY fy_start DESC`,
    );
    const years = new Set([fyStartOf(todayISO()), ...rows.map((r) => r.fy_start)]);
    res.json({ items: [...years].sort((a, b) => b - a).map((fy_start) => ({ fy_start, label: fyLabel(fy_start) })) });
  });

  // Totals for the strip at the top of the Bills page. Cancelled bills are left out. ?fy=2026 limits it to a year.
  router.get("/summary", async (req, res) => {
    const { fy } = readFilters(req.query);
    const late = `${BALANCE_SQL} > 0 AND b.due_date IS NOT NULL AND b.due_date < $2::date`;
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(b.total_paise), 0)::bigint AS billed_paise,
              COALESCE(SUM(cn.credited), 0)::bigint AS credited_paise,
              COALESCE(SUM(d.discounted), 0)::bigint AS discount_paise,
              COALESCE(SUM(p.paid), 0)::bigint AS collected_paise,
              COALESCE(SUM(GREATEST(${BALANCE_SQL}, 0)), 0)::bigint AS outstanding_paise,
              COUNT(*) FILTER (WHERE ${BALANCE_SQL} > 0)::int AS outstanding_count,
              COALESCE(SUM(GREATEST(${BALANCE_SQL}, 0)) FILTER (WHERE ${late}), 0)::bigint AS overdue_paise,
              COUNT(*) FILTER (WHERE ${late})::int AS overdue_count
       FROM bills b ${PAID_JOIN} ${CREDITED_JOIN} ${DISCOUNT_JOIN}
       WHERE b.status = 'active'
         AND ($1::int IS NULL OR b.fy_start = $1::int)`,
      [fy, todayISO()],
    );
    res.json(rows[0]);
  });

  // Search: ?q=<client name or bill number>&client_id=&fy=<start year, e.g. 2026 for 2026-27>
  //         &status=outstanding|overdue|paid|cancelled&page=&limit=      Newest first.
  router.get("/", async (req, res) => {
    const { page, limit, offset } = parsePaging(req.query);
    const { sql, params } = billFilterSql(readFilters(req.query), likePattern);
    const total = await db.query<{ n: number }>(`SELECT count(*) AS n ${sql}`, params);
    const { rows } = await db.query(
      `SELECT ${BILL_LIST_COLUMNS} ${sql} ORDER BY b.bill_date DESC, b.id DESC LIMIT $6 OFFSET $7`,
      [...params, limit, offset],
    );
    res.json({ items: rows.map((r: any) => withSettlement(r)), total: total.rows[0].n, page, limit });
  });

  router.get("/:id", async (req, res) => {
    const bill = await getBill(db, Number(req.params.id));
    if (!bill) throw new HttpError(404, "Bill not found");
    res.json(bill);
  });

  router.get("/:id/history", async (req, res) => {
    const id = Number(req.params.id);
    if (!(await db.query("SELECT 1 FROM bills WHERE id = $1", [id])).rowCount) throw new HttpError(404, "Bill not found");
    const { rows } = await db.query(
      `SELECT h.id, h.action, h.summary, h.before_data, h.changed_at, u.full_name AS changed_by_name
       FROM bill_history h JOIN users u ON u.id = h.changed_by
       WHERE h.bill_id = $1 ORDER BY h.id DESC`,
      [id],
    );
    res.json({ items: rows });
  });

  router.post("/", async (req, res) => {
    const input = billSchema.parse(req.body);
    assertReasonableTotal(input.items);
    const billDate = input.bill_date ?? todayISO();
    const fyStart = input.fy_start ?? fyStartOf(billDate);
    // A chosen year can be any earlier year, or next year (advance billing), but not further ahead than that.
    if (input.fy_start != null && fyStart > fyStartOf(todayISO()) + 1) throw new HttpError(400, `Financial year ${fyLabel(fyStart)} is too far in the future`);
    const id = await db.tx(async (q) => {
      // Everything that can reject the bill is checked BEFORE a number is taken.
      await assertClientUsable(q, input.client_id);
      await assertServicesExist(q, input.items);
      // GST is read once, here, and stored on the bill as a snapshot.
      const settings = await loadSettings(q);
      const rate = settings.gst_enabled ? settings.gst_rate_percent : 0;
      const totals = calculateTotals(input.items, rate);
      const dueDate = input.due_date ?? addDays(billDate, settings.payment_terms_days);
      if (dueDate < billDate) throw new HttpError(400, "The due date cannot be before the bill date");

      const billNo = await nextDocumentNumber(q, "INV", fyStart);
      const bill = (
        await q.query<{ id: number }>(
          `INSERT INTO bills (bill_no, fy_start, client_id, bill_date, due_date, notes, subtotal_paise,
                              gst_rate_percent, gst_paise, total_paise, created_by)
           VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [billNo, fyStart, input.client_id, billDate, dueDate, input.notes, totals.subtotal_paise,
           rate, totals.gst_paise, totals.total_paise, req.user!.id],
        )
      ).rows[0];
      await insertItems(q, bill.id, input.items);
      await addHistory(q, { billId: bill.id, userId: req.user!.id, action: "created", summary: `Bill ${billNo} created for ${rupeesText(totals.total_paise)}` });
      return bill.id;
    });
    await files.syncBill(id);
    res.status(201).json(await getBill(db, id));
  });

  router.put("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const input = billSchema.parse(req.body);
    assertReasonableTotal(input.items);

    const result = await db.tx(async (q) => {
      const row = (
        await q.query<{ client_id: number; gst_rate_percent: number; status: string; bill_date: string; due_date: string | null; fy_start: number }>(
          `SELECT client_id, gst_rate_percent, status, bill_date::text AS bill_date, due_date::text AS due_date, fy_start
           FROM bills WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "Bill not found");
      if (row.status === "cancelled") throw new HttpError(409, "This bill has been cancelled and cannot be edited");

      const newDate = input.bill_date ?? row.bill_date;
      // The bill number belongs to its financial year's series, so the year can't change. (The bill date can.)
      if (input.fy_start != null && input.fy_start !== row.fy_start) {
        throw new HttpError(400, `This bill belongs to financial year ${fyLabel(row.fy_start)} and its number is from that year's series, so the year can't be changed. To bill another year, cancel this bill and make a new one.`);
      }
      const newDue = input.due_date === undefined ? row.due_date : input.due_date;
      if (newDue && newDue < newDate) throw new HttpError(400, "The due date cannot be before the bill date");
      // A bill may keep belonging to a client deleted since, but cannot be moved to one.
      if (input.client_id !== row.client_id) await assertClientUsable(q, input.client_id);
      await assertServicesExist(q, input.items);

      const before = (await billSnapshot(q, id))!;
      const clientName = (await q.query<{ name: string }>("SELECT name FROM clients WHERE id = $1", [input.client_id])).rows[0].name;
      // Recalculate with the rate stored on THIS bill, never the current setting.
      const totals = calculateTotals(input.items, row.gst_rate_percent);
      const after: BillSnapshot = {
        ...before,
        client_id: input.client_id,
        client_name: clientName,
        bill_date: newDate,
        due_date: newDue ?? null,
        notes: input.notes,
        subtotal_paise: totals.subtotal_paise,
        gst_paise: totals.gst_paise,
        total_paise: totals.total_paise,
        items: input.items.map((i) => ({
          service_id: i.service_id ?? null, description: i.description, details: i.details, quantity: i.quantity,
          unit_price_paise: i.unit_price_paise, line_total_paise: i.quantity * i.unit_price_paise,
        })),
      };

      const changes = summarizeEdit(before, after);
      if (!changes.length) return { changed: false, oldClientId: row.client_id }; // nothing to save, nothing to record

      // Once a payment or credit note is attached the amounts are fixed: correct them with a credit note instead.
      const structural = input.client_id !== row.client_id || newDate !== row.bill_date || itemsDiffer(before.items, after.items);
      if (structural) {
        const attached = (
          await q.query<{ n: number }>(
            `SELECT (SELECT count(*) FROM payments WHERE bill_id = $1 AND voided_at IS NULL)
                  + (SELECT count(*) FROM credit_notes WHERE bill_id = $1)
                  + (SELECT count(*) FROM discounts WHERE bill_id = $1 AND voided_at IS NULL) AS n`,
            [id],
          )
        ).rows[0].n;
        if (attached > 0) {
          throw new HttpError(409, "This bill has payments or credit notes, so its client, date and items can't be changed. Issue a credit note to correct it. You can still change the notes and due date.");
        }
      }

      await q.query(
        `UPDATE bills SET client_id = $2, bill_date = $3::date, due_date = $4::date, notes = $5,
                subtotal_paise = $6, gst_paise = $7, total_paise = $8, updated_by = $9, updated_at = now()
         WHERE id = $1`,
        [id, input.client_id, newDate, newDue ?? null, input.notes, totals.subtotal_paise, totals.gst_paise, totals.total_paise, req.user!.id],
      );
      await q.query("DELETE FROM bill_items WHERE bill_id = $1", [id]);
      await insertItems(q, id, input.items);
      await addHistory(q, { billId: id, userId: req.user!.id, action: "edited", summary: changes.join("; "), before });
      return { changed: true, oldClientId: row.client_id };
    });

    if (result.changed) {
      await files.syncBill(id);
      // If the bill was moved to another client, the previous client's folder must drop its copy.
      if (result.oldClientId !== input.client_id) await files.syncClient(result.oldClientId);
    }
    res.json(await getBill(db, id));
  });

  // Cancelling keeps the bill and its number (numbers are never reused). It is for a bill issued by mistake.
  router.post("/:id/cancel", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = cancelSchema.parse(req.body);
    await db.tx(async (q) => {
      const row = (await q.query<{ status: string; bill_no: string }>("SELECT status, bill_no FROM bills WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!row) throw new HttpError(404, "Bill not found");
      if (row.status === "cancelled") throw new HttpError(409, "This bill is already cancelled");
      const attached = (
        await q.query<{ pay: number; cn: number; disc: number }>(
          `SELECT (SELECT count(*) FROM payments WHERE bill_id = $1 AND voided_at IS NULL)::int AS pay,
                  (SELECT count(*) FROM credit_notes WHERE bill_id = $1)::int AS cn,
                  (SELECT count(*) FROM discounts WHERE bill_id = $1 AND voided_at IS NULL)::int AS disc`,
          [id],
        )
      ).rows[0];
      if (attached.pay > 0) throw new HttpError(409, "This bill has payments recorded. Void them first, or issue a credit note instead of cancelling.");
      if (attached.cn > 0) throw new HttpError(409, "This bill has credit notes, so it can't be cancelled.");
      if (attached.disc > 0) throw new HttpError(409, "This bill has a discount recorded. Void it first.");
      await q.query("UPDATE bills SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1", [id, req.user!.id, reason]);
      await addHistory(q, { billId: id, userId: req.user!.id, action: "cancelled", summary: `Bill ${row.bill_no} cancelled: ${reason}` });
    });
    await files.syncBill(id);
    res.json(await getBill(db, id));
  });

  return router;
}
