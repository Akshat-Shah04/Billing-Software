import { Router } from "express";
import type { Db } from "../db/index.js";
import { BILL_LIST_COLUMNS, billFilterSql, withSettlement } from "../lib/billData.js";
import { rupees, text, toCsv } from "../lib/csv.js";
import { HttpError } from "../lib/errors.js";
import { METHOD_LABELS, fyLabelOf, safeFileName, type PaymentMethod } from "../lib/format.js";
import { likePattern } from "../lib/paging.js";

const stateText = (b: { state: string; part_paid: boolean }) =>
  b.state === "cancelled" ? "Cancelled" : b.state === "paid" ? "Paid" : b.state === "credited" ? "Credited" : b.state === "written_off" ? "Written off" : b.part_paid ? "Part paid" : "Unpaid";

function sendCsv(res: import("express").Response, filename: string, rows: string[][]) {
  res
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .send(toCsv(rows));
}

function readFy(value: unknown): number | null {
  if (!value) return null;
  const fy = Number(value);
  if (!Number.isInteger(fy) || fy < 1990 || fy > 2200) throw new HttpError(400, "fy must be a year like 2026");
  return fy;
}

/** Mounted at /api/exports. Excel opens these directly. Amounts are plain rupees so they can be added up. */
export function exportRoutes(db: Db): Router {
  const router = Router();

  // Bills register: the same filters as the Bills page (?q, client_id, fy, status). Everything that matches, not one page.
  router.get("/bills.csv", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const clientId = req.query.client_id ? Number(req.query.client_id) : null;
    if (clientId !== null && !Number.isInteger(clientId)) throw new HttpError(400, "client_id must be a number");
    const status = req.query.status ? String(req.query.status) : null;
    if (status !== null && !["outstanding", "overdue", "paid", "cancelled"].includes(status)) throw new HttpError(400, "status must be outstanding, overdue, paid or cancelled");
    const fy = readFy(req.query.fy);

    const { sql, params } = billFilterSql({ q, clientId, fy, status: status as never }, likePattern);
    const { rows } = await db.query(`SELECT ${BILL_LIST_COLUMNS} ${sql} ORDER BY b.bill_date, b.id`, params);

    const head = ["Bill no.", "Bill date", "Financial year", "Due date", "Client", "Client GSTIN", "Status", "Overdue", "Subtotal", "GST rate %", "GST", "Total", "Credit notes", "Paid", "Discount", "Balance due", "Created by"];
    const body = rows.map((r: any) => {
      const b = withSettlement(r);
      return [
        text(b.bill_no), b.bill_date, fyLabelOf(b.fy_start), b.due_date ?? "", text(b.client_name), text(b.client_gstin ?? ""),
        stateText(b), b.overdue ? "Yes" : "No", rupees(b.subtotal_paise), String(b.gst_rate_percent), rupees(b.gst_paise), rupees(b.total_paise),
        rupees(b.credited_paise), rupees(b.paid_paise), rupees(b.discount_paise), rupees(b.balance_paise), text(b.created_by_name),
      ];
    });
    sendCsv(res, `bills${fy !== null ? `-FY${fyLabelOf(fy)}` : ""}.csv`, [head, ...body]);
  });

  // Client statement: every bill, payment and credit note for one client in date order, with a running balance.
  // With ?fy=2025 it covers the bills of that financial year and everything recorded against them.
  router.get("/statement.csv", async (req, res) => {
    const clientId = Number(req.query.client_id);
    if (!Number.isInteger(clientId)) throw new HttpError(400, "client_id is required");
    const fy = readFy(req.query.fy);
    const client = (await db.query<{ name: string }>("SELECT name FROM clients WHERE id = $1", [clientId])).rows[0];
    if (!client) throw new HttpError(404, "Client not found");

    const bills = (
      await db.query<any>(
        `SELECT b.id, b.bill_no, b.bill_date::text AS bill_date, b.status, b.total_paise, b.cancelled_at::date::text AS cancelled_on
         FROM bills b
         WHERE b.client_id = $1
           AND ($2::int IS NULL OR b.fy_start = $2::int)`,
        [clientId, fy],
      )
    ).rows;
    const ids = bills.map((b: any) => b.id);
    const payments = ids.length
      ? (await db.query<any>("SELECT bill_id, paid_on::text AS paid_on, amount_paise, method, reference FROM payments WHERE bill_id = ANY($1::int[]) AND voided_at IS NULL", [ids])).rows
      : [];
    const credits = ids.length
      ? (await db.query<any>("SELECT bill_id, cn_no, cn_date::text AS cn_date, reason, total_paise FROM credit_notes WHERE bill_id = ANY($1::int[])", [ids])).rows
      : [];
    const discounts = ids.length
      ? (await db.query<any>("SELECT bill_id, given_on::text AS given_on, amount_paise, reason FROM discounts WHERE bill_id = ANY($1::int[]) AND voided_at IS NULL", [ids])).rows
      : [];
    const billNo = new Map<number, string>(bills.map((b: any) => [b.id, b.bill_no]));

    // Debit = the client owes more, credit = the client owes less.
    type Entry = { date: string; order: number; type: string; number: string; details: string; debit: number; credit: number };
    const entries: Entry[] = [];
    for (const b of bills) {
      entries.push({ date: b.bill_date, order: 0, type: "Bill", number: b.bill_no, details: "", debit: b.total_paise, credit: 0 });
      if (b.status === "cancelled") entries.push({ date: b.cancelled_on ?? b.bill_date, order: 3, type: "Cancelled", number: b.bill_no, details: "Bill cancelled", debit: 0, credit: b.total_paise });
    }
    for (const c of credits) entries.push({ date: c.cn_date, order: 1, type: "Credit note", number: c.cn_no, details: `${c.reason} (against ${billNo.get(c.bill_id)})`, debit: 0, credit: c.total_paise });
    for (const p of payments) entries.push({ date: p.paid_on, order: 2, type: "Payment", number: billNo.get(p.bill_id) ?? "", details: `${METHOD_LABELS[p.method as PaymentMethod] ?? p.method}${p.reference ? ` - ${p.reference}` : ""}`, debit: 0, credit: p.amount_paise });
    for (const d of discounts) entries.push({ date: d.given_on, order: 2.5, type: "Discount", number: billNo.get(d.bill_id) ?? "", details: d.reason, debit: 0, credit: d.amount_paise });
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.number.localeCompare(b.number));

    let balance = 0;
    const body = entries.map((e) => {
      balance += e.debit - e.credit;
      return [e.date, e.type, text(e.number), text(e.details), e.debit ? rupees(e.debit) : "", e.credit ? rupees(e.credit) : "", rupees(balance)];
    });
    body.push(["", "", "", "Balance due", "", "", rupees(balance)]);
    sendCsv(res, `statement-${safeFileName(client.name)}${fy !== null ? `-FY${fyLabelOf(fy)}` : ""}.csv`, [["Date", "Type", "Number", "Details", "Billed", "Received or credited", "Balance"], ...body]);
  });

  return router;
}
