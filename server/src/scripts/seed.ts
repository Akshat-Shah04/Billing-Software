import fs from "node:fs";
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { connect, migrate } from "../db/index.js";

// Creates the first admin account (nobody can sign up, so someone has to be created here).
// Safe to run again: it does nothing if that username already exists.
//
// Two ways to give it the details:
//   - environment variables ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_FULL_NAME (used by `npm run seed`)
//   - flags --username, --full-name and --password-file (used by the Windows installer, so the
//     password is never put on a command line)
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const passwordFile = flag("password-file");
const password = passwordFile
  ? fs.readFileSync(passwordFile, "utf8").replace(/[\r\n]+$/, "")
  : process.env.ADMIN_PASSWORD;
const username = (flag("username") ?? process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
const fullName = flag("full-name") ?? process.env.ADMIN_FULL_NAME ?? "Firm Admin";

if (!password || password.length < 8) {
  console.error("The admin password must be at least 8 characters.");
  process.exit(1);
}

const db = await connect(config.databaseUrl);
await migrate(db);

const existing = await db.query("SELECT 1 FROM users WHERE username = $1", [username]);
if (existing.rowCount) {
  console.log(`User "${username}" already exists, nothing to do.`);
} else {
  await db.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')", [
    username,
    await bcrypt.hash(password, 10),
    fullName,
  ]);
  console.log(`Admin "${username}" created.`);
}
await db.close();
