import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connect, migrate, type Db } from "../src/db/index.js";

let db: Db;
let api: ReturnType<typeof request>;
let admin = "";
let staff = "";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(username: string, password: string) {
  return api.post("/api/auth/login").send({ username, password });
}

async function newClient(name: string, extra: object = {}) {
  const res = await api.post("/api/clients").set(auth(staff)).send({ name, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

const oneItem = (price = 100_000) => [{ description: "Audit", quantity: 1, unit_price_paise: price }];

beforeAll(async () => {
  db = await connect("pglite:memory");
  await migrate(db);
  api = request(createApp(db));
  await db.query("INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')", [
    "boss",
    await bcrypt.hash("boss-password", 4),
    "The Boss",
  ]);
  admin = (await login("boss", "boss-password")).body.token;
  const created = await api
    .post("/api/users")
    .set(auth(admin))
    .send({ username: "Asha", password: "asha-password", full_name: "Asha Staff", role: "staff" });
  expect(created.status).toBe(201);
  staff = (await login("asha", "asha-password")).body.token;
});

afterAll(async () => {
  await db.close();
});

describe("auth", () => {
  it("rejects wrong passwords and unknown users the same way", async () => {
    const wrong = await login("boss", "nope");
    const unknown = await login("ghost", "nope");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("requires a token for protected routes", async () => {
    expect((await api.get("/api/clients")).status).toBe(401);
    expect((await api.get("/api/clients").set(auth("garbage"))).status).toBe(401);
  });

  it("returns the current user", async () => {
    const res = await api.get("/api/auth/me").set(auth(staff));
    expect(res.body.user).toMatchObject({ username: "asha", role: "staff" });
  });
});

describe("staff management (admin only)", () => {
  it("blocks staff from user and settings changes", async () => {
    expect((await api.get("/api/users").set(auth(staff))).status).toBe(403);
    const res = await api
      .put("/api/settings")
      .set(auth(staff))
      .send({ gst_enabled: true, gst_rate_percent: 18 });
    expect(res.status).toBe(403);
  });

  it("rejects duplicate usernames and short passwords", async () => {
    const dup = await api
      .post("/api/users")
      .set(auth(admin))
      .send({ username: "asha", password: "another-pass", full_name: "X" });
    expect(dup.status).toBe(409);
    const short = await api.post("/api/users").set(auth(admin)).send({ username: "newbie", password: "123", full_name: "X" });
    expect(short.status).toBe(400);
  });

  it("deactivated staff lose access immediately and cannot log in", async () => {
    const created = await api
      .post("/api/users")
      .set(auth(admin))
      .send({ username: "temp", password: "temp-password", full_name: "Temp" });
    const token = (await login("temp", "temp-password")).body.token;
    expect((await api.get("/api/clients").set(auth(token))).status).toBe(200);

    const off = await api.patch(`/api/users/${created.body.id}`).set(auth(admin)).send({ is_active: false });
    expect(off.body.is_active).toBe(false);
    expect((await api.get("/api/clients").set(auth(token))).status).toBe(401);
    expect((await login("temp", "temp-password")).status).toBe(401);
  });

  it("stops an admin deactivating themselves", async () => {
    const me = (await api.get("/api/auth/me").set(auth(admin))).body.user;
    const res = await api.patch(`/api/users/${me.id}`).set(auth(admin)).send({ is_active: false });
    expect(res.status).toBe(400);
  });
});

describe("clients", () => {
  it("validates input", async () => {
    expect((await api.post("/api/clients").set(auth(staff)).send({ name: "  " })).status).toBe(400);
    expect((await api.post("/api/clients").set(auth(staff)).send({ name: "A", email: "bad" })).status).toBe(400);
  });

  it("normalises PAN and GSTIN, and stores empty text as null", async () => {
    const res = await api.post("/api/clients").set(auth(staff)).send({ name: "Norm Co", pan: "abcde1234f", phone: "" });
    expect(res.body).toMatchObject({ pan: "ABCDE1234F", phone: null });
  });

  it("searches by name and phone, and soft delete hides a client", async () => {
    const c = await newClient("Zorro Traders", { phone: "9000011111" });
    const byName = await api.get("/api/clients?q=zorro").set(auth(staff));
    expect(byName.body.items.map((x: any) => x.id)).toContain(c.id);
    const byPhone = await api.get("/api/clients?q=9000011").set(auth(staff));
    expect(byPhone.body.items.map((x: any) => x.id)).toContain(c.id);

    expect((await api.delete(`/api/clients/${c.id}`).set(auth(staff))).status).toBe(204);
    const after = await api.get("/api/clients?q=zorro").set(auth(staff));
    expect(after.body.items).toHaveLength(0);
    const withDeleted = await api.get("/api/clients?q=zorro&include_deleted=true").set(auth(staff));
    expect(withDeleted.body.items).toHaveLength(1);

    const restored = await api.post(`/api/clients/${c.id}/restore`).set(auth(staff));
    expect(restored.body.is_deleted).toBe(false);
  });

  it("treats % in a search as a normal character", async () => {
    await newClient("Fifty Percent Ltd");
    const res = await api.get("/api/clients?q=%25").set(auth(staff));
    expect(res.body.items).toHaveLength(0);
  });
});

// A real 1x1 PNG image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("organisation payment details and logo", () => {
  const gst = { gst_enabled: false, gst_rate_percent: 18 };

  it("saves payment details (admin) and any logged-in user can read them", async () => {
    const res = await api.put("/api/settings").set(auth(admin)).send({
      ...gst,
      org_name: "Shah & Associates",
      bank_account_holder: "Shah and Associates",
      bank_name: "State Bank of India",
      bank_account_number: " 12345678901 ",
      bank_ifsc: "sbin0001234",
      bank_branch: "CG Road",
      upi_id: "shah@sbi",
      payment_instructions: "Cheques in favour of Shah and Associates",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      bank_account_number: "12345678901",
      bank_ifsc: "SBIN0001234",
      upi_id: "shah@sbi",
      has_logo: false,
      logo_version: 0,
    });
    const asStaff = await api.get("/api/settings").set(auth(staff));
    expect(asStaff.body).toMatchObject({ bank_name: "State Bank of India", bank_branch: "CG Road" });
  });

  it("stops staff changing payment details, the logo, or removing it", async () => {
    expect((await api.put("/api/settings").set(auth(staff)).send({ ...gst, bank_name: "Hacked" })).status).toBe(403);
    expect((await api.put("/api/settings/logo").set(auth(staff)).set("Content-Type", "image/png").send(PNG)).status).toBe(403);
    expect((await api.delete("/api/settings/logo").set(auth(staff))).status).toBe(403);
  });

  it("returns 404 before any logo exists", async () => {
    expect((await api.get("/api/settings/logo").set(auth(staff))).status).toBe(404);
  });

  it("accepts a PNG logo, serves it back to everyone, and removes it again", async () => {
    const up = await api.put("/api/settings/logo").set(auth(admin)).set("Content-Type", "image/png").send(PNG);
    expect(up.status).toBe(200);
    expect(up.body.has_logo).toBe(true);
    expect(up.body.logo_version).toBeGreaterThan(0);

    const got = await api.get("/api/settings/logo").set(auth(staff));
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(got.body, PNG)).toBe(0);
    expect((await api.get("/api/settings/logo")).status).toBe(401); // not public

    const gone = await api.delete("/api/settings/logo").set(auth(admin));
    expect(gone.body.has_logo).toBe(false);
    expect((await api.get("/api/settings/logo").set(auth(staff))).status).toBe(404);
  });

  it("refuses SVG, fake images, empty uploads and files over 1 MB", async () => {
    const put = (type: string, body: Buffer | string) =>
      api.put("/api/settings/logo").set(auth(admin)).set("Content-Type", type).send(body);

    // SVG can carry scripts, so it is not an accepted type at all.
    expect((await put("image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).status).toBe(415);
    // A file that only claims to be a PNG is caught by checking its real contents.
    expect((await put("image/png", Buffer.from("this is not an image at all"))).status).toBe(400);
    expect((await put("image/png", '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).status).toBe(400);
    expect((await put("application/json", Buffer.from("{}"))).status).toBe(415);
    const tooBig = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
    expect((await put("image/png", tooBig)).status).toBe(413);
    expect((await api.get("/api/settings/logo").set(auth(staff))).status).toBe(404); // none of them was stored
  });

  it("detects the real image type from its contents, not the label", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
    const up = await api.put("/api/settings/logo").set(auth(admin)).set("Content-Type", "image/png").send(jpeg);
    expect(up.status).toBe(200);
    expect((await api.get("/api/settings/logo").set(auth(staff))).headers["content-type"]).toBe("image/jpeg");
    await api.delete("/api/settings/logo").set(auth(admin));
  });
});

describe("validation messages a person can act on", () => {
  const post = (path: string, body: object) => api.post(path).set(auth(staff)).send(body);

  it("says what is wrong in plain words, never database or library jargon", async () => {
    const long = await post("/api/clients", { name: "X", phone: "+91 98765 43210 ext 123" });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe("Phone is too long (at most 20 characters)");

    expect((await post("/api/clients", { name: "  " })).body.error).toBe("Name is required");
    expect((await post("/api/clients", { name: "A", email: "nope" })).body.error).toBe("Email is not valid, for example name@example.com");
    expect((await post("/api/clients", { name: "A", referred_by: "r".repeat(151) })).body.error).toBe("Referred by is too long (at most 150 characters)");
  });

  it("names the item and the field when a bill line is wrong", async () => {
    const c = await newClient("Messages Co");
    const bill = (items: object[]) => post("/api/bills", { client_id: c.id, items });
    const line = { description: "Audit", quantity: 1, unit_price_paise: 100 };

    expect((await bill([])).body.error).toBe("Add at least one item to the bill");
    expect((await bill([line, { ...line, description: " " }])).body.error).toBe("Item 2 name is required");
    expect((await bill([{ ...line, quantity: 0 }])).body.error).toBe("Item 1 quantity must be at least 1");
    expect((await bill([{ ...line, details: "d".repeat(501) }])).body.error).toBe("Item 1 description is too long (at most 500 characters)");
    expect((await bill([{ ...line, unit_price_paise: 100_000_000_001 }])).body.error).toBe("Item 1 price is too large");
    expect((await post("/api/bills", { client_id: c.id, bill_date: "2026-13-45", items: [line] })).body.error).toBe("Bill date must be a real date (year-month-day)");
  });

  it("explains username and password rules in full sentences", async () => {
    const res = (body: object) => api.post("/api/users").set(auth(admin)).send(body);
    expect((await res({ username: "wiśniewska", password: "long-password-1", full_name: "A" })).body.error).toBe(
      "Username must be 3-30 characters: lowercase letters, numbers, dot, dash or underscore",
    );
    expect((await res({ username: "okname", password: "short", full_name: "A" })).body.error).toBe("Password must be at least 8 characters");
  });
});

describe("unrealistic bill totals", () => {
  const bill = (client_id: number, items: object[]) => api.post("/api/bills").set(auth(staff)).send({ client_id, items });

  it("refuses quantity x price that is too large to add up exactly, instead of storing a wrong total", async () => {
    const c = await newClient("Huge Totals Co");
    // The largest allowed price times the largest allowed quantity is 10^16 paise: more than JavaScript can add exactly.
    const res = await bill(c.id, [{ description: "Everything", quantity: 100_000, unit_price_paise: 100_000_000_000 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large.*₹100 crore/);
    const list = await api.get(`/api/bills?client_id=${c.id}`).set(auth(staff));
    expect(list.body.total).toBe(0); // nothing was stored
  });

  it("still accepts a very large but realistic bill, and shows it exactly", async () => {
    const c = await newClient("Big But Real Co");
    // Rs 29,78,84,924.40 across many lines, like the heaviest bill used in the stress test.
    const ok = await bill(c.id, [
      { description: "Big job", quantity: 100_000, unit_price_paise: 152_331 },
      { description: "Top price", quantity: 1, unit_price_paise: 9_999_999_999 },
    ]);
    expect(ok.status).toBe(201);
    expect(ok.body.subtotal_paise).toBe(100_000 * 152_331 + 9_999_999_999);
    expect(Number.isSafeInteger(ok.body.total_paise)).toBe(true);
  });

  it("applies the same limit when editing a bill", async () => {
    const c = await newClient("Edit Huge Co");
    const made = await bill(c.id, [{ description: "Fine", quantity: 1, unit_price_paise: 100 }]);
    const res = await api.put(`/api/bills/${made.body.id}`).set(auth(staff)).send({
      client_id: c.id,
      items: [{ description: "Too much", quantity: 100_000, unit_price_paise: 100_000_000_000 }],
    });
    expect(res.status).toBe(400);
    const again = await api.get(`/api/bills/${made.body.id}`).set(auth(staff));
    expect(again.body.subtotal_paise).toBe(100); // unchanged
  });
});

describe("client referred_by", () => {
  it("stores, updates and searches the referrer", async () => {
    const created = await api.post("/api/clients").set(auth(staff)).send({ name: "Referred Co", referred_by: "  Mr. Desai " });
    expect(created.body.referred_by).toBe("Mr. Desai");

    const found = await api.get("/api/clients?q=desai").set(auth(staff));
    expect(found.body.items.map((c: any) => c.id)).toContain(created.body.id);

    const updated = await api
      .put(`/api/clients/${created.body.id}`)
      .set(auth(staff))
      .send({ name: "Referred Co", referred_by: "" });
    expect(updated.body.referred_by).toBeNull();
  });
});

describe("bill line details (service description)", () => {
  it("keeps the service description on the bill even if the service is edited later", async () => {
    const c = await newClient("Details Co");
    const svc = await api
      .post("/api/services")
      .set(auth(staff))
      .send({ name: "Audit", description: "Statutory audit under the Companies Act, incl. report", price_paise: 500_000 });
    const bill = await api.post("/api/bills").set(auth(staff)).send({
      client_id: c.id,
      items: [
        {
          service_id: svc.body.id,
          description: svc.body.name,
          details: svc.body.description,
          quantity: 1,
          unit_price_paise: svc.body.price_paise,
        },
        { description: "Custom work", quantity: 1, unit_price_paise: 100 },
      ],
    });
    expect(bill.body.items[0]).toMatchObject({ description: "Audit", details: "Statutory audit under the Companies Act, incl. report" });
    expect(bill.body.items[1].details).toBeNull();

    await api
      .put(`/api/services/${svc.body.id}`)
      .set(auth(staff))
      .send({ name: "Audit v2", description: "Changed text", price_paise: 900_000, is_active: true });
    const again = await api.get(`/api/bills/${bill.body.id}`).set(auth(staff));
    expect(again.body.items[0]).toMatchObject({
      description: "Audit",
      details: "Statutory audit under the Companies Act, incl. report",
      unit_price_paise: 500_000,
    });
  });
});

describe("financial years", () => {
  // Indian FY: 1 April to 31 March. 2026-27 starts 1 Apr 2026.
  it("puts 31 March and 1 April in different financial years", async () => {
    const c = await newClient("Fy Boundary Co");
    const post = (bill_date: string) =>
      api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, bill_date, items: oneItem() });
    const mar = await post("2026-03-31");
    const apr = await post("2026-04-01");
    expect(mar.body.fy_start).toBe(2025);
    expect(apr.body.fy_start).toBe(2026);

    const fy2025 = await api.get("/api/bills?q=fy boundary&fy=2025").set(auth(staff));
    expect(fy2025.body.items.map((b: any) => b.id)).toEqual([mar.body.id]);
    const fy2026 = await api.get("/api/bills?q=fy boundary&fy=2026").set(auth(staff));
    expect(fy2026.body.items.map((b: any) => b.id)).toEqual([apr.body.id]);
    const all = await api.get("/api/bills?q=fy boundary").set(auth(staff));
    expect(all.body.total).toBe(2);
  });

  it("lists the financial years that have bills, newest first, with labels", async () => {
    const c = await newClient("Fy List Co");
    await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, bill_date: "2019-08-10", items: oneItem() });
    const years = await api.get("/api/bills/financial-years").set(auth(staff));
    expect(years.status).toBe(200);
    const list = years.body.items as { fy_start: number; label: string }[];
    expect(list.map((y) => y.fy_start)).toEqual([...list.map((y) => y.fy_start)].sort((a, b) => b - a));
    expect(list.find((y) => y.fy_start === 2019)?.label).toBe("2019-20");
    expect(list.find((y) => y.fy_start === 2025)?.label).toBe("2025-26");
  });

  it("rejects a nonsense year", async () => {
    expect((await api.get("/api/bills?fy=abc").set(auth(staff))).status).toBe(400);
  });
});

describe("services", () => {
  it("creates, updates and deactivates a service", async () => {
    const created = await api
      .post("/api/services")
      .set(auth(staff))
      .send({ name: "GST Filing", price_paise: 250_000 });
    expect(created.status).toBe(201);
    const updated = await api
      .put(`/api/services/${created.body.id}`)
      .set(auth(staff))
      .send({ name: "GST Filing (monthly)", price_paise: 300_000, is_active: false });
    expect(updated.body).toMatchObject({ name: "GST Filing (monthly)", price_paise: 300_000, is_active: false });
    const active = await api.get("/api/services").set(auth(staff));
    expect(active.body.items.map((s: any) => s.id)).not.toContain(created.body.id);
  });

  it("rejects fractional paise (money must be whole paise)", async () => {
    const res = await api.post("/api/services").set(auth(staff)).send({ name: "Bad", price_paise: 10.5 });
    expect(res.status).toBe(400);
  });
});

describe("bills", () => {
  it("creates a bill with no GST by default and assigns sequential numbers", async () => {
    const c = await newClient("Plain Bill Co");
    const a = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, items: oneItem(123_456) });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ subtotal_paise: 123_456, gst_paise: 0, total_paise: 123_456, gst_rate_percent: 0 });
    expect(a.body.bill_no).toMatch(/^\d{4}-\d{2}\/\d{4}$/); // e.g. 2026-27/0005
    expect(a.body.created_by_name).toBe("Asha Staff");
    const b = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, items: oneItem() });
    expect(b.body.bill_no).not.toBe(a.body.bill_no);
  });

  it("rejects empty bills, bad quantities, missing and deleted clients", async () => {
    const c = await newClient("Reject Co");
    const post = (body: object) => api.post("/api/bills").set(auth(staff)).send(body);
    expect((await post({ client_id: c.id, items: [] })).status).toBe(400);
    expect((await post({ client_id: c.id, items: [{ description: "x", quantity: 0, unit_price_paise: 1 }] })).status).toBe(400);
    expect((await post({ client_id: 999_999, items: oneItem() })).status).toBe(400);
    await api.delete(`/api/clients/${c.id}`).set(auth(staff));
    expect((await post({ client_id: c.id, items: oneItem() })).status).toBe(400);
  });

  it("snapshots GST on each bill: changing the setting never alters old bills", async () => {
    const c = await newClient("Gst Snapshot Co");
    const before = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, items: oneItem(100_000) });
    expect(before.body.gst_paise).toBe(0);

    const on = await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: true, gst_rate_percent: 18 });
    expect(on.body).toMatchObject({ gst_enabled: true, gst_rate_percent: 18 });

    const after = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, items: oneItem(100_000) });
    expect(after.body).toMatchObject({ gst_paise: 18_000, total_paise: 118_000, gst_rate_percent: 18 });

    // Turn GST off again, then edit the GST bill: it keeps ITS OWN 18% rate.
    await api.put("/api/settings").set(auth(admin)).send({ gst_enabled: false, gst_rate_percent: 5 });
    const edited = await api
      .put(`/api/bills/${after.body.id}`)
      .set(auth(staff))
      .send({ client_id: c.id, items: oneItem(200_000) });
    expect(edited.body).toMatchObject({ gst_paise: 36_000, total_paise: 236_000, gst_rate_percent: 18 });

    // The first bill is still untouched.
    const old = await api.get(`/api/bills/${before.body.id}`).set(auth(staff));
    expect(old.body).toMatchObject({ gst_paise: 0, total_paise: 100_000 });
  });

  it("records who last edited a bill and replaces its items", async () => {
    const c = await newClient("Edit Co");
    const bill = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, items: oneItem(100) });
    expect(bill.body.updated_by_name).toBeNull();
    const edited = await api
      .put(`/api/bills/${bill.body.id}`)
      .set(auth(admin))
      .send({
        client_id: c.id,
        notes: "revised",
        items: [
          { description: "A", quantity: 2, unit_price_paise: 500 },
          { description: "B", quantity: 1, unit_price_paise: 250 },
        ],
      });
    expect(edited.body.updated_by_name).toBe("The Boss");
    expect(edited.body.items).toHaveLength(2);
    expect(edited.body.subtotal_paise).toBe(1250);
    expect(edited.body.notes).toBe("revised");
  });

  it("keeps old bills visible after their client is soft-deleted", async () => {
    const c = await newClient("Soon Gone Ltd");
    const bill = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, items: oneItem() });
    await api.delete(`/api/clients/${c.id}`).set(auth(staff));
    const res = await api.get(`/api/bills/${bill.body.id}`).set(auth(staff));
    expect(res.status).toBe(200);
    expect(res.body.client_name).toBe("Soon Gone Ltd");
  });

  it("searches by client name or bill number, newest first, with paging", async () => {
    const c = await newClient("Paging Partners");
    const other = await newClient("Someone Else");
    const dates = ["2026-01-05", "2026-03-10", "2026-02-20", "2026-03-10"];
    const ids: number[] = [];
    for (const d of dates) {
      const r = await api.post("/api/bills").set(auth(staff)).send({ client_id: c.id, bill_date: d, items: oneItem() });
      ids.push(r.body.id);
    }
    await api.post("/api/bills").set(auth(staff)).send({ client_id: other.id, items: oneItem() });

    const all = await api.get("/api/bills?q=paging").set(auth(staff));
    expect(all.body.total).toBe(4);
    expect(all.body.items.map((b: any) => b.bill_date)).toEqual(["2026-03-10", "2026-03-10", "2026-02-20", "2026-01-05"]);
    // Same date: the later-created bill comes first.
    expect(all.body.items[0].id).toBe(ids[3]);
    expect(all.body.items[0]).toMatchObject({ client_name: "Paging Partners" });

    const page2 = await api.get("/api/bills?q=paging&limit=3&page=2").set(auth(staff));
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(4);

    const byNo = await api.get(`/api/bills?q=${all.body.items[2].bill_no}`).set(auth(staff));
    expect(byNo.body.items.map((b: any) => b.id)).toEqual([all.body.items[2].id]);

    const byClient = await api.get(`/api/bills?client_id=${other.id}`).set(auth(staff));
    expect(byClient.body.items).toHaveLength(1);
  });

  it("returns 404 for unknown bills and 400 for bad ids in filters", async () => {
    expect((await api.get("/api/bills/999999").set(auth(staff))).status).toBe(404);
    expect((await api.get("/api/bills?client_id=abc").set(auth(staff))).status).toBe(400);
  });
});
