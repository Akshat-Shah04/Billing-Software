import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { billSums, getBill } from "../lib/billData.js";
import type { ClientFiles } from "../lib/clientFiles.js";
import { HttpError } from "../lib/errors.js";
import { METHOD_LABELS, PAYMENT_METHODS } from "../lib/format.js";
import { todayISO } from "../lib/fy.js";
import { addHistory, rupeesText } from "../lib/history.js";
import { billForSettling, DEFAULT_SETTLE_REASON, settleShortfall } from "../lib/shortfall.js";
import { optionalText } from "../lib/paging.js";
import { requireAdmin } from "../middleware/auth.js";

const paymentSchema = z.object({
  amount_paise: z.number().int().min(1, "must be more than zero").max(1_000_000_000_000),
  paid_on: z.iso.date().nullish(),
  method: z.enum(PAYMENT_METHODS, "Choose how it was paid: cash, UPI, bank transfer, cheque, card or other"),
  reference: optionalText(100),
  notes: optionalText(300),
  /**
   * The client paid less than the balance and the firm agrees to accept it: the rest is recorded as a discount
   * in the same step, and the bill is settled. Left out or false: the rest simply stays due.
   */
  settle_rest: z.boolean().optional(),
  /** Why the rest was let go (kept in the history). Defaults to "Client paid less by agreement". */
  discount_reason: optionalText(300),
  /**
   * How the rest is settled: a GST credit note (reduces the GST too) or a plain discount (GST unchanged).
   * Left out: a credit note when the bill charged GST, otherwise a discount.
   */
  settle_as: z.enum(["discount", "credit_note"]).optional(),
});

const settleSchema = z.object({
  settle_as: z.enum(["discount", "credit_note"]).optional(),
  reason: optionalText(300),
  on: z.iso.date().nullish(),
});

const discountSchema = z.object({
  amount_paise: z.number().int().min(1, "must be more than zero").max(1_000_000_000_000),
  given_on: z.iso.date().nullish(),
  reason: z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(300),
});


const voidSchema = z.object({
  reason: z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(300),
});

