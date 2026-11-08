import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { billSums, getCreditNote } from "../lib/billData.js";
import { billForSettling, feesStillDue } from "../lib/shortfall.js";
import { assertReasonableTotal, creditLineSchema } from "../lib/billInput.js";
import type { ClientFiles } from "../lib/clientFiles.js";
import { HttpError } from "../lib/errors.js";
import { todayISO } from "../lib/fy.js";
import { addHistory, rupeesText } from "../lib/history.js";
import { calculateTotals } from "../lib/money.js";
import { nextDocumentNumber } from "../lib/numbering.js";
import { requireAdmin } from "../middleware/auth.js";

const creditNoteSchema = z.object({
  cn_date: z.iso.date().nullish(),
  reason: z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(300),
  items: z.array(creditLineSchema).min(1, "Add at least one line to the credit note").max(100, "A credit note can have at most 100 lines"),
});

/**
 * Mounted at /api. A credit note corrects an issued bill without editing it: it reduces what the client owes,
 * and the bill itself stays exactly as it was issued. Admin only.
 */
export function creditNoteRoutes(db: Db, files: ClientFiles): Router {
  const router = Router();

  router.post("/bills/:id/credit-notes", requireAdmin, async (req, res) => {
    const billId = Number(req.params.id);
    const input = creditNoteSchema.parse(req.body);
    assertReasonableTotal(input.items);
    const today = todayISO();

    const id = await db.tx(async (q) => {
      const bill = (
        await q.query<{ status: string; total_paise: number; bill_date: string; gst_rate_percent: number; bill_no: string }>(
          "SELECT status, total_paise, bill_date::text AS bill_date, gst_rate_percent, bill_no FROM bills WHERE id = $1 FOR UPDATE",
          [billId],
        )
      ).rows[0];
      if (!bill) throw new HttpError(404, "Bill not found");
      if (bill.status === "cancelled") throw new HttpError(409, "A cancelled bill can't have credit notes");

      const cnDate = input.cn_date ?? today;
      if (cnDate < bill.bill_date) throw new HttpError(400, "The credit note date can't be before the bill date");
      if (cnDate > today) throw new HttpError(400, "The credit note date can't be in the future");

      // Same GST rate as the bill it corrects (the bill's stored rate, never the current setting).
      const totals = calculateTotals(input.items, bill.gst_rate_percent);
      if (totals.total_paise <= 0) throw new HttpError(400, "The credit note total must be more than zero");

      const sums = await billSums(q, billId);
      const balance = bill.total_paise - sums.credited - sums.paid - sums.discounted;
      if (balance <= 0) throw new HttpError(400, "This bill has nothing left to credit. If the client has already paid, void the payment first.");
      // A credit note reduces fees, never an amount the firm paid on the client's behalf.
      const feesDue = await feesStillDue(q, await billForSettling(q, billId));
      if (totals.total_paise > feesDue && feesDue < balance) {
        throw new HttpError(400, `A credit note can reduce at most the fees still unpaid (${rupeesText(feesDue)}). Amounts paid on the client's behalf can't be credited.`);
      }
      if (totals.total_paise > balance) {
        throw new HttpError(400, `A credit note can be for at most the amount still unpaid on this bill (${rupeesText(balance)}). If the client has already paid, void the payment first.`);
      }

      // The number is taken last, after every check has passed, and rolls back with this transaction if anything fails.
      const cnNo = await nextDocumentNumber(q, "CN", cnDate);
      const cn = (
        await q.query<{ id: number }>(
          `INSERT INTO credit_notes (cn_no, bill_id, cn_date, reason, subtotal_paise, gst_rate_percent, gst_paise, total_paise, created_by)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [cnNo, billId, cnDate, input.reason, totals.subtotal_paise, bill.gst_rate_percent, totals.gst_paise, totals.total_paise, req.user!.id],
        )
      ).rows[0];
      for (const i of input.items) {
        await q.query(
          `INSERT INTO credit_note_items (credit_note_id, description, details, quantity, unit_price_paise, line_total_paise)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cn.id, i.description, i.details, i.quantity, i.unit_price_paise, i.quantity * i.unit_price_paise],
        );
      }
      await addHistory(q, {
        billId, userId: req.user!.id, action: "credit_note_issued",
        summary: `Credit note ${cnNo} issued for ${rupeesText(totals.total_paise)}: ${input.reason}`,
      });
      return cn.id;
    });
    await files.syncBill(billId);
    res.status(201).json(await getCreditNote(db, id));
  });

  router.get("/credit-notes/:id", async (req, res) => {
    const cn = await getCreditNote(db, Number(req.params.id));
    if (!cn) throw new HttpError(404, "Credit note not found");
    res.json(cn);
  });

  return router;
}
