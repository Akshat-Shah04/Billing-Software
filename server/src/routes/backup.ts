import { Router } from "express";
import { z } from "zod";
import type { Backups } from "../lib/backups.js";

const locationSchema = z.object({
  /** A full folder path on this computer or network, or an empty string to turn the second copy off. */
  copy_dir: z.string().max(500),
});

/** Mounted at /api/backup behind requireAuth + requireAdmin. */
export function backupRoutes(backups: Backups): Router {
  const router = Router();

  router.get("/status", async (_req, res) => {
    res.json(await backups.status());
  });

  router.put("/location", async (req, res) => {
    const { copy_dir } = locationSchema.parse(req.body);
    await backups.setCopyDir(copy_dir);
    res.json(await backups.status());
  });

  // "Back up now": the database, the second copy and the client folders.
  router.post("/run", async (_req, res) => {
    const result = await backups.run();
    res.json({ result, status: await backups.status() });
  });

  return router;
}
