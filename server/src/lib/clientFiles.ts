import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db/index.js";
import { loadLogo, loadSettings, type Settings } from "../routes/settings.js";
import { getBill, getCreditNote } from "./billData.js";
import { renderBillHtml, renderCreditNoteHtml } from "./documentHtml.js";
import { fyLabelOf, money, prettyDate, safeFileName } from "./format.js";

/**
 * A readable backup kept on the PC's disk, one folder per client:
 *
 *   <client files folder>/
 *     Rajesh Patel/
 *       client-details.txt     the client's details, their bills and what they owe
 *       client-data.json       the same data in full, for programs
 *       bills/
 *         2026-27-0001_2026-11-05.html     each bill, printable in any browser
 *       credit-notes/
 *         CN-2026-27-0001_2026-11-20.html  each credit note
 *
 * Folders are only ever added to or renamed, never deleted, even when a client is deleted in the app.
 * A problem writing files is logged and shown in Settings, but never stops a bill from being saved.
 */
export interface ClientFiles {
  syncClient(clientId: number): Promise<void>;
  /** Writes one bill's file (and its credit notes), then refreshes that client's summary files. */
  syncBill(billId: number): Promise<void>;
  /** Rebuilds every client's folder from the database. Returns how many clients were written. */
  syncAll(): Promise<number>;
  status(): { enabled: boolean; dir: string | null; lastError: string | null; lastSync: string | null };
}

/** Turns a client name into a safe Windows folder name. */
export function folderBase(name: string): string {
  let s = name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  s = s.slice(0, 80).replace(/[. ]+$/g, ""); // Windows does not allow a trailing dot or space
  if (!s) s = "Client";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = `${s}_`; // reserved device names
  return s;
}

// Files this program writes into bills/ and credit-notes/. Only files that look like this are ever tidied away.
const GENERATED = /^[A-Za-z0-9.-]+_\d{4}-\d{2}-\d{2}\.html$/;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(file: string, data: string) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

function statusText(b: any): string {
  if (b.state === "cancelled") return "CANCELLED";
  if (b.state === "paid") return "Paid";
  if (b.state === "credited") return "Credited";
  if (b.state === "written_off") return "Written off";
  return `${b.paid_paise > 0 ? "Part paid, " : ""}balance ${money(b.balance_paise)}${b.overdue ? " (OVERDUE)" : ""}`;
}

