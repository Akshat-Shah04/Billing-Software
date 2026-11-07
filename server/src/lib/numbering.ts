import type { Queryable } from "../db/index.js";
import { fyLabel, fyStartOf } from "./fy.js";

export type NumberKind = "INV" | "CN";

/**
 * The next number in a series: consecutive, with no gaps, restarting at 1 each financial year.
 *   bills:        2026-27/0001, 2026-27/0002, ...   (series "INV:2026")
 *   credit notes: CN/2026-27/0001, ...              (series "CN:2026")
 * (Both are well under the 16 characters Indian GST allows for an invoice number.)
 *
 * IMPORTANT: call this inside the same transaction that saves the document. The counter then rolls back with a
 * failed save (so the number is never used up), and two people saving at the same moment queue on the row lock
 * instead of getting the same number. A database sequence cannot do either, because it never gives a value back.
 *
 * `year` picks the series: a financial year (2026 = FY 2026-27), or a "YYYY-MM-DD" date whose year is used.
 * Bills pass the financial year chosen for them, so an old bill takes the next number of THAT year's series.
 * Credit notes pass their own date.
 */
export async function nextDocumentNumber(q: Queryable, kind: NumberKind, year: number | string): Promise<string> {
  const fy = typeof year === "number" ? year : fyStartOf(year);
  const { rows } = await q.query<{ last_value: number }>(
    `INSERT INTO number_series (series, last_value) VALUES ($1, 1)
     ON CONFLICT (series) DO UPDATE SET last_value = number_series.last_value + 1
     RETURNING last_value`,
    [`${kind}:${fy}`],
  );
  const n = String(rows[0].last_value).padStart(4, "0");
  return kind === "INV" ? `${fyLabel(fy)}/${n}` : `CN/${fyLabel(fy)}/${n}`;
}
