import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connect, migrate, type Db } from "../src/db/index.js";
import { createBackups } from "../src/lib/backups.js";
import { addDays, todayISO } from "../src/lib/fy.js";
import { nextDocumentNumber } from "../src/lib/numbering.js";

let db: Db;
let api: ReturnType<typeof request>;
let admin = "";
let staff = "";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const today = todayISO();

async function login(username: string, password: string) {
  return (await api.post("/api/auth/login").send({ username, password })).body.token as string;
}

async function newClient(name: string, extra: object = {}) {
  const res = await api.post("/api/clients").set(auth(staff)).send({ name, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

const line = (price = 100_000, description = "Audit", quantity = 1, details?: string) => ({ description, details, quantity, unit_price_paise: price });

async function newBill(clientId: number, body: object = {}) {
  const res = await api.post("/api/bills").set(auth(staff)).send({ client_id: clientId, items: [line()], ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

const pay = (billId: number, amount_paise: number, extra: object = {}, token = staff) =>
  api.post(`/api/bills/${billId}/payments`).set(auth(token)).send({ amount_paise, method: "upi", ...extra });

beforeAll(async () => {
  db = await connect("pglite:memory");
  await migrate(db);
  api = request(createApp(db));
  await db.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ('boss', $1, 'The Boss', 'admin')", [await bcrypt.hash("boss-password", 4)]);
  admin = await login("boss", "boss-password");
  await api.post("/api/users").set(auth(admin)).send({ username: "asha", password: "asha-password", full_name: "Asha Staff" });
  staff = await login("asha", "asha-password");
});

afterAll(async () => {
  await db.close();
});

describe("gap-free numbering, restarting each financial year", () => {
  it("numbers bills 0001, 0002, 0003 within a financial year", async () => {
    const c = await newClient("Numbering Co");
    const a = await newBill(c.id, { bill_date: "2030-05-10" });
    const b = await newBill(c.id, { bill_date: "2030-06-10" });
    const d = await newBill(c.id, { bill_date: "2031-02-10" }); // still FY 2030-31
    expect([a.bill_no, b.bill_no, d.bill_no]).toEqual(["2030-31/0001", "2030-31/0002", "2030-31/0003"]);
  });

  it("starts again at 0001 in the next financial year (31 March and 1 April are different years)", async () => {
    const c = await newClient("New Year Co");
    const mar = await newBill(c.id, { bill_date: "2032-03-31" });
    const apr = await newBill(c.id, { bill_date: "2032-04-01" });
    expect(mar.bill_no).toBe("2031-32/0001");
    expect(apr.bill_no).toBe("2032-33/0001");
  });

  it("gives a back-dated bill the next number of ITS OWN year's series", async () => {
    const c = await newClient("Backdated Co");
    await newBill(c.id, { bill_date: "2040-05-01" });
    await newBill(c.id, { bill_date: "2040-06-01" });
    const old = await newBill(c.id, { bill_date: "2039-07-01" });
    expect(old.bill_no).toBe("2039-40/0001");
  });

  it("does not use up a number when a save fails (the counter rolls back with it)", async () => {
    // Taking a number and then failing, inside one transaction, must leave the next number unchanged.
    await db.tx(async (q) => {
      expect(await nextDocumentNumber(q, "INV", "2050-05-01")).toBe("2050-51/0001");
      throw new Error("the save failed after the number was taken");
    }).catch(() => undefined);
    await db.tx(async (q) => {
      expect(await nextDocumentNumber(q, "INV", "2050-05-01")).toBe("2050-51/0001"); // same number again: no gap
    });
  });

  it("does not use up a number when a bill is rejected", async () => {
    const c = await newClient("Rejected Co");
    const first = await newBill(c.id, { bill_date: "2060-05-01" });
    const bad = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, bill_date: "2060-05-02", items: [{ service_id: 999999, ...line() }] });
    expect(bad.status).toBe(400);
    const second = await newBill(c.id, { bill_date: "2060-05-03" });
    expect(first.bill_no).toBe("2060-61/0001");
    expect(second.bill_no).toBe("2060-61/0002");
  });

  it("gives every bill saved at the same moment a different, consecutive number", async () => {
    const c = await newClient("Rush Co");
    const results = await Promise.all(Array.from({ length: 12 }, () => api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, bill_date: "2070-05-01", items: [line()] })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.bill_no as string).sort();
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => `2070-71/${String(i + 1).padStart(4, "0")}`));
  });

  it("keeps the bill number and financial year when a bill is edited, and refuses to change the year", async () => {
    const c = await newClient("Edit Number Co");
    const bill = await newBill(c.id, { bill_date: "2080-05-01" });
    const ok = await api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: c.id, bill_date: "2080-09-01", due_date: "2080-09-16", items: [line(250_000)] });
    expect(ok.status).toBe(200);
    expect(ok.body.bill_no).toBe(bill.bill_no);
    // The bill date is only the date printed on the bill: it may move past 31 March without changing the year.
    const redated = await api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: c.id, bill_date: "2081-04-01", due_date: "2081-04-16", items: [line(250_000)] });
    expect(redated.status).toBe(200);
    expect(redated.body).toMatchObject({ bill_no: bill.bill_no, fy_start: 2080, bill_date: "2081-04-01" });
    const moved = await api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: c.id, fy_start: 2081, bill_date: "2081-04-01", items: [line(250_000)] });
    expect(moved.status).toBe(400);
    expect(moved.body.error).toMatch(/financial year 2080-81/);
  });
});

