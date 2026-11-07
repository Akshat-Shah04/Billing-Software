import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

// Restores the embedded database from a backup file made by the app.
//   node dist/scripts/restore.js "C:\ProgramData\BillingSoftware\data\backups\billing-20261107-120000.tar.gz"
// STOP THE SERVICE FIRST. The current database folder is moved aside, not deleted.
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error("Usage: restore <backup-file.tar.gz>   (file not found or not given)");
  process.exit(1);
}
if (!config.databaseUrl.startsWith("pglite:")) {
  console.error("This restore tool is only for the embedded database. Use pg_restore for PostgreSQL.");
  process.exit(1);
}

const dataDir = path.resolve(config.databaseUrl.slice("pglite:".length));
if (fs.existsSync(dataDir)) {
  const aside = `${dataDir}.before-restore-${Date.now()}`;
  fs.renameSync(dataDir, aside);
  console.log(`Current database moved to ${aside}`);
}

const { PGlite } = await import("@electric-sql/pglite");
const bytes = fs.readFileSync(file);
const lite = await PGlite.create({
  dataDir,
  loadDataDir: new File([bytes], "backup.tar.gz", { type: "application/gzip" }),
});
const { rows } = await lite.query<{ n: number }>("SELECT count(*)::int AS n FROM bills");
console.log(`Restore complete. The database now holds ${rows[0].n} bill(s).`);
await lite.close();
