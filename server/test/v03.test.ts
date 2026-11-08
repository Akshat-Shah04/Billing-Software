import ExcelJS from "exceljs";
import bcrypt from "bcryptjs";
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

// Records emails instead of sending them.
const sent: Mail[] = [];
const fakeMailer: Mailer = { async send(m) { sent.push(m); } };
const waitForMail = async (n: number) => {
  for (let i = 0; i < 50 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 20));
};

async function login(username: string, password: string) {
  return (await api.post("/api/auth/login").send({ username, password })).body.token as string;
}
const line = (price: number, description = "Audit", kind: "fee" | "reimbursement" = "fee", details?: string) => ({ description, details, quantity: 1, unit_price_paise: price, kind });
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
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};
const download = (url: string, token = admin) => api.get(url).set(auth(token)).buffer(true).parse(binary as never);

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

describe("client groups (e.g. a family)", () => {
  it("creates groups, puts clients in them, and filters clients and bills by group", async () => {
    const g = await api.post("/api/client-groups").set(auth(staff)).send({ name: "Shah family", notes: "Kirit, Bhavik and the HUF" });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ name: "Shah family", member_count: 0 });
    expect((await api.post("/api/client-groups").set(auth(staff)).send({ name: "shah FAMILY" })).status).toBe(409); // names are unique

    const a = await newClient("Bhavik Kiritkumar Shah", { group_id: g.body.id });
    const b = await newClient("Bhavikkumar Kiritkumar Shah HUF", { group_id: g.body.id });
    const other = await newClient("Not Family Co");
    expect(a).toMatchObject({ group_id: g.body.id, group_name: "Shah family" });
    expect((await api.post("/api/clients").set(auth(staff)).send({ name: "Ghost", group_id: 999999 })).status).toBe(400);

    const members = (await api.get(`/api/clients?group_id=${g.body.id}`).set(auth(staff))).body.items.map((c: any) => c.id);
    expect(members.sort()).toEqual([a.id, b.id].sort());
    expect((await api.get(`/api/client-groups/${g.body.id}`).set(auth(staff))).body.members.map((m: any) => m.name)).toEqual(["Bhavik Kiritkumar Shah", "Bhavikkumar Kiritkumar Shah HUF"]);

    await newBill(a.id, { bill_date: "2025-06-01", items: [line(400_000)] });
    await newBill(b.id, { bill_date: "2025-06-02", items: [line(300_000)] });
    await newBill(other.id, { bill_date: "2025-06-03", items: [line(100_000)] });
    const bills = (await api.get(`/api/bills?group_id=${g.body.id}`).set(auth(staff))).body.items;
    expect(bills.map((x: any) => x.client_name).sort()).toEqual(["Bhavik Kiritkumar Shah", "Bhavikkumar Kiritkumar Shah HUF"]);
    expect(bills[0].group_name).toBe("Shah family");
    expect((await api.get(`/api/bills/summary?group_id=${g.body.id}`).set(auth(staff))).body.billed_paise).toBe(700_000);
  });

  it("renames a group, and deleting it keeps its clients and their bills", async () => {
    const g = (await api.post("/api/client-groups").set(auth(staff)).send({ name: "Temp group" })).body;
    const c = await newClient("Temp Member", { group_id: g.id });
    expect((await api.put(`/api/client-groups/${g.id}`).set(auth(staff)).send({ name: "Renamed group" })).body.name).toBe("Renamed group");
    expect((await api.delete(`/api/client-groups/${g.id}`).set(auth(staff))).status).toBe(204);
    const after = (await api.get(`/api/clients/${c.id}`).set(auth(staff))).body;
    expect(after).toMatchObject({ name: "Temp Member", group_id: null, is_deleted: false });
  });
});

