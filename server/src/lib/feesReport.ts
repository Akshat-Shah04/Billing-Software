import type { Queryable } from "../db/index.js";
import { BILL_LIST_COLUMNS, billFilterSql, withSettlement } from "./billData.js";
import { METHOD_LABELS, type PaymentMethod } from "./format.js";
import { likePattern } from "./paging.js";

/**
 * The fees report: every bill dated in a range (optionally one group's), in brief, with a summary and a month-by-month
 * breakdown. Fees are the firm's income; GST and amounts paid on clients' behalf are shown beside them, never inside.
 * Cancelled bills are listed (so the numbering is complete) but left out of every total.
 *
 * Beside the bills, the report lists every receipt dated in the range (by the date the money came in, whatever the
 * bill's date), so the money actually collected in a period can be seen and matched with the bank.
 */

export interface FeesReportRow {
  bill_no: string;
  bill_date: string;
  client_name: string;
  group_name: string | null;
  fees_paise: number;
  gst_paise: number;
  reimbursement_paise: number;
  total_paise: number;
  received_paise: number;
  /** Date of the latest payment on the bill (null when nothing has been received). */
  last_paid_on: string | null;
  reduced_paise: number; // credit notes + discounts
  balance_paise: number;
  status: string;
  cancelled: boolean;
}

/** One payment received in the period, with its receipt number. */
export interface FeesReportReceipt {
  receipt_no: string;
  paid_on: string;
  client_name: string;
  group_name: string | null;
  bill_no: string;
  bill_date: string;
  method: string;
  reference: string | null;
  amount_paise: number;
}

export interface FeesReport {
  from: string;
  to: string;
  group_name: string | null;
  rows: FeesReportRow[];
  /** Payments received in the period (by payment date), oldest first. Voided payments are left out. */
  receipts: FeesReportReceipt[];
  summary: {
    bills: number;
    cancelled: number;
    fees_paise: number;
    gst_paise: number;
    reimbursement_paise: number;
    total_paise: number;
    received_paise: number;
    /** Part of what was received that paid back amounts paid on clients' behalf. */
    reimbursed_paise: number;
    /** Received towards fees and GST (received minus reimbursed). */
    fees_received_paise: number;
    credited_paise: number;
    discount_paise: number;
    outstanding_paise: number;
    /** Money received in the period (receipts dated in it), on any bill. */
    collected_paise: number;
    receipts: number;
  };
  /**
   * received_paise: received so far on the bills dated in that month. collected_paise: receipts dated in that month
   * (money that came in that month, on any bill).
   */
  months: { month: string; bills: number; fees_paise: number; gst_paise: number; reimbursement_paise: number; received_paise: number; collected_paise: number }[];
}

const STATUS_TEXT: Record<string, string> = { cancelled: "Cancelled", paid: "Paid", credited: "Credited", written_off: "Written off" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function buildFeesReport(q: Queryable, o: { from: string; to: string; groupId?: number | null }): Promise<FeesReport> {
  const { sql, params } = billFilterSql({ groupId: o.groupId ?? null }, likePattern);
  const { rows } = await q.query<any>(
    `SELECT ${BILL_LIST_COLUMNS} ${sql} AND b.bill_date BETWEEN $7::date AND $8::date ORDER BY b.bill_date, b.id`,
    [...params, o.from, o.to],
  );
  const groupName = o.groupId ? ((await q.query<{ name: string }>("SELECT name FROM client_groups WHERE id = $1", [o.groupId])).rows[0]?.name ?? null) : null;

  const summary: FeesReport["summary"] = {
    bills: 0, cancelled: 0, fees_paise: 0, gst_paise: 0, reimbursement_paise: 0, total_paise: 0, received_paise: 0,
    reimbursed_paise: 0, fees_received_paise: 0, credited_paise: 0, discount_paise: 0, outstanding_paise: 0, collected_paise: 0, receipts: 0,
  };
  const monthOf = (iso: string) => {
    const key = iso.slice(0, 7);
    let m = months.get(key);
    if (!m) {
      m = { month: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, bills: 0, fees_paise: 0, gst_paise: 0, reimbursement_paise: 0, received_paise: 0, collected_paise: 0 };
      months.set(key, m);
    }
    return m;
  };
  const months = new Map<string, FeesReport["months"][number]>();
  const out: FeesReportRow[] = rows.map((r) => {
    const b = withSettlement(r);
    const cancelled = b.state === "cancelled";
    const row: FeesReportRow = {
      bill_no: b.bill_no,
      bill_date: b.bill_date,
      client_name: b.client_name,
      group_name: b.group_name,
      fees_paise: b.subtotal_paise,
      gst_paise: b.gst_paise,
      reimbursement_paise: b.reimbursement_paise,
      total_paise: b.total_paise,
      received_paise: b.paid_paise,
      last_paid_on: b.last_paid_on ?? null,
      reduced_paise: b.credited_paise + b.discount_paise,
      balance_paise: Math.max(0, b.balance_paise),
      status: STATUS_TEXT[b.state] ?? (b.overdue ? "Overdue" : b.part_paid ? "Part paid" : "Unpaid"),
      cancelled,
    };
    if (cancelled) {
      summary.cancelled++;
      return row;
    }
    const reimbursed = Math.min(b.paid_paise, b.reimbursement_paise);
    summary.bills++;
    summary.fees_paise += row.fees_paise;
    summary.gst_paise += row.gst_paise;
    summary.reimbursement_paise += row.reimbursement_paise;
    summary.total_paise += row.total_paise;
    summary.received_paise += row.received_paise;
    summary.reimbursed_paise += reimbursed;
    summary.fees_received_paise += row.received_paise - reimbursed;
    summary.credited_paise += b.credited_paise;
    summary.discount_paise += b.discount_paise;
    summary.outstanding_paise += row.balance_paise;

    const m = monthOf(b.bill_date);
    m.bills++;
    m.fees_paise += row.fees_paise;
    m.gst_paise += row.gst_paise;
    m.reimbursement_paise += row.reimbursement_paise;
    m.received_paise += row.received_paise;
    return row;
  });

  const receipts = (
    await q.query<FeesReportReceipt>(
      `SELECT p.receipt_no, p.paid_on::text AS paid_on, c.name AS client_name,
              (SELECT g.name FROM client_groups g WHERE g.id = c.group_id) AS group_name,
              b.bill_no, b.bill_date::text AS bill_date, p.method, p.reference, p.amount_paise
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
       JOIN clients c ON c.id = b.client_id
       WHERE p.voided_at IS NULL AND p.paid_on BETWEEN $1::date AND $2::date
         AND ($3::int IS NULL OR c.group_id = $3::int)
       ORDER BY p.paid_on, p.id`,
      [o.from, o.to, o.groupId ?? null],
    )
  ).rows.map((r) => ({ ...r, method: METHOD_LABELS[r.method as PaymentMethod] ?? r.method }));
  for (const r of receipts) {
    summary.collected_paise += r.amount_paise;
    summary.receipts++;
    monthOf(r.paid_on).collected_paise += r.amount_paise;
  }
  return { from: o.from, to: o.to, group_name: groupName, rows: out, receipts, summary, months: [...months.keys()].sort().map((k) => months.get(k)!) };
}
