import type { Queryable } from "../db/index.js";
import { billSums } from "./billData.js";
import { HttpError } from "./errors.js";
import { fyLabel, prettyDateOf } from "./fy.js";
import { addHistory, rupeesText } from "./history.js";
import { nextDocumentNumber } from "./numbering.js";

/**
 * Settling a bill when the client pays less than the balance and the firm accepts it.
 *
 * Two ways, chosen by the user at that moment (nothing is assumed in advance):
 *   "credit_note" - a GST credit note for the shortfall. GST on a bill is due on the invoice value, and the only way to
 *                   bring it down to what was actually received is a credit note against that invoice (Section 34,
 *                   CGST Act). The shortfall is split back into fee + GST at the bill's own rate, so the credit note
 *                   total is EXACTLY the shortfall and the bill ends at zero.
 *   "discount"    - a plain discount in the firm's books. The GST already charged is not reduced. Fine for a bill
 *                   without GST, or once the credit note deadline has passed.
 */
export type SettleAs = "discount" | "credit_note";
export const DEFAULT_SETTLE_REASON = "Client paid less by agreement";

/**
 * Last day a GST credit note can still reduce the GST of a financial year's invoices: 30 November after the year
 * ends (the earlier annual-return date can make it sooner; that is the firm's to watch). 2026 (FY 2026-27) -> 2027-11-30.
 */
export const creditNoteDeadline = (fyStart: number): string => `${fyStart + 1}-11-30`;

/** Splits a GST-inclusive amount into fee + GST at `ratePercent`, in whole paise, with fee + GST exactly equal to it. */
export function splitInclusive(totalPaise: number, ratePercent: number): { subtotal_paise: number; gst_paise: number } {
  const rateBp = Math.round(ratePercent * 100);
  const subtotal = Math.round((totalPaise * 10000) / (10000 + rateBp));
  return { subtotal_paise: subtotal, gst_paise: totalPaise - subtotal };
}

interface BillRow {
  id: number;
  bill_no: string;
  bill_date: string;
  fy_start: number;
  gst_rate_percent: number;
  subtotal_paise: number;
  gst_paise: number;
  reimbursement_paise: number;
}

/**
 * How much of a bill's FEES (fees + GST) is still unpaid. Payments go towards the amount paid on the client's behalf
 * first, so fees are only paid once that is fully recovered. Credit notes and discounts reduce fees.
 */
export async function feesStillDue(q: Queryable, bill: BillRow): Promise<number> {
  const sums = await billSums(q, bill.id);
  const feesPaid = Math.max(0, sums.paid - bill.reimbursement_paise);
  return Math.max(0, bill.subtotal_paise + bill.gst_paise - sums.credited - sums.discounted - feesPaid);
}

/** Loads the bill fields needed to settle it (call inside the transaction, after locking the bill). */
export async function billForSettling(q: Queryable, billId: number): Promise<BillRow> {
  return (
    await q.query<BillRow>(
      "SELECT id, bill_no, bill_date::text AS bill_date, fy_start, gst_rate_percent, subtotal_paise, gst_paise, reimbursement_paise FROM bills WHERE id = $1",
      [billId],
    )
  ).rows[0];
}

/**
 * Records `amount` as settled on the bill, as a discount or a credit note. Call inside the same transaction that
 * checked the balance. Returns the credit note number when one was issued.
 */
export async function settleShortfall(
  q: Queryable,
  o: { bill: BillRow; amount: number; on: string; as: SettleAs; reason: string; userId: number },
): Promise<{ cn_no: string | null }> {
  const { bill, amount, reason, userId } = o;

  if (o.as === "discount") {
    await q.query(
      "INSERT INTO discounts (bill_id, amount_paise, given_on, reason, created_by) VALUES ($1, $2, $3::date, $4, $5)",
      [bill.id, amount, o.on, reason, userId],
    );
    await addHistory(q, { billId: bill.id, userId, action: "discount_given", summary: `Discount of ${rupeesText(amount)} given: ${reason}` });
    return { cn_no: null };
  }

  // A credit note reduces FEES. If the shortfall is more than the fees still unpaid, the rest is money the firm paid on
  // the client's behalf and will not get back: that part is recorded as a discount (it carries no GST to reduce).
  const feesDue = await feesStillDue(q, bill);
  if (amount > feesDue) {
    const unrecovered = amount - feesDue;
    await settleShortfall(q, { ...o, amount: unrecovered, as: "discount", reason: `${reason} (amount paid on your behalf, not recovered)` });
    if (feesDue === 0) return { cn_no: null };
    return settleShortfall(q, { ...o, amount: feesDue });
  }

  // A credit note can't be dated before the bill it corrects.
  const cnDate = o.on < bill.bill_date ? bill.bill_date : o.on;
  const deadline = creditNoteDeadline(bill.fy_start);
  if (bill.gst_rate_percent > 0 && cnDate > deadline) {
    throw new HttpError(
      400,
      `The last day for a GST credit note on FY ${fyLabel(bill.fy_start)} bills was ${prettyDateOf(deadline)}, so the GST can no longer be reduced. Settle the rest as a discount instead.`,
    );
  }

  const split = splitInclusive(amount, bill.gst_rate_percent);
  const cnNo = await nextDocumentNumber(q, "CN", cnDate);
  const cn = (
    await q.query<{ id: number }>(
      `INSERT INTO credit_notes (cn_no, bill_id, cn_date, reason, subtotal_paise, gst_rate_percent, gst_paise, total_paise, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [cnNo, bill.id, cnDate, reason, split.subtotal_paise, bill.gst_rate_percent, split.gst_paise, amount, userId],
    )
  ).rows[0];
  await q.query(
    `INSERT INTO credit_note_items (credit_note_id, description, details, quantity, unit_price_paise, line_total_paise)
     VALUES ($1, $2, $3, 1, $4, $4)`,
    [cn.id, `Reduction in fees for bill ${bill.bill_no}`, reason, split.subtotal_paise],
  );
  await addHistory(q, {
    billId: bill.id, userId, action: "credit_note_issued",
    summary: `Credit note ${cnNo} issued for ${rupeesText(amount)} (client paid less): ${reason}`,
  });
  return { cn_no: cnNo };
}