describe("paid on the client's behalf (e.g. tax paid from the firm's account)", () => {
  it("adds no GST to it and keeps it out of fees", async () => {
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: true, gst_rate_percent: 18 });
    try {
      const c = await newClient("Tax Payer Co");
      const bill = await newBill(c.id, {
        bill_date: "2025-07-01",
        items: [line(400_000, "Income Tax Return"), line(2_500_000, "Self-assessment tax AY 2025-26", "reimbursement", "Challan 00123, BSR 0510308, 30 Jun 2025")],
      });
      expect(bill).toMatchObject({ subtotal_paise: 400_000, gst_paise: 72_000, reimbursement_paise: 2_500_000, total_paise: 2_972_000 });
      expect(bill.items.map((i: any) => i.kind)).toEqual(["fee", "reimbursement"]);

      // Payments go to the amount paid on behalf first, then the fees.
      await api.post(`/api/bills/${bill.id}/payments`).set(auth(staff)).send({ amount_paise: 2_600_000, method: "bank_transfer" });
      const sum = (await api.get(`/api/bills/summary?client_id=${c.id}`).set(auth(staff))).body;
      expect(sum.reimbursement_paise).toBeGreaterThanOrEqual(2_500_000);
      const report = (await api.get("/api/reports/fees?from=2025-07-01&to=2025-07-01").set(auth(admin))).body;
      const row = report.rows.find((r: any) => r.bill_no === bill.bill_no);
      expect(row).toMatchObject({ fees_paise: 400_000, gst_paise: 72_000, reimbursement_paise: 2_500_000, received_paise: 2_600_000, balance_paise: 372_000 });
      expect(report.summary).toMatchObject({ reimbursed_paise: 2_500_000, fees_received_paise: 100_000 });
    } finally {
      await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 18 });
    }
  });

  it("settles a short payment from the fees, never from the tax paid on behalf", async () => {
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: true, gst_rate_percent: 18 });
    let bill: any;
    try {
      bill = await newBill((await newClient("Short Payer Co")).id, { items: [line(100_000, "ITR"), line(500_000, "Advance tax", "reimbursement")] });
    } finally {
      await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 18 });
    }
    expect(bill.total_paise).toBe(618_000); // 1,000 + 180 GST + 5,000 tax
    // Pays 6,000: the 5,000 tax back, plus 1,000 towards the fee. The 180 short is credited, with its GST split.
    const res = await api.post(`/api/bills/${bill.id}/payments`).set(auth(staff)).send({ amount_paise: 600_000, method: "upi", settle_rest: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ balance_paise: 0, credited_paise: 18_000, discount_paise: 0 });
    // A manual credit note can't reduce the amount paid on behalf.
    const bill2 = await newBill((await newClient("Credit Cap Co")).id, { items: [line(100_000, "ITR"), line(500_000, "Advance tax", "reimbursement")] });
    const tooMuch = await api.post(`/api/bills/${bill2.id}/credit-notes`).set(auth(admin)).send({ reason: "Try to credit tax", items: [{ description: "x", quantity: 1, unit_price_paise: 200_000 }] });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/at most the fees still unpaid \(₹1,000.00\)/);
  });

  it("shows it separately on the bill copy and in the register", async () => {
    const c = await newClient("Copy Check Co");
    const bill = await newBill(c.id, { bill_date: "2025-08-01", items: [line(300_000, "ITR"), line(1_000_000, "Advance tax Q2", "reimbursement", "Challan 555")] });
    const csv = (await api.get(`/api/exports/bills.csv?client_id=${c.id}`).set(auth(staff))).text;
    expect(csv).toContain(",3000.00,0,0.00,10000.00,13000.00,");
    const pdf = await download(`/api/bills/${bill.id}/pdf`, staff);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("ledger account for a client or a group", () => {
  it("gives an opening balance, every transaction in the range with a running balance, and a closing balance", async () => {
    const c = await newClient("Ledger Client");
    const a = await newBill(c.id, { bill_date: "2024-05-10", items: [line(500_000)] }); // before the range
    await api.post(`/api/bills/${a.id}/payments`).set(auth(staff)).send({ amount_paise: 200_000, method: "cash", paid_on: "2024-06-01" });
    const b = await newBill(c.id, { bill_date: "2024-08-01", items: [line(300_000, "ITR")] });
    await api.post(`/api/bills/${b.id}/payments`).set(auth(staff)).send({ amount_paise: 100_000, method: "upi", reference: "UTR9", paid_on: "2024-08-20" });
    await newBill(c.id, { bill_date: "2025-01-15", items: [line(50_000)] }); // after the range

    const l = (await api.get(`/api/reports/ledger?client_id=${c.id}&from=2024-07-01&to=2024-12-31`).set(auth(staff))).body;
    expect(l).toMatchObject({ kind: "client", name: "Ledger Client", opening_paise: 300_000, closing_paise: 500_000 });
    expect(l.entries.map((e: any) => [e.type, e.debit_paise, e.credit_paise, e.balance_paise])).toEqual([
      ["Bill", 300_000, 0, 600_000],
      ["Payment", 0, 100_000, 500_000],
    ]);
    expect(l.entries[1].details).toBe("Received by UPI, UTR9");
    expect(l.entries[0]).toMatchObject({ particulars: "Professional fees, FY 2024-25", ref: b.bill_no });
    // Pending bills as on the end date: receipts applied to the oldest bill first (3,000 received in all).
    expect(l.pending.map((p: any) => [p.bill_no, p.billed_paise, p.received_paise, p.pending_paise])).toEqual([
      [a.bill_no, 500_000, 300_000, 200_000],
      [b.bill_no, 300_000, 0, 300_000],
    ]);
    expect(l.totals).toMatchObject({ billed_paise: 300_000, received_paise: 100_000 });

    expect((await api.get(`/api/reports/ledger?client_id=${c.id}&from=2024-12-31&to=2024-07-01`).set(auth(staff))).status).toBe(400);
    expect((await api.get("/api/reports/ledger").set(auth(staff))).status).toBe(400);
  });

  it("combines every member for a group, and downloads as a PDF for staff too", async () => {
    const g = (await api.post("/api/client-groups").set(auth(staff)).send({ name: "Mehta family" })).body;
    const x = await newClient("Anand Mehta", { group_id: g.id });
    const y = await newClient("Neha Mehta", { group_id: g.id });
    await newBill(x.id, { bill_date: "2025-09-01", items: [line(200_000)] });
    await newBill(y.id, { bill_date: "2025-09-02", items: [line(100_000)] });
    const l = (await api.get(`/api/reports/ledger?group_id=${g.id}&from=2025-04-01&to=2026-03-31`).set(auth(staff))).body;
    expect(l).toMatchObject({ kind: "group", name: "Mehta family", members: ["Anand Mehta", "Neha Mehta"], closing_paise: 300_000 });
    expect(l.entries.map((e: any) => e.client_name)).toEqual(["Anand Mehta", "Neha Mehta"]);

    const pdf = await download(`/api/reports/ledger.pdf?group_id=${g.id}&from=2025-04-01&to=2026-03-31`, staff);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain("Statement of account - Mehta family - as on 2026-03-31.pdf");
    expect(l.entries[0].particulars).toBe("Professional fees, Anand Mehta, FY 2025-26");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("fees report (admin)", () => {
  it("summarises bills in a range, month by month, leaving cancelled bills out of the totals", async () => {
    const c = await newClient("Report Client");
    await newBill(c.id, { bill_date: "2023-05-05", items: [line(100_000)] });
    await newBill(c.id, { bill_date: "2023-06-06", items: [line(250_000), line(40_000, "Govt fee", "reimbursement")] });
    const gone = await newBill(c.id, { bill_date: "2023-06-07", items: [line(999_900)] });
    await api.post(`/api/bills/${gone.id}/cancel`).set(auth(admin)).send({ reason: "Mistake" });
    await newBill(c.id, { bill_date: "2023-08-01", items: [line(1)] }); // outside

    const r = (await api.get("/api/reports/fees?from=2023-05-01&to=2023-06-30").set(auth(admin))).body;
    expect(r.rows.map((x: any) => x.status)).toEqual(["Overdue", "Overdue", "Cancelled"]); // long past their due dates
    expect(r.summary).toMatchObject({ bills: 2, cancelled: 1, fees_paise: 350_000, reimbursement_paise: 40_000, total_paise: 390_000, outstanding_paise: 390_000 });
    expect(r.months).toEqual([
      { month: "May 2023", bills: 1, fees_paise: 100_000, gst_paise: 0, reimbursement_paise: 0, received_paise: 0, collected_paise: 0 },
      { month: "Jun 2023", bills: 1, fees_paise: 250_000, gst_paise: 0, reimbursement_paise: 40_000, received_paise: 0, collected_paise: 0 },
    ]);
    expect((await api.get("/api/reports/fees").set(auth(staff))).status).toBe(403); // admins only
  });

  it("downloads a real Excel workbook and a PDF", async () => {
    const xlsx = await download("/api/reports/fees.xlsx?from=2023-05-01&to=2023-06-30");
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-disposition"]).toContain("Fees report 2023-05-01 to 2023-06-30.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Month by month", "Bills", "Receipts"]);
    const bills = wb.getWorksheet("Bills")!;
    expect(bills.getRow(1).getCell(1).value).toBe("Bill no.");
    expect(bills.getRow(2).getCell(5).value).toBe(1000); // fees in rupees, as a number
    const summary = wb.getWorksheet("Summary")!;
    const fees = summary.getColumn(1).values.findIndex((v) => v === "Fees (the firm's income)");
    expect(summary.getRow(fees).getCell(2).value).toBe(3500);

    const pdf = await download("/api/reports/fees.pdf?from=2023-05-01&to=2023-06-30");
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("forgot password (administrators, by email)", () => {
  it("emails a one-time link to an admin, which sets a new password and ends old sessions", async () => {
    await api.patch("/api/users/1").set(auth(admin)).send({ email: "Boss@Example.com" });
    // Without a mail server nothing is sent, but the reply is the same.
    expect((await api.post("/api/auth/forgot").send({ login: "boss" })).body).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toHaveLength(0);

    const mail = await api.put("/api/settings/mail").set(auth(admin)).send({
      smtp_host: "smtp.example.com", smtp_port: 587, smtp_secure: false, smtp_user: "billing@example.com", smtp_password: "secret-app-password",
      smtp_from: "Shah & Associates <billing@example.com>", app_url: "http://OFFICE-PC:4000/",
    });
    expect(mail.status, JSON.stringify(mail.body)).toBe(200);
    expect(mail.body).toMatchObject({ configured: true, smtp_password_set: true, app_url: "http://OFFICE-PC:4000" });
    expect(JSON.stringify(mail.body)).not.toContain("secret-app-password"); // never sent back
    expect((await api.get("/api/settings/mail").set(auth(staff))).status).toBe(403);
    expect(JSON.stringify((await api.get("/api/settings").set(auth(staff))).body)).not.toContain("smtp");

    expect((await api.post("/api/auth/forgot").send({ login: "boss@example.com" })).body).toEqual({ ok: true });
    await waitForMail(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "boss@example.com", subject: "Reset your Billing Software password" });
    const token = /reset-password\?token=([\w-]+)/.exec(sent[0].text)![1];
    expect(sent[0].text).toContain(`http://OFFICE-PC:4000/reset-password?token=${token}`);

    // Unknown accounts and staff accounts get the same reply and no email.
    for (const login of ["nobody", "asha"]) expect((await api.post("/api/auth/forgot").send({ login })).body).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toHaveLength(1);

    const oldSession = admin;
    await new Promise((r) => setTimeout(r, 1100)); // the new password must be later than the old session's start (whole seconds)
    expect((await api.post("/api/auth/reset").send({ token, password: "short" })).status).toBe(400);
    const ok = await api.post("/api/auth/reset").send({ token, password: "brand-new-password" });
    expect(ok.body).toEqual({ ok: true, username: "boss" });
    expect((await api.post("/api/auth/reset").send({ token, password: "another-password" })).body.error).toMatch(/already been used/);
    expect((await api.get("/api/auth/me").set(auth(oldSession))).status).toBe(401); // old sessions end
    expect((await api.post("/api/auth/login").send({ username: "boss", password: "boss-password" })).status).toBe(401);
    admin = await login("boss", "brand-new-password");
    expect(admin).toBeTruthy();
  });

  it("refuses a made-up or expired link", async () => {
    expect((await api.post("/api/auth/reset").send({ token: "x".repeat(43), password: "brand-new-password" })).body.error).toMatch(/not valid/);
    await api.post("/api/auth/forgot").send({ login: "boss" });
    await waitForMail(2);
    const token = /token=([\w-]+)/.exec(sent[sent.length - 1].text)![1];
    await db.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await api.post("/api/auth/reset").send({ token, password: "brand-new-password" })).body.error).toMatch(/expired/);
  });
});
