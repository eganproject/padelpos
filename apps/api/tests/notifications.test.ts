import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-notify-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("notify");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
for (const name of ["MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "SMTP_HOST", "WHATSAPP_PROVIDER"]) delete process.env[name];

/** Midtrans diganti stub: tidak ada permintaan jaringan selama uji. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  if (!String(input).includes("midtrans.com")) return realFetch(input, init);
  const body = String(input).includes("/snap/v1/transactions")
    ? { token: "tok-uji", redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-uji" }
    : { status_code: "404" };
  return new Response(JSON.stringify(body), { status: String(input).includes("/snap/") ? 201 : 404, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

/** Server Wablas tiruan: menyimpan setiap pesan dan bisa diminta menolak. */
const wablas: { auth: string; phone: string; message: string }[] = [];
let wablasDown = false;
const provider = createServer((req, res) => {
  let raw = "";
  req.on("data", chunk => { raw += chunk; });
  req.on("end", () => {
    if (wablasDown) { res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ status: false, message: "Perangkat terputus" })); return; }
    const body = JSON.parse(raw) as { phone: string; message: string };
    wablas.push({ auth: String(req.headers.authorization), ...body });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: true }));
  });
});
await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
const wablasUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");
const { queuePaymentDue, queueReminders } = await import("../src/notifications.js");
const { deliverDueWhatsApp } = await import("../src/whatsapp.js");
const { expireHolds } = await import("../src/payments.js");