describe("financial year chosen separately from the bill date", () => {
  it("numbers, files and filters a bill by the year chosen, not by its date", async () => {
    const c = await newClient("Old Year Work Co");
    // Dated 2095 for work of FY 1993-94: e.g. an audit of an earlier year billed late.
    const late = await newBill(c.id, { bill_date: "2095-06-10", fy_start: 1993 });
    expect(late).toMatchObject({ fy_start: 1993, bill_date: "2095-06-10" });
    expect(late.bill_no).toBe("1993-94/0001");
    const next = await newBill(c.id, { bill_date: "2095-06-11", fy_start: 1993 });
    expect(next.bill_no).toBe("1993-94/0002");
    // The date's own year has its own, untouched series.
    const current = await newBill(c.id, { bill_date: "2095-06-12" });
    expect(current).toMatchObject({ fy_start: 2095, bill_no: "2095-96/0001" });

    const in1993 = (await api.get(`/api/bills?client_id=${c.id}&fy=1993`).set(auth(staff))).body.items.map((b: any) => b.id);
    expect(in1993.sort()).toEqual([late.id, next.id].sort());
    const in2095 = (await api.get(`/api/bills?client_id=${c.id}&fy=2095`).set(auth(staff))).body.items.map((b: any) => b.id);
    expect(in2095).toEqual([current.id]);
    const years = (await api.get("/api/bills/financial-years").set(auth(staff))).body.items.map((y: any) => y.fy_start);
    expect(years).toContain(1993);
    const summary = (await api.get("/api/bills/summary?fy=1993").set(auth(staff))).body;
    expect(summary.billed_paise).toBeGreaterThanOrEqual(late.total_paise + next.total_paise);
  });

  it("uses the bill date's year when no year is given, and refuses a year too far ahead or too old", async () => {
    const c = await newClient("Default Year Co");
    expect((await newBill(c.id, { bill_date: "2097-03-31" })).fy_start).toBe(2096);
    const ahead = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, fy_start: Number(today.slice(0, 4)) + 3, items: [line()] });
    expect(ahead.status).toBe(400);
    expect(ahead.body.error).toMatch(/too far in the future/);
    const ancient = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, fy_start: 1985, items: [line()] });
    expect(ancient.status).toBe(400);
  });
});

describe("due dates", () => {
  it("defaults to the bill date plus the payment terms, and follows a changed setting", async () => {
    const c = await newClient("Terms Co");
    const a = await newBill(c.id, { bill_date: "2090-05-01" });
    expect(a.due_date).toBe("2090-05-16"); // 15 days by default
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 18, payment_terms_days: 30 });
    const b = await newBill(c.id, { bill_date: "2090-05-01" });
    expect(b.due_date).toBe("2090-05-31");
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 18, payment_terms_days: 15 });
  });

  it("accepts a chosen due date and refuses one before the bill date", async () => {
    const c = await newClient("Due Co");
    const ok = await newBill(c.id, { bill_date: "2091-05-01", due_date: "2091-05-05" });
    expect(ok.due_date).toBe("2091-05-05");
    const bad = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, bill_date: "2091-05-10", due_date: "2091-05-01", items: [line()] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/due date cannot be before/);
  });

  it("validates the new settings", async () => {
    const put = (body: object) => api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 18, ...body });
    expect((await put({ payment_terms_days: -1 })).status).toBe(400);
    expect((await put({ payment_terms_days: 400 })).status).toBe(400);
    expect((await put({ default_country_code: "+91" })).body.error).toMatch(/digits only/);
    const ok = await put({ default_country_code: "44", payment_terms_days: 15 });
    expect(ok.body).toMatchObject({ default_country_code: "44", payment_terms_days: 15 });
    await put({ default_country_code: "91" });
  });
});

describe("payments", () => {
  it("tracks part payments, the balance and when a bill is paid", async () => {
    const c = await newClient("Pay Co");
    const bill = await newBill(c.id, { items: [line(100_000)] });
    expect(bill).toMatchObject({ state: "open", paid_paise: 0, balance_paise: 100_000, amounts_locked: false });

    const part = await pay(bill.id, 40_000, { method: "cash", reference: "receipt 12" });
    expect(part.status).toBe(201);
    expect(part.body).toMatchObject({ state: "open", part_paid: true, paid_paise: 40_000, balance_paise: 60_000, amounts_locked: true });
    expect(part.body.payments[0]).toMatchObject({ amount_paise: 40_000, method: "cash", reference: "receipt 12", created_by_name: "Asha Staff" });

    const rest = await pay(bill.id, 60_000);
    expect(rest.body).toMatchObject({ state: "paid", paid_paise: 100_000, balance_paise: 0 });
  });

  it("refuses overpayment, nothing-left bills, bad methods, zero and future dates", async () => {
    const c = await newClient("Reject Pay Co");
    const bill = await newBill(c.id, { items: [line(10_000)] });
    expect((await pay(bill.id, 10_001)).body.error).toMatch(/more than the balance due \(₹100\.00\)/);
    expect((await pay(bill.id, 0)).status).toBe(400);
    expect((await pay(bill.id, 100, { method: "barter" })).body.error).toMatch(/Choose how it was paid/);
    expect((await pay(bill.id, 100, { paid_on: addDays(today, 3) })).body.error).toMatch(/future/);
    await pay(bill.id, 10_000);
    expect((await pay(bill.id, 1)).body.error).toMatch(/nothing left to pay/);
    expect((await pay(999999, 100)).status).toBe(404);
  });

  it("voids a wrong payment (admin only), keeping it on the record but not counting it", async () => {
    const c = await newClient("Void Co");
    const bill = await newBill(c.id, { items: [line(50_000)] });
    const paid = await pay(bill.id, 50_000);
    const paymentId = paid.body.payments[0].id;
    expect((await api.post(`/api/payments/${paymentId}/void`).set(auth(staff)).send({ reason: "typo" })).status).toBe(403);
    expect((await api.post(`/api/payments/${paymentId}/void`).set(auth(admin)).send({ reason: "x" })).status).toBe(400);
    const voided = await api.post(`/api/payments/${paymentId}/void`).set(auth(admin)).send({ reason: "Entered on the wrong bill" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ state: "open", paid_paise: 0, balance_paise: 50_000, amounts_locked: false });
    expect(voided.body.payments).toHaveLength(1);
    expect(voided.body.payments[0]).toMatchObject({ void_reason: "Entered on the wrong bill", voided_by_name: "The Boss" });
    expect((await api.post(`/api/payments/${paymentId}/void`).set(auth(admin)).send({ reason: "again" })).status).toBe(409);
    expect((await pay(bill.id, 50_000)).status).toBe(201); // the balance is open again
  });

  it("lists bills by status and totals what is outstanding and overdue", async () => {
    const c = await newClient("Status Co");
    const open = await newBill(c.id, { bill_date: "2100-05-01", due_date: "2100-05-10", items: [line(30_000)] });
    const late = await newBill(c.id, { bill_date: "2000-05-01", due_date: "2000-05-10", items: [line(70_000)] });
    const settled = await newBill(c.id, { bill_date: "2100-05-02", items: [line(20_000)] });
    await pay(settled.id, 20_000);
    const gone = await newBill(c.id, { bill_date: "2100-05-03", items: [line(5_000)] });
    await api.post(`/api/bills/${gone.id}/cancel`).set(auth(admin)).send({ reason: "Made by mistake" });

    const ids = async (status: string) => (await api.get(`/api/bills?client_id=${c.id}&status=${status}`).set(auth(staff))).body.items.map((b: any) => b.id).sort();
    expect(await ids("outstanding")).toEqual([open.id, late.id].sort());
    expect(await ids("overdue")).toEqual([late.id]);
    expect(await ids("paid")).toEqual([settled.id]);
    expect(await ids("cancelled")).toEqual([gone.id]);
    expect((await api.get("/api/bills?status=nonsense").set(auth(staff))).status).toBe(400);

    const row = (await api.get(`/api/bills?client_id=${c.id}&status=overdue`).set(auth(staff))).body.items[0];
    expect(row).toMatchObject({ overdue: true, state: "open", balance_paise: 70_000, paid_paise: 0 });

    const sum = (await api.get("/api/bills/summary?fy=2000").set(auth(staff))).body;
    expect(sum).toMatchObject({ outstanding_paise: 70_000, outstanding_count: 1, overdue_paise: 70_000, overdue_count: 1, billed_paise: 70_000, collected_paise: 0 });
    const sum2100 = (await api.get("/api/bills/summary?fy=2100").set(auth(staff))).body;
    expect(sum2100).toMatchObject({ billed_paise: 50_000, collected_paise: 20_000, outstanding_paise: 30_000, outstanding_count: 1 }); // cancelled bill left out
  });
});

