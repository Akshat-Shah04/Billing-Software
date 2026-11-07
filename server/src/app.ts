import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { Db } from "./db/index.js";
import { createClientFiles, type ClientFiles } from "./lib/clientFiles.js";
import { errorHandler } from "./lib/errors.js";
import { requireAdmin, requireAuth } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { billRoutes } from "./routes/bills.js";
import { clientFilesRoutes } from "./routes/clientFiles.js";
import { clientRoutes } from "./routes/clients.js";
import { serviceRoutes } from "./routes/services.js";
import { settingsRoutes } from "./routes/settings.js";
import { userRoutes } from "./routes/users.js";

/** `files` writes each client's folder on disk. The default is "off" (used by most tests). */
export function createApp(db: Db, files: ClientFiles = createClientFiles(db, null)) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const auth = requireAuth(db);
  app.use("/api/auth", authRoutes(db));
  app.use("/api/clients", auth, clientRoutes(db, files));
  app.use("/api/services", auth, serviceRoutes(db));
  app.use("/api/bills", auth, billRoutes(db, files));
  app.use("/api/client-files", auth, requireAdmin, clientFilesRoutes(files));
  app.use("/api/settings", auth, settingsRoutes(db, files));
  app.use("/api/users", auth, requireAdmin, userRoutes(db));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // In production the built React app (client/dist) is served by this same server.
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
