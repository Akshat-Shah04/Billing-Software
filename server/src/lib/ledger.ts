import type { Queryable } from "../db/index.js";
import { HttpError } from "./errors.js";
import { METHOD_LABELS, fyLabelOf, money, type PaymentMethod } from "./format.js";
import { fyStartOf, todayISO } from "./fy.js";

/**
 * A client's (or a whole group's) ledger account for a date range: everything billed and received, in date order,
 * with a running balance. Debit = the client owes more; credit = the client owes less.
 *
 *   Opening balance  = everything dated before `from`
 *   Entries          = bills, payments, credit notes, discounts and cancellations dated from `from` to `to`
 *   Closing balance  = opening + debits - credits
 *
 * Voided payments and discounts are left out (they never counted). A cancelled bill appears as the bill and then a
 * matching credit on the day it was cancelled, so the record stays complete and the balance is right.
 */

export interface LedgerEntry {
  date: string;
  type: "Bill" | "Payment" | "Credit note" | "Discount" | "Cancelled";
  number: string;
  /** Who it belongs to (shown on a group's ledger). */
  client_name: string;
  details: string;
  /** The line as the statement prints it, e.g. "Professional fees, Anand Electricals, FY 2024-25" or "Received, UTR 5357...". */
  particulars: string;
  /** Bill number for a bill; the credit note number for a credit note; empty for receipts. */
  ref: string;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number;
}

