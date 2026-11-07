import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db/index.js";
import { HttpError } from "./errors.js";

/**
 * Backups that survive the PC failing.
 *
 * Every 24 hours (and when an admin presses "Back up now") the server:
 *   1. writes a database backup into the local backup folder (embedded database only; a PostgreSQL server is
 *      backed up with pg_dump instead),
 *   2. copies that file to a SECOND LOCATION the admin chose (a USB drive, a network share, a cloud-synced
 *      folder such as OneDrive or Google Drive), and
 *   3. mirrors the client folders there too.
 * The last 14 database backups are kept in each place. Nothing in the second location is ever deleted except
 * old database backups beyond those 14.
 */

const KEEP = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_FILE = /^billing-.*\.tar\.gz$/;
const CLIENT_COPY_NAME = "Client Files";

export interface BackupStatus {
  /** False when no backup folder is set up on this server. */
  enabled: boolean;
  backupDir: string | null;
  /** True for the embedded database; a PostgreSQL server needs pg_dump. */
  canBackUpDatabase: boolean;
  copyDir: string | null;
  lastRunAt: string | null;
  lastDatabaseBackup: string | null;
  lastCopyAt: string | null;
  lastError: string | null;
  running: boolean;
}

export interface BackupResult {
  database: "done" | "skipped" | "failed";
  copy: "done" | "not set" | "failed";
  clientFolders: "done" | "not set" | "skipped" | "failed";
  errors: string[];
}

export interface Backups {
  run(): Promise<BackupResult>;
  status(): Promise<BackupStatus>;
  /** Sets (or with an empty string, clears) the second backup location. */
  setCopyDir(dir: string): Promise<void>;
  /** Backs up when the server starts (if the last one is over about a day old), then every 24 hours. */
  startSchedule(): void;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function prune(dir: string): Promise<void> {
  const old = (await fs.readdir(dir)).filter((f) => BACKUP_FILE.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) await fs.rm(path.join(dir, f), { force: true });
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

export function createBackups(db: Db, o: { dir: string | null; clientFilesDir: string | null; protectedDirs?: (string | null)[] }): Backups {
  let running = false;

  async function getSetting(key: string): Promise<string> {
    return (await db.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key])).rows[0]?.value ?? "";
  }
  async function setSetting(key: string, value: string) {
    await db.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
  }

  async function run(): Promise<BackupResult> {
    if (!o.dir) throw new HttpError(409, "Backups are not set up on this server");
    if (running) throw new HttpError(409, "A backup is already running");
    running = true;
    const result: BackupResult = { database: "skipped", copy: "not set", clientFolders: "not set", errors: [] };
    let file: string | null = null;
    try {
      // 1. The database, into the local backup folder.
      if (db.backup) {
        try {
          await fs.mkdir(o.dir, { recursive: true });
          file = path.join(o.dir, `billing-${stamp()}.tar.gz`);
          await fs.writeFile(file, await db.backup());
          await prune(o.dir);
          result.database = "done";
        } catch (e) {
          result.database = "failed";
          result.errors.push(`Database backup failed: ${(e as Error).message}`);
          file = null;
        }
      }

      // 2 and 3. The second location.
      const copyDir = await getSetting("backup_copy_dir");
      if (copyDir) {
        try {
          await fs.mkdir(copyDir, { recursive: true });
          if (file) {
            await fs.copyFile(file, path.join(copyDir, path.basename(file)));
            await prune(copyDir);
          }
          result.copy = "done";
        } catch (e) {
          result.copy = "failed";
          result.errors.push(`Could not copy the backup to ${copyDir}: ${(e as Error).message}`);
        }
        if (o.clientFilesDir) {
          try {
            await fs.cp(o.clientFilesDir, path.join(copyDir, CLIENT_COPY_NAME), { recursive: true, force: true });
            result.clientFolders = "done";
          } catch (e) {
            // "no such folder" simply means there are no client folders yet
            const missing = (e as NodeJS.ErrnoException).code === "ENOENT" && result.copy !== "failed";
            result.clientFolders = missing ? "skipped" : "failed";
            if (!missing) result.errors.push(`Could not copy the client folders to ${copyDir}: ${(e as Error).message}`);
          }
        } else {
          result.clientFolders = "skipped";
        }
      }

      await setSetting("backup_last_run_at", new Date().toISOString());
      if (file) await setSetting("backup_last_file", path.basename(file));
      if (result.copy === "done") await setSetting("backup_last_copy_at", new Date().toISOString());
      await setSetting("backup_last_error", result.errors.join("; "));
      return result;
    } finally {
      running = false;
    }
  }

  return {
    run,

    async status() {
      return {
        enabled: o.dir !== null,
        backupDir: o.dir,
        canBackUpDatabase: !!db.backup,
        copyDir: (await getSetting("backup_copy_dir")) || null,
        lastRunAt: (await getSetting("backup_last_run_at")) || null,
        lastDatabaseBackup: (await getSetting("backup_last_file")) || null,
        lastCopyAt: (await getSetting("backup_last_copy_at")) || null,
        lastError: (await getSetting("backup_last_error")) || null,
        running,
      };
    },

    async setCopyDir(dir: string) {
      const wanted = dir.trim();
      if (!wanted) {
        await setSetting("backup_copy_dir", "");
        return;
      }
      if (!path.isAbsolute(wanted)) {
        throw new HttpError(400, "Enter the full folder path, for example E:\\Billing Backups or \\\\office-server\\backups");
      }
      const target = path.resolve(wanted);
      // Copying a folder into itself would never end, so the second location must be somewhere else entirely.
      for (const own of [o.dir, o.clientFilesDir, ...(o.protectedDirs ?? [])]) {
        if (own && (inside(target, path.resolve(own)) || inside(path.resolve(own), target))) {
          throw new HttpError(400, "Choose a folder somewhere else (not inside, or a parent of, this program's own data or client folders)");
        }
      }
      try {
        await fs.mkdir(target, { recursive: true });
        const probe = path.join(target, `.write-test-${process.pid}`);
        await fs.writeFile(probe, "ok");
        await fs.rm(probe, { force: true });
      } catch (e) {
        throw new HttpError(400, `Billing Software can't write to that folder (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}). Check the drive is connected and the path is right.`);
      }
      await setSetting("backup_copy_dir", target);
    },

    startSchedule() {
      if (!o.dir) return;
      const go = () => run().then((r) => console.log(`backup: database ${r.database}, copy ${r.copy}, client folders ${r.clientFolders}${r.errors.length ? ` (${r.errors.join("; ")})` : ""}`)).catch((e) => console.error("backup failed:", e));
      void (async () => {
        const last = await getSetting("backup_last_run_at");
        if (!last || Date.now() - new Date(last).getTime() > DAY_MS - 60 * 60 * 1000) go();
      })();
      setInterval(go, DAY_MS).unref();
    },
  };
}