describe("change history and edit rules", () => {
  it("records who changed a bill and how, and keeps the version before each edit", async () => {
    const c = await newClient("History Co");
    const bill = await newBill(c.id, { items: [line(100_000, "Audit")], notes: "first" });
    await api.put(`/api/bills/${bill.id}`).set(auth(admin)).send({ client_id: c.id, notes: "second", items: [line(150_000, "Audit"), line(5_000, "Extra")] });
    const h = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items;
    expect(h.map((e: any) => e.action)).toEqual(["edited", "created"]); // newest first
    expect(h[1]).toMatchObject({ changed_by_name: "Asha Staff" });
    expect(h[0].changed_by_name).toBe("The Boss");
    expect(h[0].summary).toContain("Items changed (1 item to 2)");
    expect(h[0].summary).toMatch(/Total changed from ₹1,000\.00 to ₹1,550\.00/);
    expect(h[0].summary).toContain("Notes changed");
    expect(h[0].before_data).toMatchObject({ total_paise: 100_000, notes: "first" });
    expect(h[0].before_data.items).toHaveLength(1);
  });

  it("records nothing when an edit changes nothing", async () => {
    const c = await newClient("No Change Co");
    const bill = await newBill(c.id, { items: [line(100_000)] });
    const same = await api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: c.id, items: [line(100_000)] });
    expect(same.status).toBe(200);
    expect((await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items).toHaveLength(1); // only "created"
  });

  it("locks the client, date and items once a payment or credit note exists, but allows notes and due date", async () => {
    const c = await newClient("Locked Co");
    const bill = await newBill(c.id, { bill_date: "2110-05-01", items: [line(100_000)] });
    await pay(bill.id, 10_000);
    const edit = (body: object) => api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: c.id, bill_date: "2110-05-01", items: [line(100_000)], ...body });
    expect((await edit({ items: [line(200_000)] })).status).toBe(409);
    expect((await edit({ items: [line(200_000)] })).body.error).toMatch(/Issue a credit note/);
    expect((await edit({ bill_date: "2110-05-09" })).status).toBe(409);
    const other = await newClient("Other Co");
    expect((await api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: other.id, bill_date: "2110-05-01", items: [line(100_000)] })).status).toBe(409);
    const notes = await edit({ notes: "Chased by phone", due_date: "2110-06-30" });
    expect(notes.status).toBe(200);
    expect(notes.body).toMatchObject({ notes: "Chased by phone", due_date: "2110-06-30" });
  });

  it("cancels a bill (admin only, with a reason), keeping its number and removing it from the totals", async () => {
    const c = await newClient("Cancel Co");
    const bill = await newBill(c.id, { bill_date: "2120-05-01" });
    const cancel = (token: string, reason = "Issued to the wrong client") => api.post(`/api/bills/${bill.id}/cancel`).set(auth(token)).send({ reason });
    expect((await cancel(staff)).status).toBe(403);
    expect((await cancel(admin, "")).status).toBe(400);
    const done = await cancel(admin);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "cancelled", state: "cancelled", balance_paise: 0, cancel_reason: "Issued to the wrong client", cancelled_by_name: "The Boss", bill_no: bill.bill_no });
    expect((await cancel(admin)).status).toBe(409);
    expect((await api.put(`/api/bills/${bill.id}`).set(auth(staff)).send({ client_id: c.id, items: [line(1)] })).status).toBe(409);
    expect((await pay(bill.id, 100)).status).toBe(409);
    // the number is not reused
    const next = await newBill(c.id, { bill_date: "2120-05-02" });
    expect(next.bill_no).not.toBe(bill.bill_no);
    expect(next.bill_no.endsWith("0002")).toBe(true);
    const h = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items;
    expect(h[0]).toMatchObject({ action: "cancelled" });
  });

  it("will not cancel a bill that has payments or credit notes", async () => {
    const c = await newClient("No Cancel Co");
    const paid = await newBill(c.id);
    await pay(paid.id, 1_000);
    const r = await api.post(`/api/bills/${paid.id}/cancel`).set(auth(admin)).send({ reason: "changed my mind" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/payments recorded/);
  });
});

