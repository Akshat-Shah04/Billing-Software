import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run SQL that contains several statements (used by migrations). No parameters. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Run several queries as one all-or-nothing unit. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** A compressed snapshot of the whole database. Only the embedded database supports it. */
  backup?(): Promise<Buffer>;
}

// Postgres returns BIGINT / NUMERIC / DATE as strings by default.
// We want JavaScript numbers (paise fit safely) and plain "YYYY-MM-DD" dates.
const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;

function postgres(url: string): Db {
  pg.types.setTypeParser(INT8, (v) => parseInt(v, 10));
  pg.types.setTypeParser(NUMERIC, (v) => parseFloat(v));
  pg.types.setTypeParser(DATE, (v) => v);
  const pool = new pg.Pool({ connectionString: url });
  return {
    query: async (sql, params) => {
      const r = await pool.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async (sql, params) => {
            const r = await client.query(sql, params as any[]);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
          exec: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// PGlite is Postgres compiled to WebAssembly: real Postgres behaviour with zero
// install, which suits automated tests and quick local runs.
async function pglite(location: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = location === "memory" ? undefined : path.resolve(location);
  const lite = await PGlite.create({
    dataDir,
    parsers: {
      [INT8]: (v: string) => parseInt(v, 10),
      [NUMERIC]: (v: string) => parseFloat(v),
      [DATE]: (v: string) => v,
    },
  });
  const wrap = (q: {
    query: (s: string, p?: any[]) => Promise<any>;
    exec: (s: string) => Promise<any>;
  }): Queryable => ({
    query: async (sql, params) => {
      const r = await q.query(sql, params as any[]);
      // PGlite reports affectedRows = 0 for SELECT, so prefer the row count when there are rows.
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
    exec: async (sql) => {
      await q.exec(sql);
    },
  });
  return {
    ...wrap(lite),
    tx: (fn) => lite.transaction((t) => fn(wrap(t))),
    close: () => lite.close(),
    backup: async () => Buffer.from(await (await lite.dumpDataDir("gzip")).arrayBuffer()),
  };
}

export async function connect(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) return pglite(url.slice("pglite:".length) || "memory");
  return postgres(url);
}

/** Applies any migrations/*.sql files that have not been run yet, in order. */
export async function migrate(db: Db): Promise<void> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.log(`migration applied: ${file}`);
  }
}
