import ExcelJS from "exceljs";
import type { Settings } from "../routes/settings.js";
import type { FeesReport } from "./feesReport.js";
import { prettyDate } from "./format.js";

/**
 * The fees report as an Excel workbook with four sheets: Summary, Month by month, Bills and Receipts.
 * Amounts are real numbers in rupees (so they can be added up and filtered), dates are real dates,
 * headers stay in view while scrolling, and the Bills sheet has filters on every column.
 */

const RUPEES = '#,##0.00;[Red]-#,##0.00';
const r = (paise: number) => paise / 100;
const asDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0071E3" } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
}

function styleTotal(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.border = { top: { style: "thin" } };
}

export async function feesReportXlsx(rep: FeesReport, org: Settings): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = org.org_name || "Billing Software";
  wb.created = new Date();
  const period = `${prettyDate(rep.from)} to ${prettyDate(rep.to)}${rep.group_name ? ` · Group: ${rep.group_name}` : ""}`;
  const s = rep.summary;

  // ---- Summary
  const sum = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 38 }, { width: 22 }];
  sum.addRow([org.org_name || "Fees report"]).font = { bold: true, size: 14 };
  sum.addRow(["Fees report"]).font = { bold: true, size: 12 };
  sum.addRow([period]).font = { color: { argb: "FF6E6E73" } };
  sum.addRow([]);
  // [label, value, bold, is a count (not rupees)]
  const lines: [string, number, boolean?, boolean?][] = [
    ["Bills issued", s.bills, false, true],
    ["Cancelled bills (not counted)", s.cancelled, false, true],
    ["Fees (the firm's income)", r(s.fees_paise), true],
    ["GST charged", r(s.gst_paise)],
    ["Paid on clients' behalf (not income)", r(s.reimbursement_paise)],
    ["Total billed", r(s.total_paise), true],
    ["Received", r(s.received_paise), true],
    ["   of which towards fees and GST", r(s.fees_received_paise)],
    ["   of which paid back to the firm (on behalf)", r(s.reimbursed_paise)],
    ["Credit notes", r(s.credited_paise)],
    ["Discounts", r(s.discount_paise)],
    ["Outstanding", r(s.outstanding_paise), true],
    ["Receipts dated in this period", s.receipts, false, true],
    ["Collected in this period (by receipt date, any bill)", r(s.collected_paise), true],
  ];
  for (const [label, value, bold, isCount] of lines) {
    const row = sum.addRow([label, value]);
    if (!isCount) row.getCell(2).numFmt = RUPEES;
    if (bold) row.font = { bold: true };
  }
  sum.addRow([]);
  sum.addRow(["Amounts in rupees. GST and amounts paid on clients' behalf are not income. Cancelled bills are listed on the Bills sheet but not counted."]).font = { italic: true, color: { argb: "FF6E6E73" } };

  // ---- Month by month
  const mon = wb.addWorksheet("Month by month", { views: [{ state: "frozen", ySplit: 1 }] });
  mon.columns = [
    { header: "Month", key: "month", width: 14 },
    { header: "Bills", key: "bills", width: 8 },
    { header: "Fees", key: "fees", width: 16, style: { numFmt: RUPEES } },
    { header: "GST", key: "gst", width: 14, style: { numFmt: RUPEES } },
    { header: "Paid on behalf", key: "pob", width: 16, style: { numFmt: RUPEES } },
    { header: "Received (on these bills)", key: "received", width: 16, style: { numFmt: RUPEES } },
    { header: "Collected (by receipt date)", key: "collected", width: 18, style: { numFmt: RUPEES } },
  ];
  styleHeader(mon.getRow(1));
  for (const m of rep.months) mon.addRow({ month: m.month, bills: m.bills, fees: r(m.fees_paise), gst: r(m.gst_paise), pob: r(m.reimbursement_paise), received: r(m.received_paise), collected: r(m.collected_paise) });
  styleTotal(mon.addRow({ month: "Total", bills: s.bills, fees: r(s.fees_paise), gst: r(s.gst_paise), pob: r(s.reimbursement_paise), received: r(s.received_paise), collected: r(s.collected_paise) }));

  // ---- Bills
  const bills = wb.addWorksheet("Bills", { views: [{ state: "frozen", ySplit: 1 }] });
  bills.columns = [
    { header: "Bill no.", key: "no", width: 14 },
    { header: "Date", key: "date", width: 12, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "Client", key: "client", width: 30 },
    { header: "Group", key: "group", width: 18 },
    { header: "Fees", key: "fees", width: 14, style: { numFmt: RUPEES } },
    { header: "GST", key: "gst", width: 12, style: { numFmt: RUPEES } },
    { header: "Paid on behalf", key: "pob", width: 15, style: { numFmt: RUPEES } },
    { header: "Total", key: "total", width: 14, style: { numFmt: RUPEES } },
    { header: "Received", key: "received", width: 14, style: { numFmt: RUPEES } },
    { header: "Last paid on", key: "paidOn", width: 13, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "Credit notes / discounts", key: "reduced", width: 14, style: { numFmt: RUPEES } },
    { header: "Balance", key: "balance", width: 14, style: { numFmt: RUPEES } },
    { header: "Status", key: "status", width: 12 },
  ];
  styleHeader(bills.getRow(1));
  for (const b of rep.rows) {
    const row = bills.addRow({
      no: b.bill_no, date: asDate(b.bill_date), client: b.client_name, group: b.group_name ?? "", fees: r(b.fees_paise), gst: r(b.gst_paise),
      pob: r(b.reimbursement_paise), total: r(b.total_paise), received: r(b.received_paise), paidOn: b.last_paid_on ? asDate(b.last_paid_on) : null, reduced: r(b.reduced_paise),
      balance: b.cancelled ? 0 : r(b.balance_paise), status: b.status,
    });
    if (b.cancelled) row.font = { color: { argb: "FF8E8E93" }, strike: true };
  }
  bills.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rep.rows.length + 1), column: 13 } };
  styleTotal(bills.addRow({
    no: "Total (excluding cancelled)", fees: r(s.fees_paise), gst: r(s.gst_paise), pob: r(s.reimbursement_paise), total: r(s.total_paise),
    received: r(s.received_paise), reduced: r(s.credited_paise + s.discount_paise), balance: r(s.outstanding_paise),
  }));

  // ---- Receipts (money received in the period, by the date it came in)
  const rec = wb.addWorksheet("Receipts", { views: [{ state: "frozen", ySplit: 1 }] });
  rec.columns = [
    { header: "Receipt no.", key: "no", width: 18 },
    { header: "Date received", key: "date", width: 14, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "Client", key: "client", width: 30 },
    { header: "Group", key: "group", width: 18 },
    { header: "Bill no.", key: "bill", width: 14 },
    { header: "Bill date", key: "billDate", width: 12, style: { numFmt: "dd-mmm-yyyy" } },
    { header: "How paid", key: "method", width: 14 },
    { header: "Reference", key: "ref", width: 22 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: RUPEES } },
  ];
  styleHeader(rec.getRow(1));
  for (const x of rep.receipts) {
    rec.addRow({ no: x.receipt_no, date: asDate(x.paid_on), client: x.client_name, group: x.group_name ?? "", bill: x.bill_no, billDate: asDate(x.bill_date), method: x.method, ref: x.reference ?? "", amount: r(x.amount_paise) });
  }
  rec.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rep.receipts.length + 1), column: 9 } };
  styleTotal(rec.addRow({ no: "Total", amount: r(s.collected_paise) }));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
