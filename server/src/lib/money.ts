export interface LineInput {
  quantity: number;
  unit_price_paise: number;
  /** "fee" (the firm's charge, the default) or "reimbursement" (paid on the client's behalf: no GST, not income). */
  kind?: "fee" | "reimbursement" | null;
}

export interface Totals {
  /** Fees only: GST is charged on this. */
  subtotal_paise: number;
  gst_paise: number;
  /** Paid on the client's behalf (e.g. tax paid from the firm's account): no GST, not the firm's income. */
  reimbursement_paise: number;
  /** subtotal + GST + reimbursement: what the client pays. */
  total_paise: number;
}

/**
 * All amounts are integer paise. GST uses integer maths on basis points
 * (18% = 1800 bp) and rounds half up, so the result is exact and repeatable. GST is charged on fees only.
 */
export function calculateTotals(items: LineInput[], gstRatePercent: number): Totals {
  const line = (i: LineInput) => i.quantity * i.unit_price_paise;
  const subtotal = items.filter((i) => i.kind !== "reimbursement").reduce((sum, i) => sum + line(i), 0);
  const reimbursement = items.filter((i) => i.kind === "reimbursement").reduce((sum, i) => sum + line(i), 0);
  const rateBp = Math.round(gstRatePercent * 100);
  const gst = Math.floor((subtotal * rateBp + 5000) / 10000);
  return { subtotal_paise: subtotal, gst_paise: gst, reimbursement_paise: reimbursement, total_paise: subtotal + gst + reimbursement };
}