test("notifikasi tagihan, kwitansi, WhatsApp, dan kotak masuk pelanggan", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const day = (offset: number) => { const value = new Date(localClock().date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  const whatsapp = async (kind: string) => await db.prepare("SELECT recipient,text,status,provider FROM whatsapp_outbox WHERE kind=? ORDER BY created_at").all(kind) as { recipient: string; text: string; status: string; provider: string }[];
  const wa = (overrides = {}) => ({ enabled: true, provider: "simulasi", token: "", base_url: "", phone_number_id: "", staff_numbers: ["0811 1111 2222"], reminder_hours: 24, ...overrides });
  let admin = "", staff = "", courtId = "", rina = "", accountId = "";

  try {
    await t.test("penyiapan: admin, lapangan, Midtrans, dan akun pelanggan", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Notif", email: "admin@notif.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Operator", email: "staff@notif.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "staff@notif.test", password: "StrongPass123" })).cookie;
      const court = await request("/operations/courts", "POST", { name: "Court Notif", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      courtId = court.data.court.id;
      assert.equal((await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-uji", server_key: "SB-Mid-server-uji123", mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin)).status, 200);
      // Akun Google dibuat langsung dengan sesi aktif; alur login Firebase sudah diuji di customer.test.ts.
      accountId = randomUUID();
      const stamp = new Date().toISOString(), token = "token-sesi-rina";
      await db.prepare("INSERT INTO customer_accounts (id,firebase_uid,email,name,phone,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)").run(accountId, "uid-rina", "rina@gmail.test", "Rina", "6281277778888", stamp, stamp);
      await db.prepare("INSERT INTO sessions (id,subject_id,subject_type,expires_at) VALUES (?,?,'customer',?)").run(createHash("sha256").update(token).digest("hex"), accountId, Date.now() + 3600000);
      rina = `padelix_customer=${token}`;
      const me = await request("/customer/me", "GET", undefined, rina);
      assert.deepEqual(me.data.account.notify, { email: true, whatsapp: true });
    });

    await t.test("pengaturan WhatsApp: hanya menu Notifikasi, penyedia wajib lengkap, token tidak dikirim balik", async () => {
      assert.equal((await request("/operations/notifications/whatsapp", "PUT", wa(), staff)).status, 403);
      const incomplete = await request("/operations/notifications/whatsapp", "PUT", wa({ provider: "wablas", token: "rahasia" }), admin);
      assert.equal(incomplete.status, 409);
      assert.match(incomplete.data.message, /server Wablas/);
      assert.equal((await request("/operations/notifications/whatsapp", "PUT", wa({ staff_numbers: ["123"] }), admin)).status, 400);
      const saved = await request("/operations/notifications/whatsapp", "PUT", wa({ events: { receipt: false } }), admin);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.settings.ready, true);
      assert.deepEqual(saved.data.settings.staff_numbers, ["6281111112222"]);
      assert.equal(saved.data.settings.events.receipt, false);
      assert.equal(saved.data.settings.events.bill, true, "peristiwa yang tidak dikirim memakai nilai bawaan");
      const test = await request("/operations/notifications/whatsapp/test", "POST", { to: "0812 0000 1111" }, admin);
      assert.equal(test.status, 200);
      assert.match(test.data.message, /simulasi/i);
      const menu = await request("/access/overview", "GET", undefined, admin);
      assert.ok(menu.data.menus.some((item: { id: string; name: string }) => item.id === "notifications" && item.name === "Notifikasi"));
    });

    let orderId = "";
    await t.test("checkout: tagihan masuk WhatsApp dan kotak masuk akun", async () => {
      const created = await request("/public/checkout", "POST", {
        items: [{ court_id: courtId, date: day(2), start_time: "10:00", end_time: "11:00", addons: [] }],
        customer: "Rina", phone: "0812 7777 8888", email: "", notes: "",
      }, rina);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      orderId = created.data.order_id;
      const bills = await whatsapp("bill");
      assert.equal(bills.length, 1);
      assert.equal(bills[0].recipient, "6281277778888");
      assert.match(bills[0].text, /\*Satu langkah lagi/);
      assert.match(bills[0].text, /Bayar sebelum: \*/);
      assert.match(bills[0].text, new RegExp(`https://padelix.contoh/pesanan/${orderId}`));
      const inbox = await request("/customer/notifications", "GET", undefined, rina);
      assert.equal(inbox.status, 200);
      assert.equal(inbox.data.unread, 1);
      assert.equal(inbox.data.items[0].kind, "bill");
      assert.equal(inbox.data.items[0].tone, "warning");
      assert.equal(inbox.data.items[0].link, `/pesanan/${orderId}`, "tautan kotak masuk relatif ke situs");
      assert.equal((await request("/customer/notifications", "GET")).status, 401, "kotak masuk butuh login");
    });

    await t.test("pengingat batas bayar dikirim sekali, lalu kabar kedaluwarsa saat slot dilepas", async () => {
      await db.prepare("UPDATE bookings SET hold_expires_at=UNIX_TIMESTAMP()+900 WHERE order_id=?").run(orderId);
      assert.equal(await queuePaymentDue(20), 0, "masih jauh dari batas");
      await db.prepare("UPDATE bookings SET hold_expires_at=UNIX_TIMESTAMP()+300 WHERE order_id=?").run(orderId);
      assert.equal(await queuePaymentDue(20), 2, "WhatsApp dan kotak masuk");
      assert.equal(await queuePaymentDue(20), 0, "tidak dobel");
      assert.match((await whatsapp("payment_due"))[0].text, /Sisa sekitar \d+ menit/);
      await db.prepare("UPDATE bookings SET hold_expires_at=UNIX_TIMESTAMP()-1 WHERE order_id=?").run(orderId);
      assert.equal(await expireHolds(), 1);
      const expired = await whatsapp("expired");
      assert.equal(expired.length, 1);
      assert.match(expired[0].text, /sudah dilepas/);
      assert.match(expired[0].text, /ketersediaan\?tanggal=/);
      const inbox = await request("/customer/notifications", "GET", undefined, rina);
      assert.deepEqual(inbox.data.items.map((item: { kind: string }) => item.kind), ["expired", "payment_due", "bill"]);
      assert.equal(inbox.data.unread, 3);
    });

    await t.test("kasir mencatat pembayaran: kwitansi mengikuti pilihan kanal", async () => {
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Rina", phone: "081277778888", email: "", date: day(3), start_time: "12:00", end_time: "13:00" }, staff);
      assert.equal(created.status, 201);
      const bookingId = created.data.booking.id;
      await db.prepare("UPDATE bookings SET account_id=? WHERE id=?").run(accountId, bookingId);
      const paid = await request(`/operations/bookings/${bookingId}/payments`, "POST", { id: randomUUID(), amount: 50000, kind: "payment", method: "cash", note: "" }, staff);
      assert.equal(paid.status, 201, JSON.stringify(paid.data));
      assert.equal((await whatsapp("receipt")).length, 0, "kwitansi WhatsApp dimatikan admin");
      const inbox = await request("/customer/notifications?limit=1", "GET", undefined, rina);
      assert.equal(inbox.data.items[0].kind, "receipt");
      assert.equal(inbox.data.items[0].title, "Pembayaran diterima");
      assert.match(inbox.data.items[0].body, /Dibayar: Rp50\.000/);
      assert.equal(inbox.data.more, true);

      // Pelanggan mematikan WhatsApp: tagihan dari kasir hanya masuk kotak masuk.
      const prefs = await request("/customer/me/notifications", "PUT", { email: true, whatsapp: false }, rina);
      assert.deepEqual(prefs.data.account.notify, { email: true, whatsapp: false });
      const link = await request(`/operations/bookings/${bookingId}/payment-link`, "POST", {}, staff);
      assert.equal(link.status, 201, JSON.stringify(link.data));
      assert.equal(link.data.intent.notified, 1);
      assert.equal((await whatsapp("bill")).length, 1, "tidak ada WhatsApp baru");
      const latest = (await request("/customer/notifications?limit=1", "GET", undefined, rina)).data.items[0];
      assert.equal(latest.title, "Tagihan baru dari venue");
      assert.match(latest.link, /^https:\/\/app\.sandbox\.midtrans\.com/);
    });

    await t.test("tandai dibaca: sebagian lalu semuanya, hanya milik sendiri", async () => {
      const inbox = await request("/customer/notifications", "GET", undefined, rina);
      const first = inbox.data.items[0].id;
      const partial = await request("/customer/notifications/read", "POST", { ids: [first, randomUUID()] }, rina);
      assert.equal(partial.data.unread, inbox.data.unread - 1);
      assert.equal((await request("/customer/notifications/unread", "GET", undefined, rina)).data.unread, inbox.data.unread - 1);
      assert.equal((await request("/customer/notifications/read", "POST", {}, rina)).data.unread, 0);
    });

    await t.test("pengingat main memakai jendela tiap kanal, dan pesan staf terkirim lewat Wablas", async () => {
      const soon = localClock(new Date(Date.now() + 3 * 3600000));
      const hour = Number(soon.time.slice(0, 2)) + 1;
      if (soon.date === localClock().date && hour >= 7 && hour <= 21) {
        const start = `${String(hour).padStart(2, "0")}:00`, end = `${String(hour + 1).padStart(2, "0")}:00`;
        const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Dekat", phone: "081200003333", email: "", date: soon.date, start_time: start, end_time: end }, staff);
        assert.equal(created.status, 201, JSON.stringify(created.data));
        await request("/operations/notifications/whatsapp", "PUT", wa({ reminder_hours: 1 }), admin);
        await queueReminders();
        assert.ok(!(await whatsapp("reminder")).some(row => row.recipient === "6281200003333"), "di luar jendela 1 jam");
        await request("/operations/notifications/whatsapp", "PUT", wa({ reminder_hours: 6 }), admin);
        await queueReminders();
        assert.ok((await whatsapp("reminder")).some(row => row.recipient === "6281200003333"));
      }

      const saved = await request("/operations/notifications/whatsapp", "PUT", wa({ provider: "wablas", token: "tok-wablas", base_url: wablasUrl + "/" }), admin);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.settings.token_set, true);
      assert.equal(JSON.stringify(saved.data).includes("tok-wablas"), false, "token tidak pernah dikirim balik");
      // Pesan lama (simulasi) sudah terkirim; yang baru menunggu penyedia sungguhan.
      await db.prepare("UPDATE whatsapp_outbox SET status='sent' WHERE status='pending'").run();
      await db.prepare("INSERT INTO whatsapp_outbox (id,`key`,kind,recipient,text,next_attempt_at,created_at) VALUES (?,?,?,?,?,UNIX_TIMESTAMP(),?)")
        .run(randomUUID(), "uji-wablas", "staff_new", "6281111112222", "Halo staf", new Date().toISOString());
      wablasDown = true;
      assert.deepEqual(await deliverDueWhatsApp(), { sent: 0, failed: 1 });
      const failed = await db.prepare("SELECT id,status,last_error FROM whatsapp_outbox WHERE `key`='uji-wablas'").get() as { id: string; status: string; last_error: string };
      assert.equal(failed.status, "pending");
      assert.match(failed.last_error, /Perangkat terputus/);
      await db.prepare("UPDATE whatsapp_outbox SET status='failed' WHERE id=?").run(failed.id);
      wablasDown = false;
      const retried = await request(`/operations/notifications/whatsapp/${failed.id}/retry`, "POST", {}, admin);
      assert.equal(retried.status, 200);
      assert.deepEqual(wablas.at(-1), { auth: "tok-wablas", phone: "6281111112222", message: "Halo staf" });
      const panel = await request("/operations/notifications", "GET", undefined, admin);
      const row = panel.data.whatsapp.outbox.items.find((item: { id: string }) => item.id === failed.id);
      assert.equal(row.status, "sent");
      assert.equal(row.provider, "wablas");
    });

    await t.test("halaman pesanan memuat riwayat pembayaran untuk kwitansi", async () => {
      const view = await request(`/public/orders/${orderId}`, "GET");
      assert.equal(view.status, 200);
      assert.deepEqual(view.data.payments, []);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    provider.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
