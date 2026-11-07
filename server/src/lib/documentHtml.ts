import type { Settings } from "../routes/settings.js";
import { METHOD_LABELS, fyLabelOf, money, paymentLines, prettyDate, prettyTimestamp, type PaymentMethod } from "./format.js";

// Self-contained HTML copies of a bill and of a credit note (used for the client folders). One file each,
// with the logo embedded, so it opens correctly on its own, offline, or when emailed.

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#1d2733;max-width:780px;margin:2rem auto;padding:0 1rem;position:relative}
h1{margin:0 0 .25rem;font-size:1.5rem} .m{color:#667085} .head{display:flex;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:.5rem;border-bottom:1px solid #d9dee6;vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;color:#667085} .n{text-align:right} .it{font-size:1.1rem;font-weight:700;line-height:1.3}
.d{color:#667085;font-size:.8rem;line-height:1.45;margin-top:.2rem;white-space:pre-line}
.t{margin:1rem 0 0 auto;width:320px} .t div{display:flex;justify-content:space-between;padding:.15rem 0}
.g{border-top:2px solid #1d2733;margin-top:.3rem;padding-top:.35rem;font-weight:700;font-size:1.1rem} .id{font-size:1.2rem;font-weight:700}
.logo{max-height:80px;max-width:260px;display:block;margin-bottom:.5rem}
.pay{margin-top:1.25rem;border:1px solid #d9dee6;border-radius:6px;padding:.75rem 1rem;break-inside:avoid}
.pt{width:auto;margin:.25rem 0 .5rem} .pt td{border:0;padding:.1rem 1rem .1rem 0}
.hist{margin-top:1.25rem;break-inside:avoid} .hist table{font-size:.9rem}
.tag{display:inline-block;margin-top:.3rem;padding:0 .6rem;border-radius:99px;font-size:.75rem;font-weight:700;letter-spacing:.04em}
.tag.paid{background:#e3f4eb;color:#167347} .tag.bad{background:#fdecea;color:#c0301f}
.stamp{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:5rem;font-weight:800;letter-spacing:.1em;color:rgba(192,48,31,.16);border:.35rem solid rgba(192,48,31,.16);padding:0 1.2rem;border-radius:.6rem;pointer-events:none}
.cancel{margin-top:1rem;padding:.6rem .8rem;border-radius:6px;background:#fdecea;color:#8e2a1f}
@page{margin:0}
@media print{body{margin:0;max-width:none;padding:14mm 16mm}}`;

function firmHeader(org: Settings, logoUri: string | null): string {
  return `<div>${logoUri ? `<img class="logo" src="${logoUri}" alt="">` : ""}<h1>${esc(org.org_name || "Invoice")}</h1>
<div class="m" style="white-space:pre-line">${esc(org.org_address)}</div>${org.org_gstin ? `<div class="m">GSTIN: ${esc(org.org_gstin)}</div>` : ""}</div>`;
}

function billedTo(d: any): string {
  return `<div style="margin-bottom:1rem"><div class="m">Billed to</div><strong>${esc(d.client_name)}</strong>
${d.client_address ? `<div style="white-space:pre-line">${esc(d.client_address)}</div>` : ""}
<div class="m">${esc([d.client_city, d.client_phone].filter(Boolean).join(" · "))}</div>
${d.client_gstin ? `<div class="m">GSTIN: ${esc(d.client_gstin)}</div>` : ""}${d.client_pan ? `<div class="m">PAN: ${esc(d.client_pan)}</div>` : ""}</div>`;
}

function itemsTable(items: any[]): string {
  const rows = items
    .map(
      (i) => `<tr><td><div class="it">${esc(i.description)}</div>${i.details ? `<div class="d">${esc(i.details)}</div>` : ""}</td>
<td class="n">${i.quantity}</td><td class="n">${money(i.unit_price_paise)}</td><td class="n">${money(i.line_total_paise)}</td></tr>`,
    )
    .join("\n");
  return `<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>
${rows}
</tbody></table>`;
}

function paymentBox(org: Settings): string {
  const pay = paymentLines(org);
  if (!pay.length && !org.payment_instructions) return "";
  return `<div class="pay"><div class="m">Payment details: please pay to</div>
<table class="pt">${pay.map(([k, v]) => `<tr><td class="m">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
${org.payment_instructions ? `<div style="white-space:pre-line">${esc(org.payment_instructions)}</div>` : ""}</div>`;
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
      ? `${bill.credited_paise > 0 ? `<div><span>Credit notes</span><span>− ${money(bill.credited_paise)}</span></div>` : ""}
${bill.paid_paise > 0 ? `<div><span>Paid</span><span>− ${money(bill.paid_paise)}</span></div>` : ""}
${bill.discount_paise > 0 ? `<div><span>Discount</span><span>− ${money(bill.discount_paise)}</span></div>` : ""}
<div class="g"><span>Balance due</span><span>${money(bill.balance_paise)}</span></div>`
      : "";

  const paymentsHtml = payments.length
    ? `<div class="hist"><div class="m">Payments received</div><table>${payments
        .map(
          (p: any) =>
            `<tr><td>${prettyDate(p.paid_on)}</td><td>${esc(METHOD_LABELS[p.method as PaymentMethod] ?? p.method)}${p.reference ? ` · ${esc(p.reference)}` : ""}</td><td class="n">${money(p.amount_paise)}</td></tr>`,
        )
        .join("")}</table></div>`
    : "";
  const creditsHtml = creditNotes.length
    ? `<div class="hist"><div class="m">Credit notes</div><table>${creditNotes
        .map((c: any) => `<tr><td>${esc(c.cn_no)}</td><td>${prettyDate(c.cn_date)}</td><td>${esc(c.reason)}</td><td class="n">${money(c.total_paise)}</td></tr>`)
        .join("")}</table></div>`
    : "";

  const body = `${cancelled ? '<div class="stamp">CANCELLED</div>' : ""}
<div class="head">${firmHeader(org, logoUri)}
<div style="text-align:right"><div class="id">${esc(bill.bill_no)}</div><div><strong>${prettyDate(bill.bill_date)}</strong></div>
<div class="m">Financial year ${fyLabelOf(bill.fy_start)}</div>${bill.due_date && !cancelled ? `<div class="m">Due ${prettyDate(bill.due_date)}</div>` : ""}
${cancelled ? '<div class="tag bad">CANCELLED</div>' : bill.state === "paid" ? '<div class="tag paid">PAID</div>' : ""}</div></div>
${billedTo(bill)}
${itemsTable(bill.items)}
<div class="t"><div><span>Subtotal</span><span>${money(bill.subtotal_paise)}</span></div>
${bill.gst_rate_percent > 0 ? `<div><span>GST @ ${bill.gst_rate_percent}%</span><span>${money(bill.gst_paise)}</span></div>` : ""}
<div class="g"><span>Total</span><span>${money(bill.total_paise)}</span></div>
${settleRows}</div>
${cancelled ? `<div class="cancel">This bill was cancelled on ${prettyTimestamp(bill.cancelled_at)}${bill.cancelled_by_name ? ` by ${esc(bill.cancelled_by_name)}` : ""}: ${esc(bill.cancel_reason)}</div>` : ""}
${bill.notes ? `<p style="white-space:pre-line"><span class="m">Notes</span><br>${esc(bill.notes)}</p>` : ""}
${paymentsHtml}
${creditsHtml}
${cancelled ? "" : paymentBox(org)}
<p class="m" style="font-size:.8rem">Created by ${esc(bill.created_by_name)}${bill.updated_by_name ? `, last edited by ${esc(bill.updated_by_name)}` : ""}.
This is an automatic copy kept for backup; the original is in Billing Software.</p>`;
  return page(`${bill.bill_no} - ${bill.client_name}`, body);
}

export function renderCreditNoteHtml(cn: any, org: Settings, logoUri: string | null = null): string {
  const body = `<div class="head">${firmHeader(org, logoUri)}
<div style="text-align:right"><div class="m" style="font-weight:700;letter-spacing:.08em">CREDIT NOTE</div><div class="id">${esc(cn.cn_no)}</div>
<div><strong>${prettyDate(cn.cn_date)}</strong></div>
<div class="m">Against bill ${esc(cn.bill_no)} dated ${prettyDate(cn.bill_date)}</div></div></div>
${billedTo(cn)}
${itemsTable(cn.items)}
<div class="t"><div><span>Subtotal</span><span>${money(cn.subtotal_paise)}</span></div>
${cn.gst_rate_percent > 0 ? `<div><span>GST @ ${cn.gst_rate_percent}%</span><span>${money(cn.gst_paise)}</span></div>` : ""}
<div class="g"><span>Credit total</span><span>${money(cn.total_paise)}</span></div></div>
<p style="white-space:pre-line"><span class="m">Reason</span><br>${esc(cn.reason)}</p>
<p class="m" style="font-size:.8rem">Issued by ${esc(cn.created_by_name)}. This credit note reduces the amount due on bill ${esc(cn.bill_no)}.
This is an automatic copy kept for backup; the original is in Billing Software.</p>`;
  return page(`${cn.cn_no} - ${cn.client_name}`, body);
}
