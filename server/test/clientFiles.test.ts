import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connect, migrate, type Db } from "../src/db/index.js";
import { createClientFiles, folderBase } from "../src/lib/clientFiles.js";

let db: Db;
let api: ReturnType<typeof request>;
let root: string;
let token = "";
const auth = () => ({ Authorization: `Bearer ${token}` });

// Bill numbers like 2026-27/0001 contain a slash, which a file name cannot, so saved copies use a dash.
const fileSafe = (n: string) => n.replace(/\//g, "-");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");
const has = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const item = (description = "Audit", price = 100_000, details?: string) => [
  { description, details, quantity: 1, unit_price_paise: price },
];

async function newClient(body: object) {
  const res = await api.post("/api/clients").set(auth()).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: number; folder_name: string };
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "billing-client-files-"));
  db = await connect("pglite:memory");
  await migrate(db);
  api = request(createApp(db, createClientFiles(db, root)));
  await db.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ('boss', $1, 'The Boss', 'admin')", [
    await bcrypt.hash("boss-password", 4),
  ]);
  token = (await api.post("/api/auth/login").send({ username: "boss", password: "boss-password" })).body.token;
});

afterAll(async () => {
  await db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("folderBase", () => {
  it("makes safe Windows folder names", () => {
    expect(folderBase("Rajesh Patel")).toBe("Rajesh Patel");
    expect(folderBase('A/B: "Co"?*<>|')).toBe("A-B- -Co------"); // each of / : " " ? * < > | becomes a dash
    expect(folderBase('A/B: "Co"?*<>|')).not.toMatch(/[<>:"/\\|?*]/);
    expect(folderBase("  Trailing dots...  ")).toBe("Trailing dots");
    expect(folderBase("CON")).toBe("CON_");
    expect(folderBase("...")).toBe("Client");
    expect(folderBase("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("client folders", () => {
  it("creates a folder named after the client with their details", async () => {
    const c = await newClient({ name: "Rajesh Patel", phone: "9876543210", referred_by: "Mr. Desai", gstin: "24abcde1234f1z5" });
    expect(c.folder_name).toBe("Rajesh Patel");
    expect(has("Rajesh Patel", "client-details.txt")).toBe(true);
    const txt = read("Rajesh Patel", "client-details.txt");
    expect(txt).toContain("Rajesh Patel");
    expect(txt).toContain("9876543210");
    expect(txt).toContain("Referred by:  Mr. Desai");
    expect(txt).toContain("24ABCDE1234F1Z5");
    const json = JSON.parse(read("Rajesh Patel", "client-data.json"));
    expect(json.client.name).toBe("Rajesh Patel");
    expect(json.bills).toEqual([]);
  });

  it("writes every bill as a readable file, including the service description and GST", async () => {
    await api.put("/api/settings").set(auth()).send({ gst_enabled: true, gst_rate_percent: 18 });
    const c = await newClient({ name: "Bill Writer & Sons" });
    const bill = await api
      .post("/api/bills")
      .set(auth())
      .send({ client_id: c.id, bill_date: "2026-11-05", notes: "Pay in 15 days", items: item("Statutory Audit", 2_500_000, "Audit under the Companies Act") });
    await api.put("/api/settings").set(auth()).send({ gst_enabled: false, gst_rate_percent: 18 });

    const file = `${fileSafe(bill.body.bill_no)}_2026-11-05.html`;
    expect(has("Bill Writer & Sons", "bills", file)).toBe(true);
    const html = read("Bill Writer & Sons", "bills", file);
    expect(html).toContain(bill.body.bill_no);
    expect(html).toContain("Statutory Audit");
    expect(html).toContain("Audit under the Companies Act");
    // The title is a large bold line and the description a smaller one under it.
    expect(html).toContain('<div class="it">Statutory Audit</div><div class="d">Audit under the Companies Act</div>');
    expect(html).toMatch(/\.it\{font-size:1\.1rem;font-weight:700/);
    expect(html).toMatch(/\.d\{[^}]*font-size:\.8rem/);
    expect(html).toContain("05 Nov 2026");
    // The financial year is shown per item (Year column, as "FY 2026-2027"), not as a line at the top of the bill.
    expect(html).not.toContain("Financial year");
    expect(html).toContain('<th class="n">Year</th>');
    expect(html).toContain('<td class="n">FY 2026-2027</td>');
    expect(html).toContain("GST @ 18%");
    expect(html).toContain("Pay in 15 days");
    expect(html).toContain("@page{margin:0}"); // no browser header/footer when printing
    // Laid out like the firm's own professional invoice.
    expect(html).toContain('<div class="title">PROFESSIONAL INVOICE</div>');
    expect(html).toContain("Being the charges for services rendered");
    expect(html).toContain("Twenty Nine Thousand Five Hundred Rupees Only"); // 25,000 + 18% GST, in words
    expect(html).toContain("E.&amp; O.E.");
    // The due date is in the remarks, not at the top.
    expect(html).toContain("Payment due by 20 Nov 2026.");
    expect(html.indexOf("Payment due by")).toBeGreaterThan(html.indexOf("Amount in words"));
    expect(html).toContain("Subject to Ahmedabad jurisdiction."); // the default city

    const json = JSON.parse(read("Bill Writer & Sons", "client-data.json"));
    expect(json.bills).toHaveLength(1);
    expect(json.bills[0].items[0].details).toBe("Audit under the Companies Act");
    expect(read("Bill Writer & Sons", "client-details.txt")).toContain(bill.body.bill_no);
  });

  it("escapes HTML in client-entered text", async () => {
    const c = await newClient({ name: "Escape Co" });
    const bill = await api
      .post("/api/bills")
      .set(auth())
      .send({ client_id: c.id, items: item("<script>alert(1)</script>", 100, "a & b") });
    const dir = path.join(root, "Escape Co", "bills");
    const html = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith(fileSafe(bill.body.bill_no)))!), "utf8");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("gives clients with the same name separate folders", async () => {
    const a = await newClient({ name: "Twin Name", city: "Surat" });
    const b = await newClient({ name: "Twin Name", city: "Rajkot" });
    expect(a.folder_name).toBe("Twin Name");
    expect(b.folder_name).toBe(`Twin Name (${b.id})`);
    expect(JSON.parse(read("Twin Name", "client-data.json")).client.city).toBe("Surat");
    expect(JSON.parse(read(`Twin Name (${b.id})`, "client-data.json")).client.city).toBe("Rajkot");
  });

  it("removes characters Windows does not allow from the folder name", async () => {
    const c = await newClient({ name: 'Mehta/Shah: "Traders"?' });
    expect(c.folder_name).toBe("Mehta-Shah- -Traders--");
    expect(has("Mehta-Shah- -Traders--", "client-details.txt")).toBe(true);
  });

  it("renames the folder (keeping its bills) when the client is renamed", async () => {
    const c = await newClient({ name: "Old Name Ltd" });
    const bill = await api.post("/api/bills").set(auth()).send({ client_id: c.id, bill_date: "2026-05-01", items: item() });
    const res = await api.put(`/api/clients/${c.id}`).set(auth()).send({ name: "New Name Ltd" });
    expect(res.body.folder_name).toBe("New Name Ltd");
    expect(has("Old Name Ltd")).toBe(false);
    expect(has("New Name Ltd", "bills", `${fileSafe(bill.body.bill_no)}_2026-05-01.html`)).toBe(true);
    expect(read("New Name Ltd", "client-details.txt")).toContain("New Name Ltd");
  });

  it("replaces the bill file when the bill date changes, and moves it when the client changes", async () => {
    const a = await newClient({ name: "Move From" });
    const b = await newClient({ name: "Move To" });
    const bill = await api.post("/api/bills").set(auth()).send({ client_id: a.id, bill_date: "2026-06-01", items: item() });
    const no = fileSafe(bill.body.bill_no);

    await api.put(`/api/bills/${bill.body.id}`).set(auth()).send({ client_id: a.id, bill_date: "2026-06-15", items: item() });
    expect(has("Move From", "bills", `${no}_2026-06-01.html`)).toBe(false);
    expect(has("Move From", "bills", `${no}_2026-06-15.html`)).toBe(true);

    await api.put(`/api/bills/${bill.body.id}`).set(auth()).send({ client_id: b.id, bill_date: "2026-06-15", items: item() });
    expect(has("Move From", "bills", `${no}_2026-06-15.html`)).toBe(false);
    expect(has("Move To", "bills", `${no}_2026-06-15.html`)).toBe(true);
    expect(JSON.parse(read("Move From", "client-data.json")).bills).toHaveLength(0);
    expect(JSON.parse(read("Move To", "client-data.json")).bills).toHaveLength(1);
  });

  it("keeps the folder when a client is deleted, and marks it", async () => {
    const c = await newClient({ name: "Soon Deleted" });
    await api.post("/api/bills").set(auth()).send({ client_id: c.id, items: item() });
    await api.delete(`/api/clients/${c.id}`).set(auth());
    expect(has("Soon Deleted", "client-details.txt")).toBe(true);
    expect(read("Soon Deleted", "client-details.txt")).toContain("DELETED");
    expect(fs.readdirSync(path.join(root, "Soon Deleted", "bills"))).toHaveLength(1);
    await api.post(`/api/clients/${c.id}/restore`).set(auth());
    expect(read("Soon Deleted", "client-details.txt")).toContain("Status:       Active");
  });

  it("rebuilds missing folders for every client (admin only)", async () => {
    const c = await newClient({ name: "Rebuild Me" });
    await api.post("/api/bills").set(auth()).send({ client_id: c.id, items: item() });
    fs.rmSync(path.join(root, "Rebuild Me"), { recursive: true, force: true });
    expect(has("Rebuild Me")).toBe(false);

    const res = await api.post("/api/client-files/rebuild").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.clients).toBeGreaterThan(5);
    expect(has("Rebuild Me", "client-details.txt")).toBe(true);
    expect(fs.readdirSync(path.join(root, "Rebuild Me", "bills"))).toHaveLength(1);

    await api.post("/api/users").set(auth()).send({ username: "staffer", password: "staffer-pass", full_name: "S" });
    const staffToken = (await api.post("/api/auth/login").send({ username: "staffer", password: "staffer-pass" })).body.token;
    const asStaff = { Authorization: `Bearer ${staffToken}` };
    expect((await api.post("/api/client-files/rebuild").set(asStaff)).status).toBe(403);
    expect((await api.get("/api/client-files/status").set(asStaff)).status).toBe(403);
  });

  it("reports the folder and status", async () => {
    const res = await api.get("/api/client-files/status").set(auth());
    expect(res.body).toMatchObject({ enabled: true, dir: root, lastError: null });
    expect(res.body.lastSync).toBeTruthy();
  });
});

describe("logo and payment details on bill copies", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const settings = (extra: object) =>
    api.put("/api/settings").set(auth()).send({ gst_enabled: false, gst_rate_percent: 18, org_name: "Pay Firm", ...extra });
  const billHtml = (folder: string) => {
    const dir = path.join(root, folder, "bills");
    return fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith(".html"))!), "utf8");
  };
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 40 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
  };

  it("embeds the logo and shows where to pay, and escapes the text", async () => {
    await settings({
      bank_account_holder: "Pay Firm & Co",
      bank_name: "Test Bank",
      bank_account_number: "000111222333",
      bank_ifsc: "TEST0000001",
      upi_id: "payfirm@bank",
      payment_instructions: "Quote the bill number <b>in the reference</b>",
    });
    await api.put("/api/settings/logo").set(auth()).set("Content-Type", "image/png").send(PNG);

    const c = await newClient({ name: "Pays Us" });
    await api.post("/api/bills").set(auth()).send({ client_id: c.id, items: item() });
    const html = billHtml("Pays Us");
    expect(html).toContain('<img class="logo" src="data:image/png;base64,');
    expect(html).toContain("Payment details");
    expect(html).toContain("Pay Firm &amp; Co");
    expect(html).toContain("000111222333");
    expect(html).toContain("TEST0000001");
    expect(html).toContain("payfirm@bank");
    expect(html).toContain("Quote the bill number &lt;b&gt;in the reference&lt;/b&gt;");
    expect(html).not.toContain("<b>in the reference</b>");
  });

  it("refreshes existing bill copies automatically when the settings change", async () => {
    await settings({ bank_account_number: "999888777666", bank_name: "New Bank" });
    await waitFor(() => billHtml("Pays Us").includes("999888777666"));
    const html = billHtml("Pays Us");
    expect(html).toContain("999888777666");
    expect(html).not.toContain("000111222333");
    expect(html).toContain('<img class="logo"'); // the logo is still there

    await api.delete("/api/settings/logo").set(auth());
    await waitFor(() => !billHtml("Pays Us").includes('<img class="logo"'));
    expect(billHtml("Pays Us")).not.toContain('<img class="logo"');
  });

  it("leaves the payment box out when no payment details are filled in", async () => {
    await settings({});
    const c = await newClient({ name: "No Payment Box" });
    await api.post("/api/bills").set(auth()).send({ client_id: c.id, items: item() });
    expect(billHtml("No Payment Box")).not.toContain("Payment details");
  });
});

describe("when the folder cannot be written", () => {
  it("still saves the client and bill, and reports the problem", async () => {
    const blocker = path.join(root, "not-a-folder.txt");
    fs.writeFileSync(blocker, "a file where a folder should be");
    const badApi = request(createApp(db, createClientFiles(db, path.join(blocker, "inside"))));

    const c = await badApi.post("/api/clients").set(auth()).send({ name: "Disk Problem Co" });
    expect(c.status).toBe(201);
    const bill = await badApi.post("/api/bills").set(auth()).send({ client_id: c.body.id, items: item() });
    expect(bill.status).toBe(201);

    const status = await badApi.get("/api/client-files/status").set(auth());
    expect(status.body.enabled).toBe(true);
    expect(status.body.lastError).toBeTruthy();
  });
});
