import { Router, type Response } from "express";
import type { Db } from "../db/index.js";
import { renderFeesReportPdf, renderLedgerPdf } from "../lib/documentPdf.js";
import { HttpError } from "../lib/errors.js";
import { buildFeesReport } from "../lib/feesReport.js";
import { feesReportXlsx } from "../lib/feesReportXlsx.js";
import { safeFileName } from "../lib/format.js";
import { buildLedger, readRange } from "../lib/ledger.js";
import { requireAdmin } from "../middleware/auth.js";
import { loadLogo, loadSettings } from "./settings.js";

function sendFile(res: Response, data: Buffer, filename: string, type: string, inline = false) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  res
    .set("Content-Type", type)
    .set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .set("Content-Length", String(data.length))
    .send(data);
}

const readId = (v: unknown, name: string): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a number`);
  return n;
};

/**
 * Mounted at /api/reports.
 *   GET /ledger?client_id= | group_id= &from=&to=     a client's or a group's ledger account (JSON)
 *   GET /ledger.pdf?...                                the same, as a PDF to send to the client
 *   GET /fees?from=&to=&group_id=                      the fees report (JSON)        admin only
 *   GET /fees.xlsx?... and /fees.pdf?...               the fees report as Excel/PDF  admin only
 * Dates are YYYY-MM-DD; the range defaults to the current financial year so far.
 */
export function reportRoutes(db: Db): Router {
  const router = Router();

  const firm = async () => {
    const [org, logo] = await Promise.all([loadSettings(db), loadLogo(db)]);
    return { org, logo: logo ? { contentType: logo.contentType, data: logo.data } : null };
  };
  const ledgerFor = (query: Record<string, unknown>) =>
    buildLedger(db, { clientId: readId(query.client_id, "client_id"), groupId: readId(query.group_id, "group_id"), ...readRange(query) });

  router.get("/ledger", async (req, res) => {
    res.json(await ledgerFor(req.query));
  });

  router.get("/ledger.pdf", async (req, res) => {
    const ledger = await ledgerFor(req.query);
    const { org, logo } = await firm();
    const pdf = await renderLedgerPdf(ledger, org, logo);
    sendFile(res, pdf, `Statement of account - ${safeFileName(ledger.name)} - as on ${ledger.to}.pdf`, "application/pdf", req.query.inline === "1");
  });

  const feesFor = (query: Record<string, unknown>) => buildFeesReport(db, { ...readRange(query), groupId: readId(query.group_id, "group_id") });
  const reportName = (r: { from: string; to: string; group_name: string | null }, ext: string) =>
    `Fees report ${r.from} to ${r.to}${r.group_name ? ` - ${safeFileName(r.group_name)}` : ""}.${ext}`;

  router.get("/fees", requireAdmin, async (req, res) => {
    res.json(await feesFor(req.query));
  });

  router.get("/fees.xlsx", requireAdmin, async (req, res) => {
    const report = await feesFor(req.query);
    const { org } = await firm();
    sendFile(res, await feesReportXlsx(report, org), reportName(report, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  router.get("/fees.pdf", requireAdmin, async (req, res) => {
    const report = await feesFor(req.query);
    const { org, logo } = await firm();
    sendFile(res, await renderFeesReportPdf(report, org, logo), reportName(report, "pdf"), "application/pdf", req.query.inline === "1");
  });

  return router;
}
