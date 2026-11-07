import express, { Router } from "express";
import { z } from "zod";
import type { Db, Queryable } from "../db/index.js";
import type { ClientFiles } from "../lib/clientFiles.js";
import { HttpError } from "../lib/errors.js";
import { optionalText } from "../lib/paging.js";
import { requireAdmin } from "../middleware/auth.js";

export interface Settings {
  org_name: string;
  org_address: string;
  org_gstin: string;
  // Where clients should pay. Printed on every bill.
  bank_account_holder: string;
  bank_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_branch: string;
  upi_id: string;
  payment_instructions: string;
  gst_enabled: boolean;
  gst_rate_percent: number;
  /** Days from the bill date to the default due date. */
  payment_terms_days: number;
  /** Prefixed to 10-digit phone numbers when opening WhatsApp (91 = India). */
  default_country_code: string;
}

const TEXT_KEYS = [
  "org_name",
  "org_address",
  "org_gstin",
  "bank_account_holder",
  "bank_name",
  "bank_account_number",
  "bank_ifsc",
  "bank_branch",
  "upi_id",
  "payment_instructions",
] as const;

export async function loadSettings(q: Queryable): Promise<Settings> {
  const { rows } = await q.query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const text = Object.fromEntries(TEXT_KEYS.map((k) => [k, m[k] ?? ""])) as Record<(typeof TEXT_KEYS)[number], string>;
  return {
    ...text,
    gst_enabled: m.gst_enabled === "true",
    gst_rate_percent: Number(m.gst_rate_percent ?? 18),
    payment_terms_days: Number(m.payment_terms_days ?? 15),
    default_country_code: m.default_country_code || "91",
  };
}

export interface Logo {
  contentType: string;
  data: Buffer;
  updatedAt: Date;
}

export async function loadLogo(q: Queryable): Promise<Logo | null> {
  const { rows } = await q.query<{ content_type: string; data: Uint8Array; updated_at: Date | string }>(
    "SELECT content_type, data, updated_at FROM org_logo WHERE id = 1",
  );
  const r = rows[0];
  return r ? { contentType: r.content_type, data: Buffer.from(r.data), updatedAt: new Date(r.updated_at) } : null;
}

/** Works out the image type from the file's first bytes (never trust the label the browser sent). */
export function sniffImageType(b: Buffer): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null; // notably SVG is refused: it can contain scripts
}

const MAX_LOGO_BYTES = 1024 * 1024;

const updateSchema = z.object({
  org_name: optionalText(150),
  org_address: optionalText(300),
  org_gstin: optionalText(15).transform((v) => v?.toUpperCase() ?? null),
  bank_account_holder: optionalText(150),
  bank_name: optionalText(150),
  bank_account_number: optionalText(30),
  bank_ifsc: optionalText(15).transform((v) => v?.toUpperCase() ?? null),
  bank_branch: optionalText(150),
  upi_id: optionalText(100),
  payment_instructions: optionalText(500),
  gst_enabled: z.boolean(),
  gst_rate_percent: z.number().min(0).max(100),
  // Optional: when left out, the current value is kept.
  payment_terms_days: z.number().int().min(0).max(365).optional(),
  default_country_code: z.string().trim().regex(/^\d{1,4}$/, "Country code must be digits only, for example 91").optional(),
});

async function withLogoInfo(db: Db) {
  const [settings, logo] = await Promise.all([loadSettings(db), loadLogo(db)]);
  // logo_version changes whenever the logo does, so browsers never show an old one.
  return { ...settings, has_logo: logo !== null, logo_version: logo ? logo.updatedAt.getTime() : 0 };
}

export function settingsRoutes(db: Db, files: ClientFiles): Router {
  const router = Router();

  // Every logged-in user can read (the bill form needs the GST rate, bills need the firm and bank details)...
  router.get("/", async (_req, res) => {
    res.json(await withLogoInfo(db));
  });

  // ...but only an admin can change anything.
  router.put("/", requireAdmin, async (req, res) => {
    const s = updateSchema.parse(req.body);
    const values: Record<string, string> = {
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, s[k] ?? ""])),
      gst_enabled: String(s.gst_enabled),
      gst_rate_percent: String(s.gst_rate_percent),
      ...(s.payment_terms_days !== undefined ? { payment_terms_days: String(s.payment_terms_days) } : {}),
      ...(s.default_country_code !== undefined ? { default_country_code: s.default_country_code } : {}),
    };
    await db.tx(async (q) => {
      for (const [key, value] of Object.entries(values)) {
        await q.query(
          "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [key, value],
        );
      }
    });
    void files.syncAll(); // bill copies in the client folders show the firm and bank details
    res.json(await withLogoInfo(db));
  });

  router.get("/logo", async (_req, res) => {
    const logo = await loadLogo(db);
    if (!logo) throw new HttpError(404, "No logo has been uploaded");
    res.set("Content-Type", logo.contentType).set("Cache-Control", "private, max-age=0, must-revalidate").send(logo.data);
  });

  // The image is sent as the raw request body (Content-Type image/png or image/jpeg), up to 1 MB.
  router.put(
    "/logo",
    requireAdmin,
    express.raw({ type: ["image/png", "image/jpeg"], limit: MAX_LOGO_BYTES }),
    async (req, res) => {
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new HttpError(415, "Send the logo as a PNG or JPEG image");
      }
      const type = sniffImageType(body);
      if (!type) throw new HttpError(400, "That file is not a valid PNG or JPEG image");
      await db.query(
        `INSERT INTO org_logo (id, content_type, data) VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = now()`,
        [type, body],
      );
      void files.syncAll();
      res.json(await withLogoInfo(db));
    },
  );

  router.delete("/logo", requireAdmin, async (_req, res) => {
    await db.query("DELETE FROM org_logo WHERE id = 1");
    void files.syncAll();
    res.json(await withLogoInfo(db));
  });

  return router;
}
