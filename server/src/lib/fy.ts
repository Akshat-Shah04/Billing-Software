// Indian financial year: 1 April to 31 March. A date in January to March belongs to the year that started before it.
// "fy_start" is the calendar year the financial year starts in: 2026 means FY 2026-27.

/** 2026-03-31 -> 2025 (FY 2025-26). 2026-04-01 -> 2026 (FY 2026-27). Takes "YYYY-MM-DD". */
export const fyStartOf = (iso: string): number => Number(iso.slice(0, 4)) - (Number(iso.slice(5, 7)) < 4 ? 1 : 0);

/** 2026 -> "2026-27" */
export const fyLabel = (fyStart: number): string => `${fyStart}-${String(fyStart + 1).slice(2)}`;

/** Today's date in the server's local time as "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2027-11-30" -> "30 Nov 2027" */
export const prettyDateOf = (iso: string): string => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Adds days to a "YYYY-MM-DD" date (calendar arithmetic, no time zones involved). */
export function addDays(iso: string, days: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days));
  return d.toISOString().slice(0, 10);
}
