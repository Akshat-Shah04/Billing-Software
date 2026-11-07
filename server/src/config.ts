import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const isTest = process.env.NODE_ENV === "test";
const isProd = process.env.NODE_ENV === "production";

// Set by the Windows installer. Everything the app stores (database, backups,
// logs, login secret) lives here, outside the program folder, so upgrades never touch it.
const dataDir = process.env.DATA_DIR || null;

function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isTest) return "test-secret";
  if (dataDir) {
    // Installed mode: generate a random secret once and keep it, so logins survive restarts.
    const file = path.join(dataDir, "jwt-secret.txt");
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    const secret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
  if (isProd) throw new Error("JWT_SECRET must be set in production");
  return "dev-only-change-me";
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "pglite:./.data",
  dataDir,
  // Where each client's folder (details + bills) is kept as a readable backup. Set CLIENT_FILES_DIR to change it.
  clientFilesDir: isTest
    ? null
    : process.env.CLIENT_FILES_DIR || (dataDir ? path.join(dataDir, "ClientFiles") : path.resolve("client-files")),
  // Where database backups are written first (then copied to the second location chosen in Settings).
  backupDir: isTest ? null : process.env.BACKUP_DIR || (dataDir ? path.join(dataDir, "backups") : path.resolve("backups")),
  jwtSecret: loadJwtSecret(),
  jwtExpiresIn: "8h" as const,
};
