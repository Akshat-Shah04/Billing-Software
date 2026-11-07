import { Router, type Response } from "express";
import type { Db } from "../db/index.js";
import { getBill, getCreditNote } from "../lib/billData.js";
import { renderBillPdf, renderCreditNotePdf } from "../lib/documentPdf.js";
import { HttpError } from "../lib/errors.js";
import { safeFileName } from "../lib/format.js";
import { loadLogo, loadSettings } from "./settings.js";

function sendPdf(res: Response, pdf: Buffer, filename: string, inline: boolean) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  res
    .set("Content-Type", "application/pdf")
    .set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .set("Content-Length", String(pdf.length))
    .send(pdf);
}

/** Mounted at /api. PDF copies of bills and credit notes, to download or send. */
export function documentRoutes(db: Db): Router {
  const router = Router();

  async function firm() {
    const [org, logo] = await Promise.all([loadSettings(db), loadLogo(db)]);
    return { org, logo: logo ? { contentType: logo.contentType, data: logo.data } : null };
  }

  router.get("/bills/:id/pdf", async (req, res) => {
    const bill = await getBill(db, Number(req.params.id));
    if (!bill) throw new HttpError(404, "Bill not found");
    const { org, logo } = await firm();
    const pdf = await renderBillPdf(bill, org, logo);
    sendPdf(res, pdf, `Bill ${safeFileName(bill.bill_no)} - ${safeFileName(bill.client_name)}.pdf`, req.query.inline === "1");
  });

  router.get("/credit-notes/:id/pdf", async (req, res) => {
    const cn = await getCreditNote(db, Number(req.params.id));
    if (!cn) throw new HttpError(404, "Credit note not found");
    const { org, logo } = await firm();
    const pdf = await renderCreditNotePdf(cn, org, logo);
    sendPdf(res, pdf, `Credit note ${safeFileName(cn.cn_no)} - ${safeFileName(cn.client_name)}.pdf`, req.query.inline === "1");
  });

  return router;
}
