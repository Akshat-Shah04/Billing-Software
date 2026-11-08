import type { Queryable } from "../db/index.js";
import { BILL_LIST_COLUMNS, billFilterSql, withSettlement } from "./billData.js";
import { likePattern } from "./paging.js";

/**
 * The fees report: every bill dated in a range (optionally one group's), in brief, with a summary and a month-by-month
 * breakdown. Fees are the firm's income; GST and amounts paid on clients' behalf are shown beside them, never inside.
 * Cancelled bills are listed (so the numbering is complete) but left out of every total.
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
  reduced_paise: number; // credit notes + discounts
  balance_paise: number;
  status: string;
  cancelled: boolean;
}

export interface FeesReport {
  from: string;
  to: string;
  group_name: string | null;
  rows: FeesReportRow[];
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
  };
  months: { month: string; bills: number; fees_paise: number; gst_paise: number; reimbursement_paise: number; received_paise: number }[];
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
    reimbursed_paise: 0, fees_received_paise: 0, credited_paise: 0, discount_paise: 0, outstanding_paise: 0,
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

    const key = b.bill_date.slice(0, 7);
    const m = months.get(key) ?? { month: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, bills: 0, fees_paise: 0, gst_paise: 0, reimbursement_paise: 0, received_paise: 0 };
    m.bills++;
    m.fees_paise += row.fees_paise;
    m.gst_paise += row.gst_paise;
    m.reimbursement_paise += row.reimbursement_paise;
    m.received_paise += row.received_paise;
    months.set(key, m);
    return row;
  });
  return { from: o.from, to: o.to, group_name: groupName, rows: out, summary, months: [...months.keys()].sort().map((k) => months.get(k)!) };
}