export interface Ledger {
  kind: "client" | "group";
  id: number;
  name: string;
  /** Members of a group (empty for a single client). */
  members: string[];
  client: { address: string | null; city: string | null; pan: string | null; phone: string | null; file_no: string | null } | null;
  from: string;
  to: string;
  opening_paise: number;
  entries: LedgerEntry[];
  closing_paise: number;
  totals: { billed_paise: number; received_paise: number; credited_paise: number; discount_paise: number; cancelled_paise: number };
  /** Date of the earliest transaction ever (to know whether an opening balance applies). */
  first_date: string;
  /**
   * Bills not yet fully paid as on `to`: each bill's amount after its own credit notes and discounts, with every
   * payment applied to the oldest bill first (as the firm's statements do).
   */
  pending: { bill_no: string; bill_date: string; client_name: string; billed_paise: number; received_paise: number; pending_paise: number }[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Reads ?from=&to= (YYYY-MM-DD). Defaults: the start of the current financial year to today. */
export function readRange(query: Record<string, unknown>): { from: string; to: string } {
  const today = todayISO();
  const from = typeof query.from === "string" && query.from ? query.from : `${fyStartOf(today)}-04-01`;
  const to = typeof query.to === "string" && query.to ? query.to : today;
  if (!ISO.test(from) || !ISO.test(to)) throw new HttpError(400, "Dates must be like 2026-04-01");
  if (from > to) throw new HttpError(400, "The start date must be on or before the end date");
  return { from, to };
}

/** Builds the ledger for one client (clientId) or every client in a group (groupId). */
export async function buildLedger(q: Queryable, o: { clientId?: number | null; groupId?: number | null; from: string; to: string }): Promise<Ledger> {
  let kind: Ledger["kind"];
  let name: string;
  let id: number;
  let clientIds: number[];
  let members: string[] = [];
  let client: Ledger["client"] = null;

  if (o.clientId) {
    const c = (await q.query<any>("SELECT id, name, address, city, pan, phone, file_no FROM clients WHERE id = $1", [o.clientId])).rows[0];
    if (!c) throw new HttpError(404, "Client not found");
    kind = "client";
    id = c.id;
    name = c.name;
    clientIds = [c.id];
    client = { address: c.address, city: c.city, pan: c.pan, phone: c.phone, file_no: c.file_no };
  } else if (o.groupId) {
    const g = (await q.query<{ id: number; name: string }>("SELECT id, name FROM client_groups WHERE id = $1", [o.groupId])).rows[0];
    if (!g) throw new HttpError(404, "Group not found");
    const rows = (await q.query<{ id: number; name: string }>("SELECT id, name FROM clients WHERE group_id = $1 ORDER BY lower(name)", [g.id])).rows;
    kind = "group";
    id = g.id;
    name = g.name;
    clientIds = rows.map((r) => r.id);
    members = rows.map((r) => r.name);
  } else {
    throw new HttpError(400, "Choose a client or a group");
  }

  const all: Omit<LedgerEntry, "balance_paise">[] = [];
  const named = (clientName: string) => (kind === "group" ? `, ${clientName}` : "");
  const billRows: any[] = [];
  const reductions = new Map<number, { paise: number; date: string }[]>(); // credit notes and discounts per bill
  if (clientIds.length) {
    const bills = (
      await q.query<any>(
        `SELECT b.id, b.bill_no, b.bill_date::text AS bill_date, b.status, b.total_paise, b.cancelled_at::date::text AS cancelled_on,
                c.name AS client_name,
                (SELECT string_agg(bi.description, ', ' ORDER BY bi.id) FROM bill_items bi WHERE bi.bill_id = b.id) AS items,
                (SELECT string_agg(DISTINCT bi.fy_start::text, ',') FROM bill_items bi WHERE bi.bill_id = b.id AND bi.kind = 'fee') AS fys,
                b.reimbursement_paise
         FROM bills b JOIN clients c ON c.id = b.client_id
         WHERE b.client_id = ANY($1::int[])`,
        [clientIds],
      )
    ).rows;
    const billIds = bills.map((b) => b.id);
    const byId = new Map<number, any>(bills.map((b) => [b.id, b]));
    for (const b of bills) {
      billRows.push(b);
      const years = String(b.fys ?? "").split(",").filter(Boolean).map(Number).sort((x, y) => x - y).map((y) => fyLabelOf(y));
      const fees = `Professional fees${named(b.client_name)}${years.length ? `, FY ${years.join(", ")}` : ""}`;
      const onBehalf = b.reimbursement_paise > 0 ? `${years.length || b.total_paise > b.reimbursement_paise ? " + " : ""}paid on your behalf ${money(b.reimbursement_paise)}` : "";
      const particulars = b.total_paise === b.reimbursement_paise ? `Paid on your behalf${named(b.client_name)}` : `${fees}${onBehalf}`;
      all.push({ date: b.bill_date, type: "Bill", number: b.bill_no, client_name: b.client_name, details: b.items ?? "", particulars, ref: b.bill_no, debit_paise: b.total_paise, credit_paise: 0 });
      if (b.status === "cancelled") {
        all.push({ date: b.cancelled_on ?? b.bill_date, type: "Cancelled", number: b.bill_no, client_name: b.client_name, details: "Bill cancelled", particulars: `Bill ${b.bill_no} cancelled${named(b.client_name)}`, ref: b.bill_no, debit_paise: 0, credit_paise: b.total_paise });
      }
    }
    if (billIds.length) {
      for (const p of (await q.query<any>("SELECT bill_id, paid_on::text AS paid_on, amount_paise, method, reference FROM payments WHERE bill_id = ANY($1::int[]) AND voided_at IS NULL", [billIds])).rows) {
        const b = byId.get(p.bill_id);
        const how = METHOD_LABELS[p.method as PaymentMethod] ?? p.method;
        // "Received, UTR 5357..." for a bank transfer; "Received by UPI, ..." / "Received by cheque, 000123" otherwise.
        const said = `Received${p.method === "bank_transfer" ? "" : p.method === "cash" ? " in cash" : ` by ${how}`}${p.reference ? `, ${p.reference}` : ""}`;
        all.push({ date: p.paid_on, type: "Payment", number: b.bill_no, client_name: b.client_name, details: said, particulars: `${said}${named(b.client_name)}`, ref: "", debit_paise: 0, credit_paise: p.amount_paise });
      }
      for (const c of (await q.query<any>("SELECT bill_id, cn_no, cn_date::text AS cn_date, reason, total_paise FROM credit_notes WHERE bill_id = ANY($1::int[])", [billIds])).rows) {
        const b = byId.get(c.bill_id);
        all.push({ date: c.cn_date, type: "Credit note", number: c.cn_no, client_name: b.client_name, details: `${c.reason} (against ${b.bill_no})`, particulars: `Credit note against bill ${b.bill_no}${named(b.client_name)}: ${c.reason}`, ref: c.cn_no, debit_paise: 0, credit_paise: c.total_paise });
        reductions.set(c.bill_id, [...(reductions.get(c.bill_id) ?? []), { paise: c.total_paise, date: c.cn_date }]);
      }
      for (const d of (await q.query<any>("SELECT bill_id, given_on::text AS given_on, amount_paise, reason FROM discounts WHERE bill_id = ANY($1::int[]) AND voided_at IS NULL", [billIds])).rows) {
        const b = byId.get(d.bill_id);
        all.push({ date: d.given_on, type: "Discount", number: b.bill_no, client_name: b.client_name, details: d.reason, particulars: `Discount allowed on bill ${b.bill_no}${named(b.client_name)}: ${d.reason}`, ref: b.bill_no, debit_paise: 0, credit_paise: d.amount_paise });
        reductions.set(d.bill_id, [...(reductions.get(d.bill_id) ?? []), { paise: d.amount_paise, date: d.given_on }]);
      }
    }
  }

  // Same day: bills first, then credit notes, payments, discounts, cancellations.
  const order = { Bill: 0, "Credit note": 1, Payment: 2, Discount: 3, Cancelled: 4 } as const;
  all.sort((a, b) => a.date.localeCompare(b.date) || order[a.type] - order[b.type] || a.number.localeCompare(b.number));

  const opening = all.filter((e) => e.date < o.from).reduce((s, e) => s + e.debit_paise - e.credit_paise, 0);
  let balance = opening;
  const entries: LedgerEntry[] = [];
  const totals = { billed_paise: 0, received_paise: 0, credited_paise: 0, discount_paise: 0, cancelled_paise: 0 };
  for (const e of all.filter((x) => x.date >= o.from && x.date <= o.to)) {
    balance += e.debit_paise - e.credit_paise;
    entries.push({ ...e, balance_paise: balance });
    if (e.type === "Bill") totals.billed_paise += e.debit_paise;
    if (e.type === "Payment") totals.received_paise += e.credit_paise;
    if (e.type === "Credit note") totals.credited_paise += e.credit_paise;
    if (e.type === "Discount") totals.discount_paise += e.credit_paise;
    if (e.type === "Cancelled") totals.cancelled_paise += e.credit_paise;
  }
  // Bills pending as on `to`: every bill's amount after its own credit notes and discounts, then all payments up to
  // `to` applied to the oldest bill first.
  let receipts = all.filter((e) => e.type === "Payment" && e.date <= o.to).reduce((s, e) => s + e.credit_paise, 0);
  const pending: Ledger["pending"] = [];
  for (const b of billRows.filter((x) => x.status !== "cancelled" && x.bill_date <= o.to).sort((x, y) => x.bill_date.localeCompare(y.bill_date) || x.id - y.id)) {
    const billed = b.total_paise - (reductions.get(b.id) ?? []).filter((r) => r.date <= o.to).reduce((s, r) => s + r.paise, 0);
    if (billed <= 0) continue;
    const applied = Math.min(receipts, billed);
    receipts -= applied;
    if (billed - applied > 0) pending.push({ bill_no: b.bill_no, bill_date: b.bill_date, client_name: b.client_name, billed_paise: billed, received_paise: applied, pending_paise: billed - applied });
  }

  return { kind, id, name, members, client, from: o.from, to: o.to, opening_paise: opening, entries, closing_paise: balance, totals, first_date: all[0]?.date ?? o.from, pending };
}
