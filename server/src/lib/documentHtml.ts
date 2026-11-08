import type { Settings } from "../routes/settings.js";
import {
  METHOD_LABELS, dueLine, fyLongLabel, jurisdictionLine, money, paymentLines, prettyDate, prettyTimestamp, type PaymentMethod,
} from "./format.js";
import { amountInWords } from "./words.js";

// Self-contained HTML copies of a bill and of a credit note (used for the client folders). One file each,
// with the logo embedded, so it opens correctly on its own, offline, or when emailed. The layout matches the PDF:
// letterhead, "PROFESSIONAL INVOICE" with the bill's numbers, Sr./particulars/year/amount, the total in words,
// remarks, payment details, the signature block and the jurisdiction line.

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#1d2733;max-width:780px;margin:2rem auto;padding:0 1rem;position:relative}
.m{color:#667085} .lh{text-align:center;border-bottom:2px solid #1d2733;padding-bottom:.75rem;margin-bottom:1rem}
.lh h1{margin:0;font-size:1.6rem} .lh .tag-line{font-size:.75rem;font-weight:700;letter-spacing:.12em;color:#667085;text-transform:uppercase}
.lh .addr{white-space:pre-line} .lh .contact{font-weight:700}
.logo{max-height:70px;max-width:220px;display:block;margin:0 auto .5rem}
.party{display:flex;justify-content:space-between;gap:1rem;margin-bottom:1.25rem;align-items:flex-start}
.party .to{flex:1;min-width:0} .party .to strong{font-size:1.1rem}
.box{border:1px solid #aab2c0;border-radius:6px;padding:.6rem .8rem;min-width:240px}
.box .title{text-align:center;font-weight:800;letter-spacing:.04em;margin-bottom:.35rem}
.box table td{border:0;padding:.1rem 0} .box td:last-child{text-align:right;font-weight:700}
table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:.5rem;border-bottom:1px solid #d9dee6;vertical-align:top}
th{font-size:.75rem;text-transform:uppercase;color:#667085;border-bottom:1.5px solid #1d2733} .n{text-align:right;white-space:nowrap}
.it{font-size:1.1rem;font-weight:700;line-height:1.3} .d{color:#667085;font-size:.8rem;line-height:1.45;margin-top:.2rem;white-space:pre-line}
.t{margin:1rem 0 0 auto;width:320px} .t div{display:flex;justify-content:space-between;padding:.15rem 0}
.g{border-top:2px solid #1d2733;margin-top:.3rem;padding-top:.35rem;font-weight:700;font-size:1.1rem}
.words{display:flex;justify-content:space-between;gap:1rem;margin-top:1rem;font-weight:700}
.label{font-size:.72rem;font-weight:700;letter-spacing:.06em;color:#667085;text-transform:uppercase}
.pay{margin-top:1.25rem;border:1px solid #d9dee6;border-radius:6px;padding:.75rem 1rem;break-inside:avoid}
.pt{width:auto;margin:.25rem 0 .5rem} .pt td{border:0;padding:.1rem 1rem .1rem 0}
.hist{margin-top:1.25rem;break-inside:avoid} .hist table{font-size:.9rem}
.sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:2rem;break-inside:avoid}
.sign .who{text-align:right} .sign .line{border-top:1px solid #aab2c0;margin-top:2.6rem;padding-top:.2rem;min-width:200px}
.juris{text-align:center;color:#667085;font-size:.85rem;border-top:1px solid #d9dee6;margin-top:1rem;padding-top:.5rem}
.tag{display:inline-block;margin-top:.4rem;padding:0 .6rem;border-radius:99px;font-size:.75rem;font-weight:700;letter-spacing:.04em}
.tag.paid{background:#e3f4eb;color:#167347} .tag.bad{background:#fdecea;color:#c0301f}
.stamp{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:5rem;font-weight:800;letter-spacing:.1em;color:rgba(192,48,31,.16);border:.35rem solid rgba(192,48,31,.16);padding:0 1.2rem;border-radius:.6rem;pointer-events:none}
.cancel{margin-top:1rem;padding:.6rem .8rem;border-radius:6px;background:#fdecea;color:#8e2a1f}
.foot{font-size:.8rem;margin-top:1.5rem}
@page{margin:0}
@media print{body{margin:0;max-width:none;padding:14mm 16mm}.foot{display:none}}`;

function letterhead(org: Settings, logoUri: string | null): string {
  const contact = [org.org_mobile && `Mobile: ${esc(org.org_mobile)}`, org.org_gstin && `GSTIN: ${esc(org.org_gstin)}`].filter(Boolean).join(" &nbsp;·&nbsp; ");
  return `<div class="lh">${logoUri ? `<img class="logo" src="${logoUri}" alt="">` : ""}<h1>${esc(org.org_name || "Invoice")}</h1>
${org.org_tagline ? `<div class="tag-line">${esc(org.org_tagline)}</div>` : ""}
${org.org_address ? `<div class="addr">${esc(org.org_address)}</div>` : ""}
${contact ? `<div class="contact">${contact}</div>` : ""}</div>`;
}

function party(d: any, title: string, rows: [string, string][], tag = ""): string {
  const ids = [d.client_pan && `PAN: ${esc(d.client_pan)}`, d.client_gstin && `GSTIN: ${esc(d.client_gstin)}`].filter(Boolean).join(" &nbsp;·&nbsp; ");
  return `<div class="party"><div class="to"><div class="label">To</div><strong>${esc(d.client_name)}</strong>
${d.client_address ? `<div style="white-space:pre-line">${esc(d.client_address)}</div>` : ""}
${d.client_city ? `<div>${esc(d.client_city)}</div>` : ""}
${ids ? `<div><strong style="font-size:inherit">${ids}</strong></div>` : ""}
${d.client_phone ? `<div class="m">Mobile: ${esc(d.client_phone)}</div>` : ""}</div>
<div><div class="box"><div class="title">${esc(title)}</div><table>${rows.map(([k, v]) => `<tr><td class="m">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></div>
${tag ? `<div style="text-align:right">${tag}</div>` : ""}</div></div>`;
}

function itemsTable(items: any[], o: { heading: string; year: boolean }): string {
  const rows = items
    .map((i, n) => {
      const extra = [i.details ? esc(i.details) : "", i.quantity > 1 ? `${i.quantity} × ${money(i.unit_price_paise)}` : ""].filter(Boolean).join("\n");
      return `<tr><td>${n + 1}</td><td><div class="it">${esc(i.description)}</div>${extra ? `<div class="d">${extra}</div>` : ""}</td>
${o.year ? `<td class="n">${i.fy_start ? fyLongLabel(i.fy_start) : ""}</td>` : ""}<td class="n"><strong>${money(i.line_total_paise)}</strong></td></tr>`;
    })
    .join("\n");
  return `<table><thead><tr><th style="width:2.5rem">Sr.</th><th>${esc(o.heading)}</th>${o.year ? '<th class="n">Year</th>' : ""}<th class="n">Amount (₹)</th></tr></thead><tbody>
${rows}
</tbody></table>`;
}

function totalsBlock(d: any, label: string): string {
  const pob = d.reimbursement_paise ?? 0;
  return `<div class="t">${d.gst_rate_percent > 0 || pob > 0 ? `<div><span>Fees</span><span>${money(d.subtotal_paise)}</span></div>` : ""}${
    d.gst_rate_percent > 0 ? `<div><span>GST @ ${d.gst_rate_percent}% (on fees)</span><span>${money(d.gst_paise)}</span></div>` : ""
  }${pob > 0 ? `<div><span>Paid on your behalf</span><span>${money(pob)}</span></div>` : ""}<div class="g"><span>${esc(pob > 0 && label === "Total" ? "Total payable" : label)}</span><span>${money(d.total_paise)}</span></div></div>
<div class="words"><div><div class="label">Amount in words</div>${esc(amountInWords(d.total_paise))}</div><div class="m">E.&amp; O.E.</div></div>`;
}

function remarks(lines: string[]): string {
  const text = lines.filter(Boolean).map(esc).join("\n");
  return text ? `<p style="white-space:pre-line;margin-top:1.25rem"><span class="label">Remarks</span><br>${text}</p>` : "";
}

function paymentBox(org: Settings): string {
  const pay = paymentLines(org);
  if (!pay.length && !org.payment_instructions) return "";
  return `<div class="pay"><div class="label">Payment details: please pay to</div>
<table class="pt">${pay.map(([k, v]) => `<tr><td class="m">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
${org.payment_instructions ? `<div style="white-space:pre-line">${esc(org.payment_instructions)}</div>` : ""}</div>`;
}

function signOff(org: Settings): string {
  const j = jurisdictionLine(org);
  return `<div class="sign"><div>${org.org_state ? `<strong>State: ${esc(org.org_state)}</strong>` : ""}</div>
<div class="who"><strong>For, ${esc(org.org_name || "the firm")}</strong><div class="line">${org.signatory_name ? `<strong>${esc(org.signatory_name)}</strong><div class="m" style="font-size:.8rem">Authorised Signatory</div>` : "Authorised Signatory"}</div></div></div>
${j ? `<div class="juris">${esc(j)}</div>` : ""}`;
}

const page = (title: string, body: string) =>
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}
</style></head><body>
${body}
</body></html>
`;

export function renderBillHtml(bill: any, org: Settings, logoUri: string | null = null): string {
  const cancelled = bill.status === "cancelled";
  const payments = (bill.payments ?? []).filter((p: any) => !p.voided_at);
  const creditNotes = bill.credit_notes ?? [];

  const settleRows =
    bill.credited_paise > 0 || bill.paid_paise > 0 || bill.discount_paise > 0
      ? `<div class="t">${bill.credited_paise > 0 ? `<div><span>Credit notes</span><span>− ${money(bill.credited_paise)}</span></div>` : ""}
${bill.paid_paise > 0 ? `<div><span>Paid</span><span>− ${money(bill.paid_paise)}</span></div>` : ""}
${bill.discount_paise > 0 ? `<div><span>Discount</span><span>− ${money(bill.discount_paise)}</span></div>` : ""}
<div class="g"><span>Balance due</span><span>${money(bill.balance_paise)}</span></div></div>`
      : "";

  const paymentsHtml = payments.length
    ? `<div class="hist"><div class="label">Payments received</div><table>${payments
        .map(
          (p: any) =>
            `<tr><td>${prettyDate(p.paid_on)}</td><td>${esc(METHOD_LABELS[p.method as PaymentMethod] ?? p.method)}${p.reference ? ` · ${esc(p.reference)}` : ""}</td><td class="n">${money(p.amount_paise)}</td></tr>`,
        )
        .join("")}</table></div>`
    : "";
  const creditsHtml = creditNotes.length
    ? `<div class="hist"><div class="label">Credit notes</div><table>${creditNotes
        .map((c: any) => `<tr><td>${esc(c.cn_no)}</td><td>${prettyDate(c.cn_date)}</td><td>${esc(c.reason)}</td><td class="n">${money(c.total_paise)}</td></tr>`)
        .join("")}</table></div>`
    : "";

  const tag = cancelled ? '<span class="tag bad">CANCELLED</span>' : bill.state === "paid" ? '<span class="tag paid">PAID</span>' : "";
  const rows: [string, string][] = [["Bill No.", bill.bill_no], ["Date", prettyDate(bill.bill_date)]];
  if (bill.client_file_no) rows.push(["File No.", bill.client_file_no]);

  const body = `${cancelled ? '<div class="stamp">CANCELLED</div>' : ""}
${letterhead(org, logoUri)}
${party(bill, "PROFESSIONAL INVOICE", rows, tag)}
${itemsTable(bill.items.filter((i: any) => i.kind !== "reimbursement"), { heading: "Being the charges for services rendered", year: true })}
${bill.items.some((i: any) => i.kind === "reimbursement") ? `<div style="margin-top:1rem">${itemsTable(bill.items.filter((i: any) => i.kind === "reimbursement"), { heading: "Paid on your behalf (no GST)", year: false })}</div>` : ""}
${totalsBlock(bill, "Total")}
${settleRows}
${cancelled ? `<div class="cancel">This bill was cancelled on ${prettyTimestamp(bill.cancelled_at)}${bill.cancelled_by_name ? ` by ${esc(bill.cancelled_by_name)}` : ""}: ${esc(bill.cancel_reason)}</div>` : ""}
${remarks([cancelled ? "" : dueLine(bill.due_date), bill.notes ?? ""])}
${paymentsHtml}
${creditsHtml}
${cancelled ? "" : paymentBox(org)}
${signOff(org)}
<p class="m foot">Created by ${esc(bill.created_by_name)}${bill.updated_by_name ? `, last edited by ${esc(bill.updated_by_name)}` : ""}.
This is an automatic copy kept for backup; the original is in Billing Software.</p>`;
  return page(`${bill.bill_no} - ${bill.client_name}`, body);
}

export function renderCreditNoteHtml(cn: any, org: Settings, logoUri: string | null = null): string {
  const rows: [string, string][] = [
    ["Credit note No.", cn.cn_no],
    ["Date", prettyDate(cn.cn_date)],
    ["Against bill", cn.bill_no],
    ["Bill date", prettyDate(cn.bill_date)],
  ];
  if (cn.client_file_no) rows.push(["File No.", cn.client_file_no]);
  const body = `${letterhead(org, logoUri)}
${party(cn, "CREDIT NOTE", rows)}
${itemsTable(cn.items, { heading: "Particulars", year: false })}
${totalsBlock(cn, "Credit total")}
${remarks([`Reason: ${cn.reason}`, `This credit note reduces the amount due on bill ${cn.bill_no}.`])}
${signOff(org)}
<p class="m foot">Issued by ${esc(cn.created_by_name)}. This is an automatic copy kept for backup; the original is in Billing Software.</p>`;
  return page(`${cn.cn_no} - ${cn.client_name}`, body);
}
