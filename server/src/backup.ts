import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Writes one backup file, then deletes the oldest ones beyond `keep`. Returns the file path. */
export async function backupNow(db: Db, dir: string, keep = 14): Promise<string | null> {
  if (!db.backup) return null; // a real PostgreSQL server is backed up with pg_dump instead
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `billing-${stamp()}.tar.gz`);
  fs.writeFileSync(file, await db.backup());
  const old = fs.readdirSync(dir).filter((f) => /^billing-.*\.tar\.gz$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

function newestBackupAge(dir: string): number {
  if (!fs.existsSync(dir)) return Infinity;
  const times = fs.readdirSync(dir).filter((f) => f.endsWith(".tar.gz")).map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
  return times.length ? Date.now() - Math.max(...times) : Infinity;
}

/** Backs up when the server starts (if the last backup is over ~a day old) and then every 24 hours. */
export function startBackups(db: Db, dir: string): void {
  if (!db.backup) return;
  const run = () =>
    backupNow(db, dir)
      .then((f) => f && console.log(`backup written: ${f}`))
      .catch((e) => console.error("backup failed:", e));
  if (newestBackupAge(dir) > DAY_MS - 60 * 60 * 1000) void run();
  setInterval(run, DAY_MS).unref();
}