describe("credit notes", () => {
  const credit = (billId: number, body: object, token = admin) => api.post(`/api/bills/${billId}/credit-notes`).set(auth(token)).send(body);

  it("issues a credit note that reduces the balance, with its own consecutive number", async () => {
    const c = await newClient("Credit Co");
    const bill = await newBill(c.id, { bill_date: "2001-05-01", items: [line(100_000, "Audit", 2)] }); // 2,000.00
    expect((await credit(bill.id, { reason: "Discount agreed", items: [line(30_000, "Audit discount")] }, staff)).status).toBe(403);

    const first = await credit(bill.id, { reason: "Discount agreed", cn_date: "2001-05-20", items: [line(30_000, "Audit discount")] });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ cn_no: "CN/2001-02/0001", total_paise: 30_000, bill_no: bill.bill_no, created_by_name: "The Boss", client_name: "Credit Co" });
    expect(first.body.items).toHaveLength(1);
    const second = await credit(bill.id, { reason: "Short delivery", cn_date: "2001-05-21", items: [line(20_000, "Adjustment")] });
    expect(second.body.cn_no).toBe("CN/2001-02/0002");

    const after = (await api.get(`/api/bills/${bill.id}`).set(auth(staff))).body;
    expect(after).toMatchObject({ credited_paise: 50_000, balance_paise: 150_000, state: "open", amounts_locked: true });
    expect(after.credit_notes.map((n: any) => n.cn_no)).toEqual(["CN/2001-02/0001", "CN/2001-02/0002"]);
    expect((await api.get(`/api/credit-notes/${first.body.id}`).set(auth(staff))).body.cn_no).toBe("CN/2001-02/0001");
    expect((await api.get("/api/credit-notes/999999").set(auth(staff))).status).toBe(404);
  });

  it("uses the GST rate of the bill it corrects, not today's setting", async () => {
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: true, gst_rate_percent: 18 });
    const c = await newClient("Gst Credit Co");
    const bill = await newBill(c.id, { bill_date: "2002-05-01", items: [line(100_000)] });
    expect(bill).toMatchObject({ gst_rate_percent: 18, total_paise: 118_000 });
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 5 });
    const cn = await credit(bill.id, { reason: "Half refunded", cn_date: "2002-05-02", items: [line(50_000, "Half")] });
    expect(cn.body).toMatchObject({ gst_rate_percent: 18, subtotal_paise: 50_000, gst_paise: 9_000, total_paise: 59_000 });
    expect((await api.get(`/api/bills/${bill.id}`).set(auth(staff))).body.balance_paise).toBe(59_000);
  });

  it("cannot credit more than is still unpaid, and cannot credit a paid-up or cancelled bill", async () => {
    const c = await newClient("Limit Co");
    const bill = await newBill(c.id, { bill_date: "2003-05-01", items: [line(100_000)] });
    await pay(bill.id, 60_000);
    const tooMuch = await credit(bill.id, { reason: "Too much", cn_date: "2003-05-02", items: [line(40_001)] });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/at most the amount still unpaid.*₹400\.00/);
    expect((await credit(bill.id, { reason: "Exactly the rest", cn_date: "2003-05-02", items: [line(40_000)] })).status).toBe(201);
    expect((await api.get(`/api/bills/${bill.id}`).set(auth(staff))).body.balance_paise).toBe(0);
    expect((await credit(bill.id, { reason: "Nothing left", cn_date: "2003-05-03", items: [line(1)] })).body.error).toMatch(/nothing left to credit/);

    const cancelled = await newBill(c.id, { bill_date: "2003-06-01" });
    await api.post(`/api/bills/${cancelled.id}/cancel`).set(auth(admin)).send({ reason: "Mistake" });
    expect((await credit(cancelled.id, { reason: "x y z", items: [line(100)] })).status).toBe(409);
  });

  it("validates dates and content, and a fully credited bill shows as credited", async () => {
    const c = await newClient("Validate Credit Co");
    const bill = await newBill(c.id, { bill_date: "2004-05-10", items: [line(10_000)] });
    expect((await credit(bill.id, { reason: "Early", cn_date: "2004-05-09", items: [line(100)] })).body.error).toMatch(/before the bill date/);
    expect((await credit(bill.id, { reason: "Late", cn_date: addDays(today, 5), items: [line(100)] })).body.error).toMatch(/future/);
    expect((await credit(bill.id, { reason: "Free", cn_date: "2004-05-11", items: [line(0)] })).body.error).toMatch(/more than zero/);
    expect((await credit(bill.id, { reason: "", cn_date: "2004-05-11", items: [line(100)] })).status).toBe(400);
    expect((await credit(bill.id, { reason: "No lines", cn_date: "2004-05-11", items: [] })).body.error).toMatch(/at least one line/);
    expect((await credit(999999, { reason: "Ghost bill", items: [line(1)] })).status).toBe(404);
    await credit(bill.id, { reason: "Whole bill", cn_date: "2004-05-11", items: [line(10_000)] });
    expect((await api.get(`/api/bills/${bill.id}`).set(auth(staff))).body).toMatchObject({ state: "credited", balance_paise: 0 });
  });

  it("records the credit note in the bill's history", async () => {
    const c = await newClient("Credit History Co");
    const bill = await newBill(c.id, { bill_date: "2005-05-01", items: [line(10_000)] });
    await credit(bill.id, { reason: "Goodwill", cn_date: "2005-05-02", items: [line(2_500)] });
    const h = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items;
    expect(h[0]).toMatchObject({ action: "credit_note_issued" });
    expect(h[0].summary).toBe("Credit note CN/2005-06/0001 issued for ₹25.00: Goodwill");
  });
});

