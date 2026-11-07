import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Field names as a person would say them (database-style names like "gst_rate_percent" never reach the screen).
const FIELD_NAMES: Record<string, string> = {
  pan: "PAN", gstin: "GSTIN", org_gstin: "Firm GSTIN", org_name: "Firm name", org_address: "Firm address",
  upi_id: "UPI ID", bank_ifsc: "IFSC code", bank_account_number: "Account number", bank_account_holder: "Account holder name",
  referred_by: "Referred by", client_id: "Client", bill_date: "Bill date", full_name: "Full name",
  price_paise: "Price", gst_rate_percent: "GST rate", payment_instructions: "Payment instructions",
};
// Inside a bill line the stored names differ from the labels on the form.
const ITEM_FIELD_NAMES: Record<string, string> = {
  description: "name", details: "description", quantity: "quantity", unit_price_paise: "price", service_id: "service",
};

function humanize(key: PropertyKey): string {
  const k = String(key);
  if (FIELD_NAMES[k]) return FIELD_NAMES[k];
  const s = k.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelFor(path: PropertyKey[]): string {
  if (path[0] === "items" && typeof path[1] === "number") {
    const field = path[2] === undefined ? "" : ` ${ITEM_FIELD_NAMES[String(path[2])] ?? humanize(path[2]).toLowerCase()}`;
    return `Item ${path[1] + 1}${field}`;
  }
  return path.length ? humanize(path[path.length - 1]) : "The request";
}

/** Turns a validation problem into a sentence a person can act on. */
function issueMessage(issue: any): string {
  const label = labelFor(issue.path ?? []);
  const message: string = issue.message ?? "";
  const isDefault = /^(Too (big|small)|Invalid|Expected|Required)/.test(message);

  if (!isDefault) {
    // Messages we wrote ourselves: "is required", "must be at least 8 characters", or a full sentence.
    if (/^(is|must) /.test(message)) return `${label} ${message}`;
    if (/^[A-Z]/.test(message)) return message;
    return `${label}: ${message}`;
  }
  switch (issue.code) {
    case "too_big":
      if (issue.origin === "string") return `${label} is too long (at most ${issue.maximum} characters)`;
      return /price/i.test(label) ? `${label} is too large` : `${label} must be at most ${issue.maximum}`;
    case "too_small":
      if (issue.origin === "string") {
        return issue.minimum === 1 ? `${label} is required` : `${label} must be at least ${issue.minimum} characters`;
      }
      return `${label} must be at least ${issue.minimum}`;
    case "invalid_type":
      return /undefined|null/.test(message) ? `${label} is required` : `${label} is not valid`;
    case "invalid_format":
      return issue.format === "date" ? `${label} must be a real date (year-month-day)` : `${label} is not valid`;
    default:
      return `${label} is not valid`;
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues.map(issueMessage).join(". ") });
    return;
  }
  // Postgres unique-constraint violation (e.g. two people create the same username at once)
  if (err?.code === "23505") {
    res.status(409).json({ error: "That value already exists" });
    return;
  }
  // Upload bigger than the route allows (e.g. a logo over 1 MB)
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "That file is too large (the limit is 1 MB for a logo)" });
    return;
  }
  // Malformed JSON body
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
};