export function createClientFiles(db: Db, dir: string | null): ClientFiles {
  let lastError: string | null = null;
  let lastSync: string | null = null;

  // One folder operation at a time, so renames and writes never race each other.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };

  // Work out (and if needed rename to) the folder for a client. Returns the folder name.
  async function resolveFolder(c: { id: number; name: string; folder_name: string | null }): Promise<string> {
    const base = folderBase(c.name);
    const withId = `${base} (${c.id})`;
    const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
    const taken = async (candidate: string) =>
      (await db.query("SELECT 1 FROM clients WHERE lower(folder_name) = lower($1) AND id <> $2", [candidate, c.id])).rowCount > 0;

    // Keep the current folder if it is still a valid name for this client (so names stay stable).
    let desired: string;
    if (same(c.folder_name, base) || same(c.folder_name, withId)) desired = c.folder_name!;
    else desired = (await taken(base)) ? withId : base;

    if (c.folder_name && c.folder_name !== desired) {
      const from = path.join(dir!, c.folder_name);
      const to = path.join(dir!, desired);
      if (await exists(from)) {
        if (!(await exists(to)) || from.toLowerCase() === to.toLowerCase()) {
          await fs.rename(from, to);
        } else {
          desired = c.folder_name; // something else already uses the new name on disk: keep the old folder
        }
      }
    }
    if (desired !== c.folder_name) await db.query("UPDATE clients SET folder_name = $2 WHERE id = $1", [c.id, desired]);
    return desired;
  }

  // The firm's details and logo, loaded once per operation. The logo is embedded in each copy
  // so the file still shows it when opened on its own, offline, or emailed.
  async function loadOrg(): Promise<{ org: Settings; logoUri: string | null }> {
    const [org, logo] = await Promise.all([loadSettings(db), loadLogo(db)]);
    return { org, logoUri: logo ? `data:${logo.contentType};base64,${logo.data.toString("base64")}` : null };
  }

  /** Writes the files in `folder` for the given documents, and removes copies that no longer belong. */
  async function writeDocuments(folder: string, docs: { file: string; html: string; always: boolean }[]) {
    await fs.mkdir(folder, { recursive: true });
    const existing = (await fs.readdir(folder)).filter((f) => GENERATED.test(f));
    const wanted = new Set(docs.map((d) => d.file));
    for (const d of docs) {
      if (!d.always && existing.includes(d.file)) continue; // unchanged and already there
      await writeAtomic(path.join(folder, d.file), d.html);
    }
    // Remove copies that no longer match: a bill whose date changed, or one that moved to another client.
    for (const f of existing) if (!wanted.has(f)) await fs.rm(path.join(folder, f), { force: true });
  }

  async function writeClient(clientId: number, onlyBillId: number | null, firm: { org: Settings; logoUri: string | null }) {
    const client = (await db.query<any>("SELECT * FROM clients WHERE id = $1", [clientId])).rows[0];
    if (!client) return;
    const folder = await resolveFolder(client);
    const clientDir = path.join(dir!, folder);
    await fs.mkdir(clientDir, { recursive: true });

    const billIds = (await db.query<{ id: number }>("SELECT id FROM bills WHERE client_id = $1 ORDER BY bill_date, id", [clientId])).rows;
    const bills: any[] = [];
    for (const { id } of billIds) bills.push(await getBill(db, id));

    const cnIds = (
      await db.query<{ id: number }>(
        "SELECT n.id FROM credit_notes n JOIN bills b ON b.id = n.bill_id WHERE b.client_id = $1 ORDER BY n.cn_date, n.id",
        [clientId],
      )
    ).rows;
    const creditNotes: any[] = [];
    for (const { id } of cnIds) creditNotes.push(await getCreditNote(db, id));

    // Rewrite everything, or (after one bill changed) just that bill and its credit notes.
    await writeDocuments(
      path.join(clientDir, "bills"),
      bills.map((b) => ({
        file: `${safeFileName(b.bill_no)}_${b.bill_date}.html`,
        html: renderBillHtml(b, firm.org, firm.logoUri),
        always: onlyBillId === null || b.id === onlyBillId,
      })),
    );
    if (creditNotes.length || (await exists(path.join(clientDir, "credit-notes")))) {
      await writeDocuments(
        path.join(clientDir, "credit-notes"),
        creditNotes.map((c) => ({
          file: `${safeFileName(c.cn_no)}_${c.cn_date}.html`,
          html: renderCreditNoteHtml(c, firm.org, firm.logoUri),
          always: onlyBillId === null || c.bill_id === onlyBillId,
        })),
      );
    }

    const owed = bills.reduce((sum, b) => sum + Math.max(b.balance_paise, 0), 0);
    const lines = [
      "CLIENT DETAILS",
      "==============",
      `Name:         ${client.name}`,
      `Status:       ${client.is_deleted ? "DELETED in Billing Software (kept here as a record)" : "Active"}`,
      `Phone:        ${client.phone ?? ""}`,
      `Email:        ${client.email ?? ""}`,
      `City:         ${client.city ?? ""}`,
      `Address:      ${(client.address ?? "").replace(/\r?\n/g, ", ")}`,
      `PAN:          ${client.pan ?? ""}`,
      `GSTIN:        ${client.gstin ?? ""}`,
      `Referred by:  ${client.referred_by ?? ""}`,
      "",
      `OUTSTANDING:  ${money(owed)}`,
      "",
      `BILLS (${bills.length})`,
      "-----------",
      ...bills.map(
        (b) => `${b.bill_no}   ${prettyDate(b.bill_date)}   FY ${fyLabelOf(b.fy_start)}   ${money(b.total_paise)}   ${statusText(b)}`,
      ),
      ...(creditNotes.length
        ? ["", `CREDIT NOTES (${creditNotes.length})`, "-----------------", ...creditNotes.map((c) => `${c.cn_no}   ${prettyDate(c.cn_date)}   against ${c.bill_no}   ${money(c.total_paise)}   ${c.reason}`)]
        : []),
      "",
      `Updated automatically: ${new Date().toLocaleString("en-IN")}`,
      "Do not edit these files: they are rewritten whenever the client or a bill changes.",
    ];
    await writeAtomic(path.join(clientDir, "client-details.txt"), "﻿" + lines.join("\r\n") + "\r\n");
    await writeAtomic(
      path.join(clientDir, "client-data.json"),
      JSON.stringify({ exported_at: new Date().toISOString(), client, bills, credit_notes: creditNotes }, null, 2),
    );
  }

  // Run a task, remember whether it failed, and never throw (the API request must not fail because of files).
  async function safely<T>(fallback: T, task: () => Promise<T>): Promise<T> {
    if (!dir) return fallback;
    try {
      await fs.mkdir(dir, { recursive: true });
      const result = await enqueue(task);
      lastError = null;
      lastSync = new Date().toISOString();
      return result;
    } catch (e) {
      lastError = (e as Error).message;
      console.error("client folder update failed:", e);
      return fallback;
    }
  }

  return {
    syncClient: (clientId) =>
      safely(undefined, async () => writeClient(clientId, null, await loadOrg())),
    syncBill: (billId) =>
      safely(undefined, async () => {
        const row = (await db.query<{ client_id: number }>("SELECT client_id FROM bills WHERE id = $1", [billId])).rows[0];
        if (row) await writeClient(row.client_id, billId, await loadOrg());
      }),
    syncAll: () =>
      safely(0, async () => {
        const firm = await loadOrg();
        const ids = (await db.query<{ id: number }>("SELECT id FROM clients ORDER BY id")).rows;
        for (const { id } of ids) await writeClient(id, null, firm);
        return ids.length;
      }),
    status: () => ({ enabled: dir !== null, dir, lastError, lastSync }),
  };
}
