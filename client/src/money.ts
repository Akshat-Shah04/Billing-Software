// Money is always whole paise inside the app (the server uses the same rule).
// Only the screens show rupees.

const rupeeFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export const formatRupees = (paise: number) => rupeeFormat.format(paise / 100);

/** "1234.5" -> 123450. Returns null if the text is not a valid amount. Uses text, not floats. */
export function rupeesToPaise(text: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/** 123450 -> "1234.50" (for putting into an input box). */
export function paiseToInput(paise: number): string {
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100).padStart(2, "0");
  return `${whole}.${frac}`;
}

/** Same integer maths as the server, used for the live preview on the bill form. */
export function calculateTotals(lines: { quantity: number; unit_price_paise: number }[], gstRatePercent: number) {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unit_price_paise, 0);
  const rateBp = Math.round(gstRatePercent * 100);
  const gst = Math.floor((subtotal * rateBp + 5000) / 10000);
  return { subtotal_paise: subtotal, gst_paise: gst, total_paise: subtotal + gst };
}

/** Indian financial year (1 Apr - 31 Mar) that a YYYY-MM-DD date falls in, as its start year. 2026-02-10 -> 2025. */
export function fyStartOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return null;
  return Number(m[1]) - (Number(m[2]) < 4 ? 1 : 0);
}

/** 2026 -> "2026-27" */
export const fyLabel = (fyStart: number) => `${fyStart}-${String(fyStart + 1).slice(2)}`;

export const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