describe("CSV exports for filing", () => {
  const csv = async (url: string) => {
    const res = await api.get(url).set(auth(staff));
    expect(res.status, res.text).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename=/);
    return res.text;
  };

  it("exports the bills register in Excel-friendly form, honouring the filters", async () => {
    const c = await newClient("Register Co", { gstin: "24AAAAA0000A1Z5" });
    const bill = await newBill(c.id, { bill_date: "2180-05-01", due_date: "2180-05-10", items: [line(123_456, "Work", 2)] });
    await pay(bill.id, 100_000);
    const text = await csv(`/api/exports/bills.csv?client_id=${c.id}&fy=2180`);
    expect(text.startsWith("﻿")).toBe(true); // byte-order mark, so Excel reads the rupee sign and names correctly
    const rows = text.slice(1).trim().split("\r\n");
    expect(rows[0]).toBe("Bill no.,Bill date,Financial year,Due date,Client,Client GSTIN,Status,Overdue,Subtotal,GST rate %,GST,Total,Credit notes,Paid,Discount,Balance due,Created by");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(`${bill.bill_no},2180-05-01,2180-81,2180-05-10,Register Co,24AAAAA0000A1Z5,Part paid,No,2469.12,0,0.00,2469.12,0.00,1000.00,0.00,1469.12,Asha Staff`);
    expect((await csv(`/api/exports/bills.csv?client_id=${c.id}&fy=2179`)).slice(1).trim().split("\r\n")).toHaveLength(1); // header only
    expect((await api.get("/api/exports/bills.csv?status=bogus").set(auth(staff))).status).toBe(400);
  });

  it("stops a client name from being run as a spreadsheet formula", async () => {
    const evil = await newClient('=HYPERLINK("http://example.com","click")');
    await newBill(evil.id, { bill_date: "2190-05-01" });
    const text = await csv(`/api/exports/bills.csv?client_id=${evil.id}`);
    expect(text).toContain(`"'=HYPERLINK(""http://example.com"",""click"")"`); // apostrophe in front, quotes doubled
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("exports a client statement with a running balance that matches what is owed", async () => {
    const c = await newClient("Statement Co");
    const a = await newBill(c.id, { bill_date: "2006-05-01", items: [line(100_000)] });
    const b = await newBill(c.id, { bill_date: "2006-06-01", items: [line(50_000)] });
    const wrong = await pay(a.id, 25_000, { paid_on: "2006-05-20", method: "cash" });
    await api.post(`/api/payments/${wrong.body.payments[0].id}/void`).set(auth(admin)).send({ reason: "Wrong bill" }); // must not appear
    await pay(a.id, 40_000, { paid_on: "2006-05-25", method: "bank_transfer", reference: "UTR123" });
    await api.post(`/api/bills/${b.id}/credit-notes`).set(auth(admin)).send({ reason: "Discount", cn_date: "2006-06-10", items: [line(10_000)] });
    const gone = await newBill(c.id, { bill_date: "2006-07-01", items: [line(7_000)] });
    await api.post(`/api/bills/${gone.id}/cancel`).set(auth(admin)).send({ reason: "Mistake" });

    const text = await csv(`/api/exports/statement.csv?client_id=${c.id}`);
    const rows = text.slice(1).trim().split("\r\n").map((r) => r.split(","));
    expect(rows[0]).toEqual(["Date", "Type", "Number", "Details", "Billed", "Received or credited", "Balance"]);
    const types = rows.slice(1, -1).map((r) => r[1]);
    expect(types).toEqual(["Bill", "Payment", "Bill", "Credit note", "Bill", "Cancelled"]);
    expect(text).toContain("bank transfer - UTR123");
    expect(text).not.toContain("cash"); // the voided payment is not in the statement
    const last = rows[rows.length - 1];
    expect(last[3]).toBe("Balance due");
    // 1000.00 + 500.00 + 70.00 - 70.00 (cancelled) - 400.00 paid - 100.00 credited = 1000.00
    expect(last[last.length - 1]).toBe("1000.00");
    const bills = (await api.get(`/api/bills?client_id=${c.id}`).set(auth(staff))).body.items;
    expect(bills.reduce((s: number, x: any) => s + x.balance_paise, 0)).toBe(100_000);
    expect((await api.get("/api/exports/statement.csv").set(auth(staff))).status).toBe(400);
    expect((await api.get("/api/exports/statement.csv?client_id=999999").set(auth(staff))).status).toBe(404);
  });
});

describe("discounts: the client pays less and the firm agrees to settle", () => {
  it("leaves a bill paid in full exactly as it was: no discount is ever assumed", async () => {
    const c = await newClient("Full Payer Co");
    const bill = await newBill(c.id, { bill_date: "2020-05-01", items: [line(1_500_000)] });
    const paid = (await pay(bill.id, 1_500_000, { paid_on: "2020-05-10" })).body;
    expect(paid).toMatchObject({ state: "paid", paid_paise: 1_500_000, discount_paise: 0, balance_paise: 0, total_paise: 1_500_000 });
    expect(paid.discounts).toEqual([]);
  });

  it("keeps the rest due when the client pays less and nobody settles", async () => {
    const c = await newClient("Part Payer Co");
    const bill = await newBill(c.id, { bill_date: "2020-06-01", items: [line(1_500_000)] });
    const after = (await pay(bill.id, 1_200_000, { paid_on: "2020-06-10" })).body;
    expect(after).toMatchObject({ state: "open", part_paid: true, balance_paise: 300_000, discount_paise: 0 });
  });

  it("settles 15,000 paid with 12,000: the 3,000 becomes a discount and the bill itself is unchanged", async () => {
    const c = await newClient("Haggler Co");
    const bill = await newBill(c.id, { bill_date: "2020-07-01", items: [line(1_500_000)] });
    const res = await pay(bill.id, 1_200_000, { paid_on: "2020-07-15", method: "cash", settle_rest: true, discount_reason: "Agreed on phone" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      state: "paid", total_paise: 1_500_000, subtotal_paise: 1_500_000, paid_paise: 1_200_000, discount_paise: 300_000, balance_paise: 0, amounts_locked: true,
    });
    expect(res.body.items[0].unit_price_paise).toBe(1_500_000); // the bill's own amounts are untouched
    expect(res.body.discounts[0]).toMatchObject({ amount_paise: 300_000, given_on: "2020-07-15", reason: "Agreed on phone", created_by_name: "Asha Staff" });
    const h = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items;
    expect(h[0]).toMatchObject({ action: "discount_given", summary: "Discount of ₹3,000.00 given: Agreed on phone" });
    expect(h[1].action).toBe("payment_added");
    // Settled bills count as paid and are no longer outstanding.
    const paidList = (await api.get(`/api/bills?client_id=${c.id}&status=paid`).set(auth(staff))).body.items;
    expect(paidList.map((b: any) => b.id)).toEqual([bill.id]);
    expect((await api.get(`/api/bills?client_id=${c.id}&status=outstanding`).set(auth(staff))).body.items).toEqual([]);
  });

  it("uses a default reason, and does nothing extra when the payment already covers the balance", async () => {
    const c = await newClient("Default Reason Co");
    const a = await newBill(c.id, { bill_date: "2020-08-01", items: [line(10_000)] });
    expect((await pay(a.id, 9_000, { settle_rest: true })).body.discounts[0].reason).toBe("Client paid less by agreement");
    const b = await newBill(c.id, { bill_date: "2020-08-02", items: [line(10_000)] });
    expect((await pay(b.id, 10_000, { settle_rest: true })).body.discounts).toEqual([]);
  });

  it("can let go of the rest later, on its own, but never more than is due", async () => {
    const c = await newClient("Later Settle Co");
    const bill = await newBill(c.id, { bill_date: "2020-09-01", items: [line(1_500_000)] });
    await pay(bill.id, 1_200_000, { paid_on: "2020-09-10" });
    const tooMuch = await api.post(`/api/bills/${bill.id}/discounts`).set(auth(staff)).send({ amount_paise: 300_001, reason: "Let go" });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/at most the balance due \(₹3,000.00\)/);
    expect((await api.post(`/api/bills/${bill.id}/discounts`).set(auth(staff)).send({ amount_paise: 100, reason: "" })).status).toBe(400);
    const ok = await api.post(`/api/bills/${bill.id}/discounts`).set(auth(staff)).send({ amount_paise: 300_000, reason: "Old client, let go" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ state: "paid", balance_paise: 0, discount_paise: 300_000 });
    expect((await pay(bill.id, 1)).status).toBe(400); // nothing left to pay
  });

  it("lets an admin void a wrong discount, so the amount is owed again", async () => {
    const c = await newClient("Void Discount Co");
    const bill = await newBill(c.id, { bill_date: "2020-10-01", items: [line(1_000_000)] });
    const settled = (await pay(bill.id, 800_000, { settle_rest: true })).body;
    const discountId = settled.discounts[0].id;
    expect((await api.post(`/api/discounts/${discountId}/void`).set(auth(staff)).send({ reason: "Mistake" })).status).toBe(403);
    const voided = await api.post(`/api/discounts/${discountId}/void`).set(auth(admin)).send({ reason: "Client agreed to pay the rest" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ state: "open", balance_paise: 200_000, discount_paise: 0 });
    expect(voided.body.discounts[0]).toMatchObject({ voided_by_name: "The Boss", void_reason: "Client agreed to pay the rest" });
    expect((await api.post(`/api/discounts/${discountId}/void`).set(auth(admin)).send({ reason: "Again" })).status).toBe(409);
  });

  it("shows a bill settled only by a discount as written off, and blocks cancelling while a discount stands", async () => {
    const c = await newClient("Write Off Co");
    const bill = await newBill(c.id, { bill_date: "2020-11-01", items: [line(50_000)] });
    const w = await api.post(`/api/bills/${bill.id}/discounts`).set(auth(admin)).send({ amount_paise: 50_000, reason: "Client closed business" });
    expect(w.body).toMatchObject({ state: "written_off", balance_paise: 0 });
    const cancel = await api.post(`/api/bills/${bill.id}/cancel`).set(auth(admin)).send({ reason: "Try" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toMatch(/discount/);
  });

  it("puts discounts in the totals, the register and the client statement", async () => {
    const c = await newClient("Discount Report Co");
    const bill = await newBill(c.id, { bill_date: "2021-05-01", fy_start: 1997, items: [line(1_500_000)] });
    await pay(bill.id, 1_200_000, { paid_on: "2021-05-20", method: "upi", settle_rest: true, discount_reason: "Haggled" });
    const sum = (await api.get("/api/bills/summary?fy=1997").set(auth(staff))).body;
    expect(sum).toMatchObject({ billed_paise: 1_500_000, collected_paise: 1_200_000, discount_paise: 300_000, outstanding_paise: 0 });
    const reg = (await api.get(`/api/exports/bills.csv?client_id=${c.id}`).set(auth(staff))).text.slice(1).trim().split("\r\n");
    expect(reg[1]).toContain(",Paid,No,15000.00,0,0.00,15000.00,0.00,12000.00,3000.00,0.00,");
    const st = (await api.get(`/api/exports/statement.csv?client_id=${c.id}`).set(auth(staff))).text.slice(1).trim().split("\r\n").map((r) => r.split(","));
    expect(st.slice(1, -1).map((r) => r[1])).toEqual(["Bill", "Payment", "Discount"]);
    expect(st[st.length - 1][6]).toBe("0.00");
  });
});

describe("settling a GST bill: a credit note brings the GST down to what was received", () => {
  const withGst = async <T>(fn: () => Promise<T>) => {
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: true, gst_rate_percent: 18 });
    try {
      return await fn();
    } finally {
      await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 18 });
    }
  };

  it("splits a shortfall back into fee + GST that add up exactly", async () => {
    const { splitInclusive } = await import("../src/lib/shortfall.js");
    expect(splitInclusive(370_000, 18)).toEqual({ subtotal_paise: 313_559, gst_paise: 56_441 });
    expect(splitInclusive(1, 18)).toEqual({ subtotal_paise: 1, gst_paise: 0 });
    for (const amt of [1, 99, 118, 12_345, 999_999]) {
      const s = splitInclusive(amt, 18);
      expect(s.subtotal_paise + s.gst_paise).toBe(amt);
    }
    expect(splitInclusive(50_000, 0)).toEqual({ subtotal_paise: 50_000, gst_paise: 0 });
  });

  it("issues a credit note for the shortfall by default on a GST bill (17,700 paid with 14,000)", async () => {
    const bill = await withGst(async () => newBill((await newClient("Gst Haggler Co")).id, { items: [line(1_500_000)] }));
    expect(bill.total_paise).toBe(1_770_000);
    const res = await pay(bill.id, 1_400_000, { settle_rest: true, discount_reason: "Agreed at 14,000" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ state: "paid", balance_paise: 0, paid_paise: 1_400_000, credited_paise: 370_000, discount_paise: 0, total_paise: 1_770_000 });
    const cnRef = res.body.credit_notes[0];
    expect(cnRef.cn_no).toMatch(/^CN\/\d{4}-\d{2}\/\d{4}$/);
    const cn = (await api.get(`/api/credit-notes/${cnRef.id}`).set(auth(staff))).body;
    expect(cn).toMatchObject({ subtotal_paise: 313_559, gst_rate_percent: 18, gst_paise: 56_441, total_paise: 370_000, reason: "Agreed at 14,000", created_by_name: "Asha Staff" });
    expect(cn.items[0]).toMatchObject({ description: `Reduction in fees for bill ${bill.bill_no}`, quantity: 1, unit_price_paise: 313_559 });
    const h = (await api.get(`/api/bills/${bill.id}/history`).set(auth(staff))).body.items;
    expect(h[0].summary).toMatch(/^Credit note CN\/.+ issued for ₹3,700.00 \(client paid less\): Agreed at 14,000$/);
  });

  it("can still settle a GST bill with a plain discount when the user chooses it", async () => {
    const bill = await withGst(async () => newBill((await newClient("Gst Discount Co")).id, { items: [line(100_000)] }));
    const res = await pay(bill.id, 100_000, { settle_rest: true, settle_as: "discount" });
    expect(res.body).toMatchObject({ state: "paid", discount_paise: 18_000, credited_paise: 0, balance_paise: 0 });
  });

  it("refuses a credit note after the 30 November deadline for that year, and says to use a discount", async () => {
    const { creditNoteDeadline } = await import("../src/lib/shortfall.js");
    expect(creditNoteDeadline(2026)).toBe("2027-11-30");
    // A GST bill of FY 2003-04: its credit note deadline was 30 Nov 2004.
    const bill = await withGst(async () => newBill((await newClient("Late Gst Co")).id, { bill_date: "2003-06-01", items: [line(100_000)] }));
    const late = await pay(bill.id, 100_000, { settle_rest: true, settle_as: "credit_note" });
    expect(late.status).toBe(400);
    expect(late.body.error).toMatch(/last day for a GST credit note on FY 2003-04 bills was 30 Nov 2004/);
    expect((await api.get(`/api/bills/${bill.id}`).set(auth(staff))).body.payments).toEqual([]); // nothing half-saved
    const ok = await pay(bill.id, 100_000, { settle_rest: true, settle_as: "discount" });
    expect(ok.body).toMatchObject({ state: "paid", discount_paise: 18_000 });
  });

  it("settles whatever is left later, without a new payment", async () => {
    const bill = await withGst(async () => newBill((await newClient("Settle Later Gst Co")).id, { items: [line(1_000_000)] }));
    await pay(bill.id, 1_000_000);
    const res = await api.post(`/api/bills/${bill.id}/settle`).set(auth(staff)).send({ reason: "Won't pay the GST part" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "paid", balance_paise: 0, credited_paise: 180_000 });
    expect((await api.post(`/api/bills/${bill.id}/settle`).set(auth(staff)).send({})).status).toBe(400); // nothing left
    // Without GST the default is a plain discount.
    const plain = await newBill((await newClient("Settle Later Plain Co")).id, { items: [line(50_000)] });
    await pay(plain.id, 40_000);
    expect((await api.post(`/api/bills/${plain.id}/settle`).set(auth(staff)).send({})).body).toMatchObject({ discount_paise: 10_000, credited_paise: 0, state: "paid" });
  });
});

