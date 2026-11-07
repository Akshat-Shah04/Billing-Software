import type { Queryable } from "../db/index.js";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
/** 250050 -> "₹2,500.50" */
export const rupeesText = (paise: number): string => rupees.format(paise / 100);

export type HistoryAction =
  | "created" | "edited" | "cancelled" | "payment_added" | "payment_voided" | "credit_note_issued" | "discount_given" | "discount_voided";

/** The parts of a bill that matter for "what changed". */
export interface BillSnapshot {
  bill_no: string;
  client_id: number;
  client_name: string;
  bill_date: string;
  due_date: string | null;
  notes: string | null;
  gst_rate_percent: number;
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
  items: { service_id: number | null; description: string; details: string | null; quantity: number; unit_price_paise: number; line_total_paise: number }[];
}

export async function addHistory(
  q: Queryable,
  entry: { billId: number; userId: number; action: HistoryAction; summary: string; before?: BillSnapshot | null },
): Promise<void> {
  await q.query(
    `INSERT INTO bill_history (bill_id, action, summary, before_data, changed_by) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [entry.billId, entry.action, entry.summary, entry.before ? JSON.stringify(entry.before) : null, entry.userId],
  );
}

const itemKey = (i: BillSnapshot["items"][number]) =>
  JSON.stringify([i.service_id ?? null, i.description, i.details ?? null, i.quantity, i.unit_price_paise]);

/** True when the line items are not exactly the same. */
export const itemsDiffer = (a: BillSnapshot["items"], b: BillSnapshot["items"]): boolean =>
  a.length !== b.length || a.some((item, n) => itemKey(item) !== itemKey(b[n]));

/** Plain-language list of what an edit changed. Empty when nothing changed. */
export function summarizeEdit(before: BillSnapshot, after: BillSnapshot): string[] {
  const changes: string[] = [];
  if (before.client_id !== after.client_id) changes.push(`Client changed from "${before.client_name}" to "${after.client_name}"`);
  if (before.bill_date !== after.bill_date) changes.push(`Bill date changed from ${before.bill_date} to ${after.bill_date}`);
  if ((before.due_date ?? null) !== (after.due_date ?? null)) {
    changes.push(`Due date changed from ${before.due_date ?? "none"} to ${after.due_date ?? "none"}`);
  }
  if (itemsDiffer(before.items, after.items)) {
    changes.push(
      before.items.length === after.items.length
        ? `Items changed (${after.items.length} ${after.items.length === 1 ? "item" : "items"})`
        : `Items changed (${before.items.length} ${before.items.length === 1 ? "item" : "items"} to ${after.items.length})`,
    );
  }
  if (before.total_paise !== after.total_paise) changes.push(`Total changed from ${rupeesText(before.total_paise)} to ${rupeesText(after.total_paise)}`);
  if ((before.notes ?? "") !== (after.notes ?? "")) changes.push("Notes changed");
  return changes;
}
