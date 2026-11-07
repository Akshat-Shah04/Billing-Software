import type { Queryable } from "../db/index.js";
import { todayISO } from "./fy.js";
import type { BillSnapshot } from "./history.js";
import { settle } from "./settlement.js";

// The financial year a bill belongs to, chosen when it is made (stored, not worked out from the bill date).
// fy_start 2026 means FY 2026-27 (1 Apr 2026 to 31 Mar 2027).
export const FY_START_SQL = `b.fy_start`;

// Payments that count (a voided payment is kept for the record but ignored) and credit notes, summed per bill.
export const PAID_JOIN = `LEFT JOIN (SELECT bill_id, SUM(amount_paise)::bigint AS paid FROM payments WHERE voided_at IS NULL GROUP BY bill_id) p ON p.bill_id = b.id`;
export const CREDITED_JOIN = `LEFT JOIN (SELECT bill_id, SUM(total_paise)::bigint AS credited FROM credit_notes GROUP BY bill_id) cn ON cn.bill_id = b.id`;
export const DISCOUNT_JOIN = `LEFT JOIN (SELECT bill_id, SUM(amount_paise)::bigint AS discounted FROM discounts WHERE voided_at IS NULL GROUP BY bill_id) d ON d.bill_id = b.id`;
export const BALANCE_SQL = `(b.total_paise - COALESCE(cn.credited, 0) - COALESCE(p.paid, 0) - COALESCE(d.discounted, 0))`;

/** What has been paid, credited and discounted on one bill so far (voided payments and discounts left out). */
export async function billSums(q: Queryable, billId: number): Promise<{ paid: number; credited: number; discounted: number }> {
  return (
    await q.query<{ paid: number; credited: number; discounted: number }>(
      `SELECT COALESCE((SELECT SUM(amount_paise) FROM payments WHERE bill_id = $1 AND voided_at IS NULL), 0)::bigint AS paid,
              COALESCE((SELECT SUM(total_paise) FROM credit_notes WHERE bill_id = $1), 0)::bigint AS credited,
              COALESCE((SELECT SUM(amount_paise) FROM discounts WHERE bill_id = $1 AND voided_at IS NULL), 0)::bigint AS discounted`,
      [billId],
    )
  ).rows[0];
}

export interface BillFilters {
  q?: string;
  clientId?: number | null;
  fy?: number | null;
  status?: "outstanding" | "overdue" | "paid" | "cancelled" | null;
}

/** FROM / JOIN / WHERE shared by the bills list, the summary and the CSV export. Parameters $1 to $5. */
export function billFilterSql(f: BillFilters, likePattern: (s: string) => string) {
  const q = (f.q ?? "").trim();
  const params = [q ? likePattern(q) : null, f.clientId ?? null, f.fy ?? null, f.status ?? null, todayISO()];
  const sql = `
    FROM bills b
    JOIN clients c ON c.id = b.client_id
    JOIN users cu ON cu.id = b.created_by
    ${PAID_JOIN}
    ${CREDITED_JOIN}
    ${DISCOUNT_JOIN}
    WHERE ($1::text IS NULL OR c.name ILIKE $1 OR b.bill_no ILIKE $1)
      AND ($2::int IS NULL OR b.client_id = $2)
      AND ($3::int IS NULL OR b.fy_start = $3::int)
      AND ($4::text IS NULL
           OR ($4 = 'outstanding' AND b.status = 'active' AND ${BALANCE_SQL} > 0)
           OR ($4 = 'overdue' AND b.status = 'active' AND ${BALANCE_SQL} > 0 AND b.due_date IS NOT NULL AND b.due_date < $5::date)
           OR ($4 = 'paid' AND b.status = 'active' AND ${BALANCE_SQL} <= 0 AND (COALESCE(p.paid, 0) > 0 OR COALESCE(d.discounted, 0) > 0))
           OR ($4 = 'cancelled' AND b.status = 'cancelled'))`;
  return { sql, params };
}

export const BILL_LIST_COLUMNS = `
  b.id, b.bill_no, b.bill_date::text AS bill_date, b.due_date::text AS due_date, ${FY_START_SQL} AS fy_start,
  b.status, b.subtotal_paise, b.gst_rate_percent, b.gst_paise, b.total_paise,
  COALESCE(p.paid, 0)::bigint AS paid_paise, COALESCE(cn.credited, 0)::bigint AS credited_paise,
  COALESCE(d.discounted, 0)::bigint AS discount_paise,
  b.client_id, c.name AS client_name, c.phone AS client_phone, c.city AS client_city,
  c.gstin AS client_gstin, c.is_deleted AS client_deleted, b.created_at, cu.full_name AS created_by_name`;

/** Adds balance, state and overdue to a row from BILL_LIST_COLUMNS. */
export function withSettlement<T extends { total_paise: number; status: string; due_date: string | null; paid_paise: number; credited_paise: number; discount_paise: number }>(row: T) {
  return { ...row, ...settle(row, row.paid_paise, row.credited_paise, row.discount_paise) };
}

