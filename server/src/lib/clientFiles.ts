import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../db/index.js";
import { getBill } from "../routes/bills.js";
import { loadLogo, loadSettings, type Settings } from "../routes/settings.js";

/**
 * A readable backup kept on the PC's disk, one folder per client:
 *
 *   <client files folder>/
 *     Rajesh Patel/
 *       client-details.txt     the client's details and a list of their bills
 *       client-data.json       the same data in full, for programs
 *       bills/
 *         INV-000007_2026-11-05.html    each bill, printable in any browser
 *
 * Folders are only ever added to or renamed, never deleted, even when a client is deleted in the app.
 * A problem writing files is logged and shown in Settings, but never stops a bill from being saved.
 */
export interface ClientFiles {
  syncClient(clientId: number): Promise<void>;
  /** Writes one bill's file, then refreshes that client's summary files. */
  syncBill(billId: number): Promise<void>;
  /** Rebuilds every client's folder from the database. Returns how many clients were written. */
  syncAll(): Promise<number>;
  status(): { enabled: boolean; dir: string | null; lastError: string | null; lastSync: string | null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const money = (paise: number) => rupees.format(paise / 100);
const prettyDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
};
const fyLabel = (start: number) => `${start}-${String(start + 1).slice(2)}`;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

/** The firm's bank / UPI details as label-value pairs, leaving out anything not filled in. */
export function paymentLines(org: Settings): [string, string][] {
  const all: [string, string][] = [
    ["Account name", org.bank_account_holder],
    ["Bank", org.bank_name],
    ["Account number", org.bank_account_number],
    ["IFSC", org.bank_ifsc],
    ["Branch", org.bank_branch],
    ["UPI ID", org.upi_id],
  ];
  return all.filter(([, v]) => v);
}

export function renderBillHtml(bill: any, org: Settings, logoUri: string | null = null): string {
  const pay = paymentLines(org);
  const paymentHtml =
    pay.length || org.payment_instructions
      ? `<div class="pay"><div class="m">Payment details: please pay to</div>
<table class="pt">${pay.map(([k, v]) => `<tr><td class="m">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
${org.payment_instructions ? `<div style="white-space:pre-line">${esc(org.payment_instructions)}</div>` : ""}</div>`
      : "";
  const rows = bill.items
    .map(
      (i: any) => `<tr><td><div class="it">${esc(i.description)}</div>${i.details ? `<div class="d">${esc(i.details)}</div>` : ""}</td>
<td class="n">${i.quantity}</td><td class="n">${money(i.unit_price_paise)}</td><td class="n">${money(i.line_total_paise)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(bill.bill_no)} - ${esc(bill.client_name)}</title>
<style>
body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#1d2733;max-width:780px;margin:2rem auto;padding:0 1rem}
h1{margin:0 0 .25rem;font-size:1.5rem} .m{color:#667085} .head{display:flex;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}
table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:.5rem;border-bottom:1px solid #d9dee6;vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;color:#667085} .n{text-align:right} .it{font-size:1.1rem;font-weight:700;line-height:1.3}
.d{color:#667085;font-size:.8rem;line-height:1.45;margin-top:.2rem;white-space:pre-line}
.t{margin:1rem 0 0 auto;width:300px} .t div{display:flex;justify-content:space-between;padding:.15rem 0}
.g{border-top:2px solid #1d2733;margin-top:.3rem;padding-top:.35rem;font-weight:700;font-size:1.1rem} .id{font-size:1.2rem;font-weight:700}
.logo{max-height:80px;max-width:260px;display:block;margin-bottom:.5rem}
.pay{margin-top:1.25rem;border:1px solid #d9dee6;border-radius:6px;padding:.75rem 1rem;break-inside:avoid}
.pt{width:auto;margin:.25rem 0 .5rem} .pt td{border:0;padding:.1rem 1rem .1rem 0}
@page{margin:0}
@media print{body{margin:0;max-width:none;padding:14mm 16mm}}
</style></head><body>
<div class="head"><div>${logoUri ? `<img class="logo" src="${logoUri}" alt="">` : ""}<h1>${esc(org.org_name || "Invoice")}</h1>
<div class="m" style="white-space:pre-line">${esc(org.org_address)}</div>${org.org_gstin ? `<div class="m">GSTIN: ${esc(org.org_gstin)}</div>` : ""}</div>
<div style="text-align:right"><div class="id">${esc(bill.bill_no)}</div><div><strong>${prettyDate(bill.bill_date)}</strong></div>
<div class="m">Financial year ${fyLabel(bill.fy_start)}</div></div></div>
<div style="margin-bottom:1rem"><div class="m">Billed to</div><strong>${esc(bill.client_name)}</strong>
${bill.client_address ? `<div style="white-space:pre-line">${esc(bill.client_address)}</div>` : ""}
<div class="m">${esc([bill.client_city, bill.client_phone].filter(Boolean).join(" · "))}</div>
${bill.client_gstin ? `<div class="m">GSTIN: ${esc(bill.client_gstin)}</div>` : ""}${bill.client_pan ? `<div class="m">PAN: ${esc(bill.client_pan)}</div>` : ""}</div>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>
${rows}
</tbody></table>
<div class="t"><div><span>Subtotal</span><span>${money(bill.subtotal_paise)}</span></div>
${bill.gst_rate_percent > 0 ? `<div><span>GST @ ${bill.gst_rate_percent}%</span><span>${money(bill.gst_paise)}</span></div>` : ""}
<div class="g"><span>Total</span><span>${money(bill.total_paise)}</span></div></div>
${bill.notes ? `<p style="white-space:pre-line"><span class="m">Notes</span><br>${esc(bill.notes)}</p>` : ""}
${paymentHtml}
<p class="m" style="font-size:.8rem">Created by ${esc(bill.created_by_name)}${bill.updated_by_name ? `, last edited by ${esc(bill.updated_by_name)}` : ""}.
This is an automatic copy kept for backup; the original is in Billing Software.</p>
</body></html>
`;
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

  // The firm's details and logo, loaded once per operation. The logo is embedded in each bill copy
  // so the file still shows it when opened on its own, offline, or emailed.
  async function loadOrg(): Promise<{ org: Settings; logoUri: string | null }> {
    const [org, logo] = await Promise.all([loadSettings(db), loadLogo(db)]);
    return { org, logoUri: logo ? `data:${logo.contentType};base64,${logo.data.toString("base64")}` : null };
  }

  async function writeClient(clientId: number, onlyBillId: number | null, firm: { org: Settings; logoUri: string | null }) {
    const client = (await db.query<any>("SELECT * FROM clients WHERE id = $1", [clientId])).rows[0];
    if (!client) return;
    const folder = await resolveFolder(client);
    const clientDir = path.join(dir!, folder);
    const billsDir = path.join(clientDir, "bills");
    await fs.mkdir(billsDir, { recursive: true });

    const ids = (await db.query<{ id: number }>("SELECT id FROM bills WHERE client_id = $1 ORDER BY bill_date, id", [clientId])).rows;
    const bills = [];
    for (const { id } of ids) bills.push(await getBill(db, id));

    const fileFor = (b: any) => `${b.bill_no}_${b.bill_date}.html`;
    const existing = (await fs.readdir(billsDir)).filter((f) => /^INV-\d+_.*\.html$/.test(f));
    const wanted = new Set(bills.map(fileFor));

    for (const b of bills) {
      if (onlyBillId !== null && b.id !== onlyBillId && existing.includes(fileFor(b))) continue;
      await writeAtomic(path.join(billsDir, fileFor(b)), renderBillHtml(b, firm.org, firm.logoUri));
    }
    // Remove copies that no longer match: a bill whose date changed, or that moved to another client.
    for (const f of existing) if (!wanted.has(f)) await fs.rm(path.join(billsDir, f), { force: true });

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
      `BILLS (${bills.length})`,
      "-----------",
      ...bills.map(
        (b) => `${b.bill_no}   ${prettyDate(b.bill_date)}   FY ${fyLabel(b.fy_start)}   ${money(b.total_paise)}`,
      ),
      "",
      `Updated automatically: ${new Date().toLocaleString("en-IN")}`,
      "Do not edit these files: they are rewritten whenever the client or a bill changes.",
    ];
    await writeAtomic(path.join(clientDir, "client-details.txt"), "﻿" + lines.join("\r\n") + "\r\n");
    await writeAtomic(
      path.join(clientDir, "client-data.json"),
      JSON.stringify({ exported_at: new Date().toISOString(), client, bills }, null, 2),
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