/** Mounted at /api. Payments are never deleted: a wrong one is voided and stays on the record. */
export function paymentRoutes(db: Db, files: ClientFiles): Router {
  const router = Router();

  router.post("/bills/:id/payments", async (req, res) => {
    const id = Number(req.params.id);
    const input = paymentSchema.parse(req.body);
    const paidOn = input.paid_on ?? todayISO();
    if (paidOn > todayISO()) throw new HttpError(400, "The payment date can't be in the future");

    await db.tx(async (q) => {
      const bill = (await q.query<{ status: string; total_paise: number; bill_no: string }>("SELECT status, total_paise, bill_no FROM bills WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!bill) throw new HttpError(404, "Bill not found");
      if (bill.status === "cancelled") throw new HttpError(409, "A cancelled bill can't take payments");

      const sums = await billSums(q, id);
      const balance = bill.total_paise - sums.credited - sums.paid - sums.discounted;
      if (balance <= 0) throw new HttpError(400, "This bill has nothing left to pay");
      if (input.amount_paise > balance) throw new HttpError(400, `That is more than the balance due (${rupeesText(balance)})`);
      const rest = balance - input.amount_paise;

      await q.query(
        `INSERT INTO payments (bill_id, amount_paise, paid_on, method, reference, notes, created_by)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7)`,
        [id, input.amount_paise, paidOn, input.method, input.reference, input.notes, req.user!.id],
      );
      await addHistory(q, {
        billId: id, userId: req.user!.id, action: "payment_added",
        summary: `Payment of ${rupeesText(input.amount_paise)} by ${METHOD_LABELS[input.method]}${input.reference ? ` (${input.reference})` : ""}`,
      });
      // Settling: the client paid less and the firm accepts it. The rest is settled the way the user chose, dated with the payment.
      if (input.settle_rest && rest > 0) {
        const full = await billForSettling(q, id);
        await settleShortfall(q, {
          bill: full, amount: rest, on: paidOn, reason: input.discount_reason || DEFAULT_SETTLE_REASON, userId: req.user!.id,
          as: input.settle_as ?? (full.gst_rate_percent > 0 ? "credit_note" : "discount"),
        });
      }
    });
    await files.syncBill(id);
    res.status(201).json(await getBill(db, id));
  });

  // A discount on its own: the client is not going to pay the rest (e.g. paid 12,000 earlier, the last 3,000 is let go).
  router.post("/bills/:id/discounts", async (req, res) => {
    const id = Number(req.params.id);
    const input = discountSchema.parse(req.body);
    const givenOn = input.given_on ?? todayISO();
    if (givenOn > todayISO()) throw new HttpError(400, "The discount date can't be in the future");
    await db.tx(async (q) => {
      const bill = (await q.query<{ status: string; total_paise: number }>("SELECT status, total_paise FROM bills WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!bill) throw new HttpError(404, "Bill not found");
      if (bill.status === "cancelled") throw new HttpError(409, "A cancelled bill can't have a discount");
      const sums = await billSums(q, id);
      const balance = bill.total_paise - sums.credited - sums.paid - sums.discounted;
      if (balance <= 0) throw new HttpError(400, "This bill has nothing left to pay");
      if (input.amount_paise > balance) throw new HttpError(400, `A discount can be at most the balance due (${rupeesText(balance)})`);
      await q.query(
        "INSERT INTO discounts (bill_id, amount_paise, given_on, reason, created_by) VALUES ($1, $2, $3::date, $4, $5)",
        [id, input.amount_paise, givenOn, input.reason, req.user!.id],
      );
      await addHistory(q, { billId: id, userId: req.user!.id, action: "discount_given", summary: `Discount of ${rupeesText(input.amount_paise)} given: ${input.reason}` });
    });
    await files.syncBill(id);
    res.status(201).json(await getBill(db, id));
  });

  // Settle whatever is still due, without a new payment (the client has paid what they will pay).
  router.post("/bills/:id/settle", async (req, res) => {
    const id = Number(req.params.id);
    const input = settleSchema.parse(req.body);
    const on = input.on ?? todayISO();
    if (on > todayISO()) throw new HttpError(400, "The date can't be in the future");
    await db.tx(async (q) => {
      const bill = (await q.query<{ status: string; total_paise: number }>("SELECT status, total_paise FROM bills WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!bill) throw new HttpError(404, "Bill not found");
      if (bill.status === "cancelled") throw new HttpError(409, "This bill has been cancelled");
      const sums = await billSums(q, id);
      const balance = bill.total_paise - sums.credited - sums.paid - sums.discounted;
      if (balance <= 0) throw new HttpError(400, "This bill has nothing left to pay");
      const full = await billForSettling(q, id);
      await settleShortfall(q, {
        bill: full, amount: balance, on, reason: input.reason || DEFAULT_SETTLE_REASON, userId: req.user!.id,
        as: input.settle_as ?? (full.gst_rate_percent > 0 ? "credit_note" : "discount"),
      });
    });
    await files.syncBill(id);
    res.json(await getBill(db, id));
  });

  // A wrong discount is voided, not deleted: the amount is owed again. Admin only.
  router.post("/discounts/:id/void", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = voidSchema.parse(req.body);
    const billId = await db.tx(async (q) => {
      const d = (
        await q.query<{ bill_id: number; amount_paise: number; voided_at: string | null }>(
          "SELECT bill_id, amount_paise, voided_at FROM discounts WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!d) throw new HttpError(404, "Discount not found");
      if (d.voided_at) throw new HttpError(409, "This discount has already been voided");
      await q.query("UPDATE discounts SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1", [id, req.user!.id, reason]);
      await addHistory(q, { billId: d.bill_id, userId: req.user!.id, action: "discount_voided", summary: `Discount of ${rupeesText(d.amount_paise)} voided: ${reason}` });
      return d.bill_id;
    });
    await files.syncBill(billId);
    res.json(await getBill(db, billId));
  });

  // A wrong payment is voided, not deleted. Admin only.
  router.post("/payments/:id/void", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const { reason } = voidSchema.parse(req.body);
    const billId = await db.tx(async (q) => {
      const p = (
        await q.query<{ bill_id: number; amount_paise: number; voided_at: string | null }>(
          "SELECT bill_id, amount_paise, voided_at FROM payments WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!p) throw new HttpError(404, "Payment not found");
      if (p.voided_at) throw new HttpError(409, "This payment has already been voided");
      await q.query("UPDATE payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1", [id, req.user!.id, reason]);
      await addHistory(q, { billId: p.bill_id, userId: req.user!.id, action: "payment_voided", summary: `Payment of ${rupeesText(p.amount_paise)} voided: ${reason}` });
      return p.bill_id;
    });
    await files.syncBill(billId);
    res.json(await getBill(db, billId));
  });

  return router;
}
