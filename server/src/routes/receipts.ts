import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { renderReceiptPdf } from "../lib/documentPdf.js";
import { esc } from "../lib/documentHtml.js";
import { HttpError } from "../lib/errors.js";
import { METHOD_LABELS, money, prettyDate, safeFileName, type PaymentMethod } from "../lib/format.js";
import { addHistory } from "../lib/history.js";
import type { Mailer } from "../lib/mailer.js";
import { getReceipt, receivedHow, type Receipt } from "../lib/receipt.js";
import { loadLogo, loadSettings, type Settings } from "./settings.js";

const emailSchema = z.object({
  /** Where to send it. Left out: the client's saved email address. */
  to: z.email("That doesn't look like an email address").max(200).nullish(),
});

/** The message that goes with a receipt (on WhatsApp the staff send it themselves; this is the email version). */
export function receiptMessage(r: Receipt, org: Settings): string[] {
  const how = receivedHow(r.method, METHOD_LABELS[r.method as PaymentMethod] ?? r.method, r.reference);
  return [
    `Dear ${r.client_name},`,
    "",
    `We acknowledge with thanks the receipt of ${money(r.amount_paise)} ${how} on ${prettyDate(r.paid_on)} towards bill ${r.bill_no} dated ${prettyDate(r.bill_date)}.`,
    r.kind === "full" ? `Bill ${r.bill_no} is now fully paid.` : `Balance still due on this bill: ${money(r.balance_after_paise)}.`,
    `Receipt No.: ${r.receipt_no} (attached as a PDF).`,
    "",
    "Thank you,",
    org.org_name || "",
  ];
}

const pdfName = (r: Receipt) => `Receipt ${safeFileName(r.receipt_no)} - ${safeFileName(r.client_name)}.pdf`;

/**
 * Mounted at /api. The acknowledgement receipt made for every payment:
 *   GET  /payments/:id/receipt          the receipt's details (JSON)
 *   GET  /payments/:id/receipt.pdf      the receipt as a PDF (?inline=1 to view in the browser)
 *   POST /payments/:id/receipt/email    emails the PDF to the client (or to { to })
 */
export function receiptRoutes(db: Db, mailer: Mailer): Router {
  const router = Router();

  async function load(id: string) {
    const r = await getReceipt(db, Number(id));
    if (!r) throw new HttpError(404, "Receipt not found");
    return r;
  }
  async function pdfOf(r: Receipt) {
    const [org, logo] = await Promise.all([loadSettings(db), loadLogo(db)]);
    return { org, pdf: await renderReceiptPdf(r, org, logo ? { contentType: logo.contentType, data: logo.data } : null) };
  }

  router.get("/payments/:id/receipt", async (req, res) => {
    res.json(await load(req.params.id));
  });

  router.get("/payments/:id/receipt.pdf", async (req, res) => {
    const r = await load(req.params.id);
    const { pdf } = await pdfOf(r);
    const filename = pdfName(r);
    res
      .set("Content-Type", "application/pdf")
      .set("Content-Disposition", `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .set("Content-Length", String(pdf.length))
      .send(pdf);
  });

  router.post("/payments/:id/receipt/email", async (req, res) => {
    const input = emailSchema.parse(req.body ?? {});
    const r = await load(req.params.id);
    if (r.voided_at) throw new HttpError(409, "This payment was voided, so its receipt can't be sent");
    const to = input.to || r.client_email;
    if (!to) throw new HttpError(400, `${r.client_name} has no email address saved. Add it to the client, or type the address to send to.`);
    const { org, pdf } = await pdfOf(r);
    const lines = receiptMessage(r, org);
    await mailer.send({
      to,
      subject: `Payment receipt ${r.receipt_no}${org.org_name ? ` from ${org.org_name}` : ""}`,
      text: lines.join("\n"),
      html: `<div style="font:15px/1.5 Segoe UI,Arial,sans-serif">${lines.map((l) => (l ? `<p style="margin:0 0 .4em">${esc(l)}</p>` : "<br>")).join("")}</div>`,
      attachments: [{ filename: pdfName(r), content: pdf, contentType: "application/pdf" }],
    });
    await addHistory(db, { billId: r.bill_id, userId: req.user!.id, action: "receipt_emailed", summary: `Receipt ${r.receipt_no} emailed to ${to}` });
    res.json({ sent_to: to });
  });

  return router;
}
