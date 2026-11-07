// CSV that opens correctly in Excel: UTF-8 with a byte-order mark (so the rupee sign and non-English names
// show properly), CRLF line endings, and every cell quoted when it needs to be.

/**
 * A cell of text. A cell that starts with = + - @ (or a tab/CR) would be run as a FORMULA by Excel, so a client
 * named "=HYPERLINK(...)" could do harm when the file is opened. Such text gets a leading apostrophe.
 */
export function text(value: unknown): string {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Paise as plain rupees with two decimals, no symbol or commas, so Excel treats it as a number: 250050 -> "2500.50" */
export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** Rows of already-prepared strings (use text() and rupees()) to one CSV file's contents. */
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map(quote).join(",")).join("\r\n")}\r\n`;
}
