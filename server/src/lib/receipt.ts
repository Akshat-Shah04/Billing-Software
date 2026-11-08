import type { Queryable } from "../db/index.js";

/**
 * An acknowledgement receipt for one payment, with where the bill stood once that payment came in:
 *
 *   Bill amount
 *   less credit notes and discounts dated on or before the payment date (a "settle the rest" made with the payment
 *        is dated the same day, so it shows here)
 *   less receipts received earlier on this bill (by date, then the order they were recorded)
 *   less this receipt
 *   = balance after this receipt
 *
 * The receipt is a "full payment" when nothing is left to pay after it, otherwise a "part payment".
 * Payments recorded later never change an earlier receipt.
 */
export interface Receipt {
  id: number;
  receipt_no: string;
  paid_on: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
  created_by_name: string;
  voided_at: string | null;
  void_reason: string | null;
  bill_id: number;
  bill_no: string;
  bill_date: string;
  bill_status: string;
  bill_total_paise: number;
  client_id: number;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  client_city: string | null;
  client_address: string | null;
  client_gstin: string | null;
  client_pan: string | null;
  client_file_no: string | null;
  /** Credit notes and discounts on the bill up to the payment date. */
  reduced_paise: number;
  /** Receipts on the same bill before this one. */
  received_before_paise: number;
  balance_after_paise: number;
  kind: "full" | "part";
}

export async function getReceipt(q: Queryable, paymentId: number): Promise<Receipt | null> {
  const r = (
    await q.query<any>(
      `SELECT p.id, p.receipt_no, p.paid_on::text AS paid_on, p.amount_paise, p.method, p.reference, p.notes, p.created_at,
              u.full_name AS created_by_name, p.voided_at, p.void_reason,
              b.id AS bill_id, b.bill_no, b.bill_date::text AS bill_date, b.status AS bill_status, b.total_paise AS bill_total_paise,
              c.id AS client_id, c.name AS client_name, c.phone AS client_phone, c.email AS client_email, c.city AS client_city,
              c.address AS client_address, c.gstin AS client_gstin, c.pan AS client_pan, c.file_no AS client_file_no,
              COALESCE((SELECT SUM(e.amount_paise) FROM payments e
                        WHERE e.bill_id = p.bill_id AND e.voided_at IS NULL AND e.id <> p.id
                          AND (e.paid_on < p.paid_on OR (e.paid_on = p.paid_on AND e.id < p.id))), 0)::bigint AS received_before_paise,
              (COALESCE((SELECT SUM(n.total_paise) FROM credit_notes n WHERE n.bill_id = p.bill_id AND n.cn_date <= p.paid_on), 0)
               + COALESCE((SELECT SUM(d.amount_paise) FROM discounts d WHERE d.bill_id = p.bill_id AND d.voided_at IS NULL AND d.given_on <= p.paid_on), 0))::bigint AS reduced_paise
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       JOIN clients c ON c.id = b.client_id
       JOIN users u ON u.id = p.created_by
       WHERE p.id = $1`,
      [paymentId],
    )
  ).rows[0];
  if (!r) return null;
  const balance = Math.max(0, r.bill_total_paise - r.reduced_paise - r.received_before_paise - r.amount_paise);
  return { ...r, balance_after_paise: balance, kind: balance === 0 ? "full" : "part" };
}

/** The receipts (payments) on one client's bills, in date order, for the client folder. */
export async function receiptIdsForClient(q: Queryable, clientId: number): Promise<number[]> {
  return (
    await q.query<{ id: number }>(
      "SELECT p.id FROM payments p JOIN bills b ON b.id = p.bill_id WHERE b.client_id = $1 ORDER BY p.paid_on, p.id",
      [clientId],
    )
  ).rows.map((r) => r.id);
}

/** "by UPI (ref. 5357...)", "in cash", "by cheque (ref. 000123)": how the money came, as the receipt words it. */
export function receivedHow(method: string, label: string, reference: string | null): string {
  return `${method === "cash" ? "in cash" : `by ${label}`}${reference ? ` (ref. ${reference})` : ""}`;
}
