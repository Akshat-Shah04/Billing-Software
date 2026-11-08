import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { HttpError } from "../lib/errors.js";
import { loadMailSettings, mailConfigured, type Mailer } from "../lib/mailer.js";
import { optionalText } from "../lib/paging.js";

const updateSchema = z.object({
  smtp_host: optionalText(200),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_secure: z.boolean(),
  smtp_user: optionalText(200),
  /** Left out = keep the saved password; an empty string = remove it. Never sent back to the browser. */
  smtp_password: z.string().max(300).optional(),
  smtp_from: optionalText(200).refine((v) => v === null || /^(.+<\S+@\S+\.\S+>|\S+@\S+\.\S+)$/.test(v), "must be an email address, for example billing@yourfirm.in or Your Firm <billing@yourfirm.in>"),
  app_url: optionalText(200).refine((v) => v === null || /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(v), "must be like http://OFFICE-PC:4000"),
});

/** Mounted at /api/settings/mail behind requireAuth + requireAdmin. */
export function mailSettingsRoutes(db: Db, mailer: Mailer): Router {
  const router = Router();

  const view = async () => {
    const s = await loadMailSettings(db);
    return {
      smtp_host: s.host, smtp_port: s.port, smtp_secure: s.secure, smtp_user: s.user, smtp_from: s.from, app_url: s.appUrl,
      smtp_password_set: s.password !== "",
      configured: mailConfigured(s),
    };
  };

  router.get("/", async (_req, res) => {
    res.json(await view());
  });

  router.put("/", async (req, res) => {
    const s = updateSchema.parse(req.body);
    const values: Record<string, string> = {
      smtp_host: s.smtp_host ?? "",
      smtp_port: String(s.smtp_port),
      smtp_secure: String(s.smtp_secure),
      smtp_user: s.smtp_user ?? "",
      smtp_from: s.smtp_from ?? "",
      app_url: (s.app_url ?? "").replace(/\/$/, ""),
      ...(s.smtp_password !== undefined ? { smtp_password: s.smtp_password } : {}),
    };
    await db.tx(async (q) => {
      for (const [key, value] of Object.entries(values)) {
        await q.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
      }
    });
    res.json(await view());
  });

  // Sends a test message to the admin's own email address, so they can see the settings work.
  router.post("/test", async (req, res) => {
    const me = (await db.query<{ email: string | null }>("SELECT email FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (!me?.email) throw new HttpError(400, "Add your own email address first (Staff → Edit your account), then send the test to it.");
    try {
      await mailer.send({
        to: me.email,
        subject: "Billing Software: test email",
        text: "This is a test email from Billing Software. Email is working, so password reset links can be sent.",
        html: "<p>This is a test email from Billing Software.</p><p><strong>Email is working</strong>, so password reset links can be sent.</p>",
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `The mail server refused the email: ${(e as Error).message}`);
    }
    res.json({ sent_to: me.email });
  });

  return router;
}