export async function getBill(q: Queryable, id: number) {
  const bill = (
    await q.query(
      `SELECT b.id, b.bill_no, b.bill_date::text AS bill_date, b.due_date::text AS due_date, ${FY_START_SQL} AS fy_start,
              b.notes, b.status, b.cancelled_at, b.cancel_reason, xu.full_name AS cancelled_by_name,
              b.subtotal_paise, b.gst_rate_percent, b.gst_paise, b.total_paise,
              b.client_id, c.name AS client_name, c.phone AS client_phone, c.city AS client_city,
              c.address AS client_address, c.gstin AS client_gstin, c.pan AS client_pan,
              b.created_at, b.updated_at,
              cu.full_name AS created_by_name, uu.full_name AS updated_by_name
       FROM bills b
       JOIN clients c ON c.id = b.client_id
       JOIN users cu ON cu.id = b.created_by
       LEFT JOIN users uu ON uu.id = b.updated_by
       LEFT JOIN users xu ON xu.id = b.cancelled_by
       WHERE b.id = $1`,
      [id],
    )
  ).rows[0];
  if (!bill) return null;

  const items = (
    await q.query(
      `SELECT id, service_id, description, details, quantity, unit_price_paise, line_total_paise, fy_start
       FROM bill_items WHERE bill_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;

  const payments = (
    await q.query(
      `SELECT p.id, p.amount_paise, p.paid_on::text AS paid_on, p.method, p.reference, p.notes, p.created_at,
              u.full_name AS created_by_name, p.voided_at, vu.full_name AS voided_by_name, p.void_reason
       FROM payments p
       JOIN users u ON u.id = p.created_by
       LEFT JOIN users vu ON vu.id = p.voided_by
       WHERE p.bill_id = $1 ORDER BY p.paid_on, p.id`,
      [id],
    )
  ).rows as { amount_paise: number; voided_at: string | null }[];

  const credit_notes = (
    await q.query(
      `SELECT id, cn_no, cn_date::text AS cn_date, reason, total_paise FROM credit_notes WHERE bill_id = $1 ORDER BY id`,
      [id],
    )
  ).rows as { total_paise: number }[];

  const discounts = (
    await q.query(
      `SELECT d.id, d.amount_paise, d.given_on::text AS given_on, d.reason, d.created_at, u.full_name AS created_by_name,
              d.voided_at, vu.full_name AS voided_by_name, d.void_reason
       FROM discounts d
       JOIN users u ON u.id = d.created_by
       LEFT JOIN users vu ON vu.id = d.voided_by
       WHERE d.bill_id = $1 ORDER BY d.given_on, d.id`,
      [id],
    )
  ).rows as { amount_paise: number; voided_at: string | null }[];

  const paid = payments.filter((p) => !p.voided_at).reduce((s, p) => s + p.amount_paise, 0);
  const credited = credit_notes.reduce((s, c) => s + c.total_paise, 0);
  const discounted = discounts.filter((d) => !d.voided_at).reduce((s, d) => s + d.amount_paise, 0);
  return {
    ...bill,
    items,
    payments,
    credit_notes,
    discounts,
    ...settle(bill, paid, credited, discounted),
    // Once money, a credit note or a discount is attached, the bill's client, date and items are fixed.
    amounts_locked: paid > 0 || credited > 0 || discounted > 0,
  };
}

/** The bill as it is stored, in the shape kept in the change history. */
export async function billSnapshot(q: Queryable, id: number): Promise<BillSnapshot | null> {
  const bill = await getBill(q, id);
  if (!bill) return null;
  return {
    bill_no: bill.bill_no,
    client_id: bill.client_id,
    client_name: bill.client_name,
    bill_date: bill.bill_date,
    due_date: bill.due_date,
    notes: bill.notes,
    gst_rate_percent: bill.gst_rate_percent,
    subtotal_paise: bill.subtotal_paise,
    gst_paise: bill.gst_paise,
    total_paise: bill.total_paise,
    items: bill.items.map((i: any) => ({
      service_id: i.service_id,
      description: i.description,
      details: i.details,
      quantity: i.quantity,
      unit_price_paise: i.unit_price_paise,
      line_total_paise: i.line_total_paise,
      fy_start: i.fy_start,
    })),
  };
}

export async function getCreditNote(q: Queryable, id: number) {
  const cn = (
    await q.query(
      `SELECT n.id, n.cn_no, n.cn_date::text AS cn_date, n.reason, n.subtotal_paise, n.gst_rate_percent, n.gst_paise,
              n.total_paise, n.created_at, u.full_name AS created_by_name,
              b.id AS bill_id, b.bill_no, b.bill_date::text AS bill_date,
              c.id AS client_id, c.name AS client_name, c.phone AS client_phone, c.city AS client_city,
              c.address AS client_address, c.gstin AS client_gstin, c.pan AS client_pan
       FROM credit_notes n
       JOIN bills b ON b.id = n.bill_id
       JOIN clients c ON c.id = b.client_id
       JOIN users u ON u.id = n.created_by
       WHERE n.id = $1`,
      [id],
    )
  ).rows[0];
  if (!cn) return null;
  const items = (
    await q.query(
      `SELECT id, description, details, quantity, unit_price_paise, line_total_paise
       FROM credit_note_items WHERE credit_note_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;
  return { ...cn, items };
}
