import type { Settings } from "../routes/settings.js";

// Small formatting helpers shared by the saved HTML copies, the PDFs and the CSV exports.

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "cash", upi: "UPI", bank_transfer: "bank transfer", cheque: "cheque", card: "card", other: "other",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** 250050 -> "₹2,500.50" */
export const money = (paise: number): string => rupees.format(paise / 100);

/** "2026-11-05" -> "05 Nov 2026" */
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** A timestamp (Date or ISO text) as "05 Nov 2026". */
export const prettyTimestamp = (t: unknown): string =>
  new Date(t as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Bill numbers contain "/" (2026-27/0001), which is not allowed in a file name. */
export const safeFileName = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");

/** The firm's bank / UPI details as label-value pairs, leaving out anything not filled in. */
export function paymentLines(org: Settings): [string, string][] {
  const all: [string, string][] = [
    ["Account name", org.bank_account_holder],
    ["Bank", org.bank_name],
    ["Account number", org.bank_account_number],
    ["IFSC", org.bank_ifsc],
    ["Branch", org.bank_branch],
    ["UPI ID", org.upi_id],
  ];
  return all.filter(([, v]) => v);
}

export const fyLabelOf = (start: number): string => `${start}-${String(start + 1).slice(2)}`;

/** 2025 -> "FY 2025-2026", as printed in the Year column of a bill. */
export const fyLongLabel = (start: number): string => `FY ${start}-${start + 1}`;

/** The line under a bill's payment details: "Subject to Ahmedabad jurisdiction." (nothing when no city is set). */
export const jurisdictionLine = (org: Settings): string => (org.jurisdiction?.trim() ? `Subject to ${org.jurisdiction.trim()} jurisdiction.` : "");

/** "Payment due by 22 Nov 2026." for the bill's remarks. */
export const dueLine = (dueDate: string | null): string => (dueDate ? `Payment due by ${prettyDate(dueDate)}.` : "");