describe("PDF of a bill or credit note", () => {
  const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  };
  const getPdf = (url: string) => api.get(url).set(auth(staff)).buffer(true).parse(binary as never);
  const pageCount = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

  it("downloads a real PDF named after the bill", async () => {
    const c = await newClient("Pdf Co");
    const bill = await newBill(c.id, { bill_date: "2210-05-01", items: [line(250_000, "Statutory Audit", 1, "Audit under the Companies Act")] });
    const res = await getPdf(`/api/bills/${bill.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("Bill 2210-11-0001 - Pdf Co.pdf");
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3000);
    expect(pageCount(pdf)).toBe(1);
    const inline = await getPdf(`/api/bills/${bill.id}/pdf?inline=1`);
    expect(inline.headers["content-disposition"]).toContain("inline");
  });

  it("copes with Gujarati and Hindi names, the rupee sign, emoji and very long text without failing", async () => {
    const c = await newClient("શ્રી રાજેશ પટેલ અને संस्थान 😀", { city: "અમદાવાદ", address: "૨૦૪, બિઝનેસ હબ" });
    const bill = await newBill(c.id, { bill_date: "2220-05-01", notes: "નોંધ: ".padEnd(900, "ધન્યવાદ "), items: [line(100_000, "ઓડિટ સેવા", 1, "वार्षिक लेखा परीक्षा ".repeat(20))] });
    const res = await getPdf(`/api/bills/${bill.id}/pdf`);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("flows a long bill over several pages", async () => {
    const c = await newClient("Long Pdf Co");
    const items = Array.from({ length: 60 }, (_, i) => line(1_000 + i, `Item number ${i + 1}`, 1, "A description that takes up a couple of lines on the page so the table has to break across pages. ".repeat(2)));
    const bill = await newBill(c.id, { bill_date: "2230-05-01", items });
    const res = await getPdf(`/api/bills/${bill.id}/pdf`);
    expect(pageCount(res.body as Buffer)).toBeGreaterThanOrEqual(3);
  });

  it("makes PDFs for cancelled bills, bills with payments, and credit notes", async () => {
    const c = await newClient("All States Co");
    const paid = await newBill(c.id, { bill_date: "2007-05-01", items: [line(100_000)] });
    await pay(paid.id, 30_000);
    const cn = await api.post(`/api/bills/${paid.id}/credit-notes`).set(auth(admin)).send({ reason: "Discount", cn_date: "2007-05-02", items: [line(10_000)] });
    const gone = await newBill(c.id, { bill_date: "2007-05-03" });
    await api.post(`/api/bills/${gone.id}/cancel`).set(auth(admin)).send({ reason: "Mistake" });
    for (const url of [`/api/bills/${paid.id}/pdf`, `/api/bills/${gone.id}/pdf`, `/api/credit-notes/${cn.body.id}/pdf`]) {
      const res = await getPdf(url);
      expect(res.status, url).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    }
    expect((await getPdf(`/api/credit-notes/${cn.body.id}/pdf`)).headers["content-disposition"]).toContain("Credit note CN-2007-08-0001");
  });

  it("needs a login and returns 404 for unknown documents", async () => {
    expect((await api.get("/api/bills/1/pdf")).status).toBe(401);
    expect((await getPdf("/api/bills/999999/pdf")).status).toBe(404);
    expect((await getPdf("/api/credit-notes/999999/pdf")).status).toBe(404);
  });
});

describe("backups to a second location", () => {
  let root: string;
  const dirs = () => ({ local: path.join(root, "local-backups"), second: path.join(root, "usb-drive", "Billing Backups"), clients: path.join(root, "client-files"), data: path.join(root, "data") });
  const files = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d) : []);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-backups-"));
    fs.mkdirSync(dirs().clients, { recursive: true });
    fs.mkdirSync(path.join(dirs().clients, "Some Client"), { recursive: true });
    fs.writeFileSync(path.join(dirs().clients, "Some Client", "client-details.txt"), "details");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const make = () => createBackups(db, { dir: dirs().local, clientFilesDir: dirs().clients, protectedDirs: [dirs().data] });

  it("backs up the database locally, copies it to the second location, and mirrors the client folders", async () => {
    const b = make();
    await b.setCopyDir(dirs().second);
    const result = await b.run();
    expect(result).toEqual({ database: "done", copy: "done", clientFolders: "done", errors: [] });
    const local = files(dirs().local).filter((f) => /^billing-.*\.tar\.gz$/.test(f));
    expect(local).toHaveLength(1);
    expect(files(dirs().second)).toContain(local[0]);
    expect(fs.statSync(path.join(dirs().second, local[0])).size).toBeGreaterThan(100_000);
    expect(fs.readFileSync(path.join(dirs().second, "Client Files", "Some Client", "client-details.txt"), "utf8")).toBe("details");
    const status = await b.status();
    expect(status).toMatchObject({ enabled: true, canBackUpDatabase: true, copyDir: path.resolve(dirs().second), lastError: null, running: false });
    expect(status.lastRunAt).toBeTruthy();
    expect(status.lastCopyAt).toBeTruthy();
    expect(status.lastDatabaseBackup).toBe(local[0]);
  });

  it("keeps only the 14 newest database backups in each place", async () => {
    for (const d of [dirs().local, dirs().second]) {
      for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(d, `billing-2000010${String(i).padStart(2, "0")}-000000.tar.gz`), "old");
    }
    await make().run();
    for (const d of [dirs().local, dirs().second]) {
      const kept = files(d).filter((f) => /^billing-.*\.tar\.gz$/.test(f));
      expect(kept).toHaveLength(14);
      expect(kept.some((f) => !f.startsWith("billing-2000"))).toBe(true); // the newest one survived
    }
    expect(files(dirs().second)).toContain("Client Files"); // pruning never touches the client folders
  });

  it("still backs up locally, and reports the problem, when the second location cannot be written", async () => {
    const b = make();
    const blocker = path.join(root, "a-file-not-a-folder");
    fs.writeFileSync(blocker, "x");
    // (setCopyDir would refuse this path, so store it directly to simulate a drive that disappeared later)
    await db.query("INSERT INTO settings (key, value) VALUES ('backup_copy_dir', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [path.join(blocker, "inside")]);
    const result = await b.run();
    expect(result.database).toBe("done");
    expect(result.copy).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/Could not copy the backup/);
    expect((await b.status()).lastError).toMatch(/Could not copy the backup/);
    await b.setCopyDir("");
    expect((await b.status()).copyDir).toBeNull();
    expect(await b.run()).toMatchObject({ database: "done", copy: "not set", clientFolders: "not set" });
  });

  it("rejects second locations that would not work", async () => {
    const b = make();
    await expect(b.setCopyDir("relative/folder")).rejects.toThrow(/full folder path/);
    await expect(b.setCopyDir(dirs().clients)).rejects.toThrow(/somewhere else/); // the client folders themselves
    await expect(b.setCopyDir(path.join(dirs().clients, "inside"))).rejects.toThrow(/somewhere else/);
    await expect(b.setCopyDir(dirs().local)).rejects.toThrow(/somewhere else/); // the local backup folder
    await expect(b.setCopyDir(dirs().data)).rejects.toThrow(/somewhere else/); // the program's data folder
    await expect(b.setCopyDir(root)).rejects.toThrow(/somewhere else/); // a parent of them
    const blocker = path.join(root, "a-file-not-a-folder");
    await expect(b.setCopyDir(path.join(blocker, "sub"))).rejects.toThrow(/can't write to that folder/);
  });

  it("is off, with a clear message, when no backup folder is set up", async () => {
    const off = createBackups(db, { dir: null, clientFilesDir: null });
    expect((await off.status()).enabled).toBe(false);
    await expect(off.run()).rejects.toThrow(/not set up/);
  });

  it("is controlled by admins only, over the API", async () => {
    const live = request(createApp(db, undefined, make()));
    const token = (t: string) => ({ Authorization: `Bearer ${t}` });
    expect((await live.get("/api/backup/status").set(token(staff))).status).toBe(403);
    expect((await live.put("/api/backup/location").set(token(staff)).send({ copy_dir: dirs().second })).status).toBe(403);
    expect((await live.post("/api/backup/run").set(token(staff))).status).toBe(403);
    const set = await live.put("/api/backup/location").set(token(admin)).send({ copy_dir: dirs().second });
    expect(set.status).toBe(200);
    expect(set.body.copyDir).toBe(path.resolve(dirs().second));
    const run = await live.post("/api/backup/run").set(token(admin));
    expect(run.status).toBe(200);
    expect(run.body.result).toMatchObject({ database: "done", copy: "done" });
    expect((await live.put("/api/backup/location").set(token(admin)).send({ copy_dir: "nope" })).body.error).toMatch(/full folder path/);
    await live.put("/api/backup/location").set(token(admin)).send({ copy_dir: "" });
  });
});
