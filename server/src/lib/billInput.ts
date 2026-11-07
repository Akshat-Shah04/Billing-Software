import { z } from "zod";
import type { Queryable } from "../db/index.js";
import { HttpError } from "./errors.js";
import { optionalText } from "./paging.js";

/** One line of a bill. */
export const itemSchema = z.object({
  service_id: z.number().int().positive().nullish(),
  description: z.string().trim().min(1, "is required").max(300),
  details: optionalText(500),
  quantity: z.number().int().min(1).max(100_000),
  unit_price_paise: z.number().int().min(0).max(100_000_000_000),
});

/** One line of a credit note (no service: it corrects amounts already billed). */
export const creditLineSchema = itemSchema.omit({ service_id: true });

export type ItemInput = z.infer<typeof itemSchema>;

// Quantity times price can multiply to more than the system can add up exactly (a quantity of 100,000 at the
// largest price is 10 quadrillion paise). No real bill comes anywhere near this, so refuse it with a clear message.
export const MAX_SUBTOTAL_PAISE = 1_000_000_000_000; // 100 crore rupees
export function assertReasonableTotal(items: { quantity: number; unit_price_paise: number }[]) {
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price_paise, 0);
  if (subtotal > MAX_SUBTOTAL_PAISE) {
    throw new HttpError(400, "The total is too large: the items add up to more than ₹100 crore. Check the quantities and prices.");
  }
}

export async function assertClientUsable(q: Queryable, clientId: number) {
  const { rows } = await q.query<{ is_deleted: boolean }>("SELECT is_deleted FROM clients WHERE id = $1", [clientId]);
  if (!rows[0]) throw new HttpError(400, "client_id: that client does not exist");
  if (rows[0].is_deleted) throw new HttpError(400, "client_id: that client has been deleted");
}

export async function assertServicesExist(q: Queryable, items: ItemInput[]) {
  const ids = [...new Set(items.map((i) => i.service_id).filter((v): v is number => !!v))];
  if (!ids.length) return;
  const { rows } = await q.query<{ id: number }>("SELECT id FROM services WHERE id = ANY($1::int[])", [ids]);
  if (rows.length !== ids.length) throw new HttpError(400, "items: one of the services does not exist");
}

export async function insertItems(q: Queryable, billId: number, items: ItemInput[]) {
  for (const i of items) {
    await q.query(
      `INSERT INTO bill_items (bill_id, service_id, description, details, quantity, unit_price_paise, line_total_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [billId, i.service_id ?? null, i.description, i.details, i.quantity, i.unit_price_paise, i.quantity * i.unit_price_paise],
    );
  }
}
