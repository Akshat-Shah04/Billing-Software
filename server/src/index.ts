import { config } from "./config.js"; // first: it loads .env before anything reads NODE_ENV
import { createApp } from "./app.js";
import { createBackups } from "./lib/backups.js";
import { createClientFiles } from "./lib/clientFiles.js";
import { connect, migrate } from "./db/index.js";

const db = await connect(config.databaseUrl);
await migrate(db);

const files = createClientFiles(db, config.clientFilesDir);
const backups = createBackups(db, { dir: config.backupDir, clientFilesDir: config.clientFilesDir, protectedDirs: [config.dataDir] });

const server = createApp(db, files, backups).listen(config.port, () => {
  console.log(`Billing API running on http://localhost:${config.port}`);
  if (config.clientFilesDir) console.log(`Client folders: ${config.clientFilesDir}`);
});

// Bring every client's folder up to date at startup (creates folders for existing clients,
// and repairs anything that was deleted or never written). Runs in the background.
void files.syncAll().then((n) => config.clientFilesDir && console.log(`client folders checked: ${n}`));

// Back up now if the last backup is about a day old, then every 24 hours.
backups.startSchedule();

async function shutdown() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGBREAK", shutdown); // Windows: sent when the service is stopped
