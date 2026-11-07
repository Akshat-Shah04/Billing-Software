import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { Db } from "./db/index.js";
import { createBackups, type Backups } from "./lib/backups.js";
import { createClientFiles, type ClientFiles } from "./lib/clientFiles.js";
import { errorHandler } from "./lib/errors.js";
import { requireAdmin, requireAuth } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { backupRoutes } from "./routes/backup.js";
import { billRoutes } from "./routes/bills.js";
import { clientFilesRoutes } from "./routes/clientFiles.js";
import { clientRoutes } from "./routes/clients.js";
import { creditNoteRoutes } from "./routes/creditNotes.js";
import { documentRoutes } from "./routes/documents.js";
import { exportRoutes } from "./routes/exports.js";
import { paymentRoutes } from "./routes/payments.js";
import { serviceRoutes } from "./routes/services.js";
import { settingsRoutes } from "./routes/settings.js";
import { userRoutes } from "./routes/users.js";

/**
 * `files` writes each client's folder on disk and `backups` makes the database and second-location backups.
 * Both default to "off", which is what most tests want.
 */
export function createApp(
  db: Db,
  files: ClientFiles = createClientFiles(db, null),
  backups: Backups = createBackups(db, { dir: null, clientFilesDir: null }),
) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes(db));

  // Everything below needs a login (checked once, here, for all of it).
  const api = express.Router();
  api.use(requireAuth(db));
  api.use("/clients", clientRoutes(db, files));
  api.use("/services", serviceRoutes(db));
  api.use("/bills", billRoutes(db, files));
  api.use("/exports", exportRoutes(db));
  api.use(paymentRoutes(db, files)); // /bills/:id/payments and /payments/:id/void
  api.use(creditNoteRoutes(db, files)); // /bills/:id/credit-notes and /credit-notes/:id
  api.use(documentRoutes(db)); // /bills/:id/pdf and /credit-notes/:id/pdf
  api.use("/settings", settingsRoutes(db, files));
  api.use("/client-files", requireAdmin, clientFilesRoutes(files));
  api.use("/backup", requireAdmin, backupRoutes(backups));
  api.use("/users", requireAdmin, userRoutes(db));
  api.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use("/api", api);

  // In production the built React app (client/dist) is served by this same server.
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
