import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connect, migrate, type Db } from "../src/db/index.js";
import type { Mail, Mailer } from "../src/lib/mailer.js";

let db: Db;
let api: ReturnType<typeof request>;
let admin = "";
let staff = "";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const sent: Mail[] = [];
const fakeMailer: Mailer = { async send(m) { sent.push(m); } };

async function login(username: string, password: string) {
  return (await api.post("/api/auth/login").send({ username, password })).body.token as string;
}
const line = (price: number, description = "Audit") => ({ description, quantity: 1, unit_price_paise: price });
async function newClient(name: string, extra: object = {}) {
  const res = await api.post("/api/clients").set(auth(staff)).send({ name, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function newBill(clientId: number, body: object) {
  const res = await api.post("/api/bills").set(auth(staff)).send({ client_id: clientId, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function pay(billId: number, amount_paise: number, extra: object = {}) {
  const res = await api.post(`/api/bills/${billId}/payments`).set(auth(staff)).send({ amount_paise, method: "upi", ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
const newest = (bill: any) => bill.payments.reduce((m: any, p: any) => (!m || p.id > m.id ? p : m), null);
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const download = (url: string, token = staff) => api.get(url).set(auth(token)).buffer(true).parse(binary as never);

beforeAll(async () => {
  db = await connect("pglite:memory");
  await migrate(db);
  api = request(createApp(db, undefined, undefined, fakeMailer));
  await db.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ('boss', $1, 'The Boss', 'admin')", [await bcrypt.hash("boss-password", 4)]);
  admin = await login("boss", "boss-password");
  await api.post("/api/users").set(auth(admin)).send({ username: "asha", password: "asha-password", full_name: "Asha Staff" });
  staff = await login("asha", "asha-password");
});

afterAll(async () => {
  await db.close();
});

describe("payment receipts", () => {
  it("numbers a receipt for every payment, per financial year of the date received", async () => {
    const c = await newClient("Receipt Co");
    const bill = await newBill(c.id, { bill_date: "2024-03-01", items: [line(100_000)] });
    const a = newest(await pay(bill.id, 10_000, { paid_on: "2024-03-20" })); // FY 2023-24
    const b = newest(await pay(bill.id, 10_000, { paid_on: "2024-04-02" })); // FY 2024-25
    const c2 = newest(await pay(bill.id, 10_000, { paid_on: "2024-04-03" }));
    expect([a.receipt_no, b.receipt_no, c2.receipt_no]).toEqual(["RCT/2023-24/0001", "RCT/2024-25/0001", "RCT/2024-25/0002"]);
    const history = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items.map((h: any) => h.summary);
    expect(history.some((s: string) => s.includes("receipt RCT/2024-25/0002"))).toBe(true);
  });

  it("says part payment or full payment, with where the bill stood after it", async () => {
    const c = await newClient("Part Full Co", { phone: "9825012345" });
    const bill = await newBill(c.id, { bill_date: "2025-05-01", items: [line(300_000)] });
    const first = newest(await pay(bill.id, 100_000, { paid_on: "2025-05-10", reference: "UTR111" }));
    const second = newest(await pay(bill.id, 200_000, { paid_on: "2025-06-10", method: "cheque", reference: "000123" }));

    const r1 = (await api.get(`/api/payments/${first.id}/receipt`).set(auth(staff))).body;
    expect(r1).toMatchObject({ receipt_no: first.receipt_no, kind: "part", bill_total_paise: 300_000, received_before_paise: 0, balance_after_paise: 200_000, client_name: "Part Full Co" });
    const r2 = (await api.get(`/api/payments/${second.id}/receipt`).set(auth(staff))).body;
    expect(r2).toMatchObject({ kind: "full", received_before_paise: 100_000, balance_after_paise: 0 });

    const pdf = await download(`/api/payments/${second.id}/receipt.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(`Receipt ${second.receipt_no.replaceAll("/", "-")} - Part Full Co.pdf`);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await api.get("/api/payments/999999/receipt").set(auth(staff))).status).toBe(404);
  });

  it("counts a settlement made with the payment, so a settled short payment is a full payment", async () => {
    const c = await newClient("Haggle Co");
    const bill = await newBill(c.id, { bill_date: "2025-07-01", items: [line(150_000)] });
    const p = newest(await pay(bill.id, 120_000, { paid_on: "2025-07-15", settle_rest: true, settle_as: "discount", discount_reason: "Agreed" }));
    const r = (await api.get(`/api/payments/${p.id}/receipt`).set(auth(staff))).body;
    expect(r).toMatchObject({ kind: "full", reduced_paise: 30_000, balance_after_paise: 0 });
  });

  it("emails the receipt PDF to the client, and refuses when there is nowhere to send it", async () => {
    const withMail = await newClient("Mail Co", { email: "accounts@mail.example" });
    const bill = await newBill(withMail.id, { bill_date: "2025-08-01", items: [line(50_000)] });
    const p = newest(await pay(bill.id, 20_000, { paid_on: "2025-08-05" }));

    const res = await api.post(`/api/payments/${p.id}/receipt/email`).set(auth(staff)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ sent_to: "accounts@mail.example" });
    const mail = sent[sent.length - 1];
    expect(mail.to).toBe("accounts@mail.example");
    expect(mail.subject).toContain(p.receipt_no);
    expect(mail.text).toContain("Balance still due on this bill: ₹300.00");
    expect(mail.attachments?.[0].contentType).toBe("application/pdf");
    expect(mail.attachments?.[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    const history = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items;
    expect(history.some((h: any) => h.action === "receipt_emailed")).toBe(true);

    // Another address can be typed in; a bad one is refused.
    expect((await api.post(`/api/payments/${p.id}/receipt/email`).set(auth(staff)).send({ to: "partner@other.example" })).body.sent_to).toBe("partner@other.example");
    expect((await api.post(`/api/payments/${p.id}/receipt/email`).set(auth(staff)).send({ to: "not an email" })).status).toBe(400);

    const noMail = await newClient("No Mail Co");
    const b2 = await newBill(noMail.id, { bill_date: "2025-08-01", items: [line(50_000)] });
    const p2 = newest(await pay(b2.id, 50_000, { paid_on: "2025-08-05" }));
    const refused = await api.post(`/api/payments/${p2.id}/receipt/email`).set(auth(staff)).send({});
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/no email address/);
  });

  it("keeps a voided payment's number (its receipt says VOID) and carries on the series", async () => {
    const c = await newClient("Void Co", { email: "v@void.example" });
    const bill = await newBill(c.id, { bill_date: "2019-05-01", items: [line(80_000)] });
    const p = newest(await pay(bill.id, 30_000, { paid_on: "2019-05-02" }));
    expect(p.receipt_no).toBe("RCT/2019-20/0001");
    expect((await api.post(`/api/payments/${p.id}/void`).set(auth(admin)).send({ reason: "Bounced" })).status).toBe(200);
    expect((await api.post(`/api/payments/${p.id}/receipt/email`).set(auth(staff)).send({})).status).toBe(409);
    expect((await download(`/api/payments/${p.id}/receipt.pdf`)).status).toBe(200);
    const next = newest(await pay(bill.id, 30_000, { paid_on: "2019-05-03" }));
    expect(next.receipt_no).toBe("RCT/2019-20/0002");
  });
});

describe("payment dates in reports and exports", () => {
  it("lists receipts by the date received in the fees report, and the last payment date on each bill", async () => {
    const c = await newClient("Collected Co");
    const older = await newBill(c.id, { bill_date: "2018-12-01", items: [line(100_000)] }); // billed before the period
    const inside = await newBill(c.id, { bill_date: "2019-01-05", items: [line(200_000)] });
    await pay(older.id, 100_000, { paid_on: "2019-01-10", reference: "OLD" });
    await pay(inside.id, 50_000, { paid_on: "2019-01-20" });
    await pay(inside.id, 50_000, { paid_on: "2019-03-02" }); // after the period

    const r = (await api.get("/api/reports/fees?from=2019-01-01&to=2019-01-31").set(auth(admin))).body;
    expect(r.receipts.map((x: any) => [x.paid_on, x.bill_no, x.amount_paise, x.method])).toEqual([
      ["2019-01-10", older.bill_no, 100_000, "UPI"],
      ["2019-01-20", inside.bill_no, 50_000, "UPI"],
    ]);
    expect(r.summary).toMatchObject({ receipts: 2, collected_paise: 150_000 });
    expect(r.months).toEqual([{ month: "Jan 2019", bills: 1, fees_paise: 200_000, gst_paise: 0, reimbursement_paise: 0, received_paise: 100_000, collected_paise: 150_000 }]);
    expect(r.rows[0]).toMatchObject({ bill_no: inside.bill_no, last_paid_on: "2019-03-02" });

    const xlsx = await download("/api/reports/fees.xlsx?from=2019-01-01&to=2019-01-31", admin);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const sheet = wb.getWorksheet("Receipts")!;
    expect(sheet.getRow(2).getCell(5).value).toBe(older.bill_no);
    expect(sheet.getRow(2).getCell(9).value).toBe(1000);
    expect((await download("/api/reports/fees.pdf?from=2019-01-01&to=2019-01-31", admin)).body.subarray(0, 5).toString()).toBe("%PDF-");

    // The statement of account shows each receipt's number and date.
    const ledger = (await api.get(`/api/reports/ledger?client_id=${c.id}&from=2018-04-01&to=2019-03-31`).set(auth(staff))).body;
    const receipts = ledger.entries.filter((e: any) => e.type === "Payment");
    expect(receipts.map((e: any) => e.date)).toEqual(["2019-01-10", "2019-01-20", "2019-03-02"]);
    expect(receipts.every((e: any) => /^RCT\/2018-19\/\d{4}$/.test(e.ref))).toBe(true);

    // The bills list and the client statement carry the dates too.
    const list = (await api.get(`/api/bills?client_id=${c.id}`).set(auth(staff))).body.items;
    expect(list.find((b: any) => b.id === older.id).last_paid_on).toBe("2019-01-10");
    const st = (await api.get(`/api/exports/statement.csv?client_id=${c.id}`).set(auth(staff))).text;
    expect(st).toMatch(/2019-01-10,Payment,RCT\/2018-19\/\d{4}/);
  });
});

describe("upgrading: payments recorded before receipts existed", () => {
  it("numbers old payments in date order per financial year, and new ones carry on after them", async () => {
    const old = await connect("pglite:memory");
    try {
      // Build the database as it was before receipts (every migration up to 011).
      const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
      await old.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql") && x < "012").sort()) {
        await old.exec(fs.readFileSync(path.join(dir, f), "utf8"));
        await old.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      }
      await old.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ('u', 'x', 'U', 'admin')");
      await old.query("INSERT INTO clients (name) VALUES ('Old Client')");
      await old.query("INSERT INTO bills (bill_no, client_id, bill_date, subtotal_paise, total_paise, created_by, fy_start) VALUES ('2024-25/0001', 1, '2024-05-01', 900000, 900000, 1, 2024)");
      for (const d of ["2025-02-01", "2024-06-01", "2025-04-02", "2024-06-01"]) {
        await old.query("INSERT INTO payments (bill_id, amount_paise, paid_on, method, created_by) VALUES (1, 1000, $1::date, 'cash', 1)", [d]);
      }

      await migrate(old);
      const rows = (await old.query<{ id: number; receipt_no: string }>("SELECT id, receipt_no FROM payments ORDER BY id")).rows;
      expect(rows.map((r) => r.receipt_no)).toEqual(["RCT/2024-25/0003", "RCT/2024-25/0001", "RCT/2025-26/0001", "RCT/2024-25/0002"]);
      const series = (await old.query<{ series: string; last_value: number }>("SELECT series, last_value FROM number_series WHERE series LIKE 'RCT:%' ORDER BY series")).rows;
      expect(series).toEqual([{ series: "RCT:2024", last_value: 3 }, { series: "RCT:2025", last_value: 1 }]);
    } finally {
      await old.close();
    }
  });
});
