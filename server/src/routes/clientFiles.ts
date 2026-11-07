import { Router } from "express";
import type { ClientFiles } from "../lib/clientFiles.js";

/** Mounted behind requireAuth + requireAdmin. */
export function clientFilesRoutes(files: ClientFiles): Router {
  const router = Router();

  router.get("/status", (_req, res) => {
    res.json(files.status());
  });

  // Rewrites every client's folder from the database (e.g. after restoring a backup or moving the folder).
  router.post("/rebuild", async (_req, res) => {
    const clients = await files.syncAll();
    res.json({ clients, ...files.status() });
  });

  return router;
}
