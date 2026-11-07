import path from "node:path";
import { config } from "./config.js"; // first: it loads .env before anything reads NODE_ENV
import { createApp } from "./app.js";
import { startBackups } from "./backup.js";
import { connect, migrate } from "./db/index.js";
import { createClientFiles } from "./lib/clientFiles.js";

const db = await connect(config.databaseUrl);
await migrate(db);
if (config.dataDir) startBackups(db, path.join(config.dataDir, "backups"));

const files = createClientFiles(db, config.clientFilesDir);
const server = createApp(db, files).listen(config.port, () => {
  console.log(`Billing API running on http://localhost:${config.port}`);
  if (config.clientFilesDir) console.log(`Client folders: ${config.clientFilesDir}`);
});

// Bring every client's folder up to date at startup (creates folders for existing clients,
// and repairs anything that was deleted or never written). Runs in the background.
void files.syncAll().then((n) => config.clientFilesDir && console.log(`client folders checked: ${n}`));

async function shutdown() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGBREAK", shutdown); // Windows: sent when the service is stopped
