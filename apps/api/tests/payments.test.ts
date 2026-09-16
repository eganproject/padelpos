import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-pay-test-"));
process.env.DATA_DIR = directory;
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
// Kunci dari environment akan mengalahkan panel admin, jadi dipastikan kosong selama uji.
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.MIDTRANS_CLIENT_KEY;

const serverKey = "SB-Mid-server-ujicoba123";
const signature = (orderId: string, statusCode: string, grossAmount: string) =>
  createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");

/** Midtrans diganti stub: tidak ada permintaan jaringan selama uji. */
const calls: { url: string; method: string; auth: string; body: Record<string, unknown> }[] = [];
let snapReply: { status: number; body: unknown } = { status: 201, body: { token: "tok-uji", redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-uji" } };
let statusReply: { status: number; body: unknown } = { status: 404, body: { status_code: "404", status_message: "Transaction doesn't exist." } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (!url.includes("midtrans.com")) return realFetch(input, init);
  const headers = new Headers(init.headers);
  calls.push({ url, method: init.method ?? "GET", auth: headers.get("Authorization") ?? "", body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} });
  const reply = url.includes("/snap/v1/transactions") ? snapReply : statusReply;
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("pembayaran online Midtrans: pengaturan, checkout, webhook, dan pelepasan slot", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "", origin = "http://localhost:3000") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, ...(origin ? { Origin: origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const tomorrowDate = new Date(localClock().date + "T12:00:00Z"); tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  const settings = (overrides = {}) => ({ enabled: true, environment: "sandbox", client_key: "SB-Mid-client-ujicoba", server_key: serverKey, mode: "full", dp_percent: 50, hold_minutes: 20, note: "", ...overrides });
  let admin = "", staff = "", courtId = "", addonId = "";
  const checkout = (overrides = {}) => ({ court_id: courtId, date: tomorrow, start_time: "10:00", end_time: "11:00", customer: "Pelanggan Online", phone: "081234500001", email: "pelanggan@contoh.test", notes: "", addons: [], ...overrides });
  const notify = (orderId: string, amount: number, status = "settlement", overrides = {}) => ({
    order_id: orderId, status_code: "200", gross_amount: `${amount}.00`, signature_key: signature(orderId, "200", `${amount}.00`),
    transaction_status: status, fraud_status: "accept", transaction_id: `trx-${orderId}`, payment_type: "qris", ...overrides,
  });

  try {
    await t.test("penyiapan: admin, operator, lapangan, dan satu item tambahan", async () => {
      const registered = await request("/auth/register", "POST", { name: "Admin Bayar", email: "admin@bayar.test", phone: "081234567890", password: "StrongPass123" });
      assert.equal(registered.status, 201); admin = registered.cookie;
      assert.equal((await request("/access/users", "POST", { name: "Operator Bayar", email: "staff@bayar.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "staff@bayar.test", password: "StrongPass123" })).cookie;
      const court = await request("/operations/courts", "POST", { name: "Court Bayar", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      assert.equal(court.status, 201); courtId = court.data.court.id;
      const addon = await request("/operations/addons", "POST", { name: "Bola uji", category: "bola", type: "jual", pricing: "per_booking", price: 50000, stock: 4, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin);
      assert.equal(addon.status, 201); addonId = addon.data.addon.id;
    });

    await t.test("pengaturan Midtrans: hanya admin, kunci tervalidasi, dan server key tidak pernah dikirim balik", async () => {
      assert.equal((await request("/operations/payments", "GET", undefined, staff)).status, 403, "operator tanpa menu Pembayaran ditolak");
      assert.equal((await request("/operations/payments/settings", "PUT", settings(), staff)).status, 403);
      assert.equal((await request("/operations/payments/settings", "PUT", settings({ server_key: "Mid-server-salah" }), admin)).status, 400, "server key produksi tidak boleh dipakai di sandbox");
      assert.equal((await request("/operations/payments/settings", "PUT", settings({ server_key: "", client_key: "" }), admin)).status, 409, "tidak bisa aktif tanpa server key");
      const saved = await request("/operations/payments/settings", "PUT", settings(), admin);
      assert.equal(saved.status, 200);
      assert.equal(saved.data.settings.ready, true);
      assert.equal(saved.data.settings.server_key_set, true);
      assert.equal(saved.data.settings.key_source, "panel");
      assert.ok(!JSON.stringify(saved.data).includes(serverKey), "server key tidak boleh ikut terkirim ke browser");
      assert.equal(saved.data.settings.webhook_url, "https://padelix.contoh/api/public/payments/midtrans/notification");
      const info = await request("/public/info", "GET");
      assert.equal(info.data.payment.enabled, true);
      assert.ok(!JSON.stringify(info.data.payment).includes(serverKey));
    });

    await t.test("checkout mengunci slot, memanggil Snap, dan menolak slot yang sama", async () => {
      const before = calls.length;
      const created = await request("/public/checkout", "POST", checkout({ addons: [{ addon_id: addonId, quantity: 2 }] }));
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.equal(created.data.total, 400000, "sewa 300.000 + 2 bola 100.000");
      assert.equal(created.data.amount, 400000, "mode penuh menagih seluruh tagihan");
      assert.match(created.data.redirect_url, /snap\/v2\/vtweb/);
      const snap = calls[before];
      assert.equal(snap.method, "POST");
      assert.equal(snap.auth, "Basic " + Buffer.from(serverKey + ":").toString("base64"));
      const details = snap.body.transaction_details as { order_id: string; gross_amount: number };
      assert.equal(details.gross_amount, 400000);
      assert.equal(details.order_id, created.data.order_id);
      const items = snap.body.item_details as { price: number; quantity: number }[];
      assert.equal(items.reduce((sum, item) => sum + item.price * item.quantity, 0), 400000, "rincian item wajib sama dengan nominal tagihan");
      assert.equal((snap.body.callbacks as { finish: string }).finish, `https://padelix.contoh/pesanan/${created.data.booking_id}`);

      const open = await request(`/public/availability?date=${tomorrow}`, "GET");
      const slots = open.data.courts.find((entry: { court: { id: string } }) => entry.court.id === courtId).slots;
      assert.equal(slots.find((slot: { start: string }) => slot.start === "10:00").state, "booked", "slot terkunci selama menunggu pembayaran");
      assert.ok(!JSON.stringify(open.data).includes("Pelanggan Online"), "data pemesan tidak bocor di jadwal publik");
      assert.equal((await request("/public/checkout", "POST", checkout({ start_time: "10:30", end_time: "11:30" }))).status, 409, "slot yang sedang ditahan tidak bisa dipesan orang lain");
      assert.equal((await request("/public/checkout", "POST", checkout({ start_time: "12:00", end_time: "12:15" }))).status, 400, "durasi di luar 1–3 jam ditolak");
      assert.equal((db.prepare("SELECT stock FROM addons WHERE id=?").get(addonId) as { stock: number }).stock, 2, "stok bola berkurang selama booking ditahan");
      (globalThis as Record<string, unknown>).orderPertama = created.data;
    });

    await t.test("webhook: tanda tangan dan nominal diperiksa, pelunasan idempoten", async () => {
      const order = (globalThis as Record<string, unknown>).orderPertama as { order_id: string; booking_id: string; amount: number };
      const palsu = { ...notify(order.order_id, order.amount), signature_key: "a".repeat(128) };
      assert.equal((await request("/public/payments/midtrans/notification", "POST", palsu, "", "")).status, 403, "tanda tangan salah ditolak");
      assert.equal((await request("/public/payments/midtrans/notification", "POST", notify(order.order_id, 1000), "", "")).status, 409, "nominal yang tidak cocok ditolak");
      const unknown = await request("/public/payments/midtrans/notification", "POST", notify("PDX-TIDAK-ADA", 400000), "", "");
      assert.equal(unknown.status, 200, "order asing tetap dijawab 200 agar tidak dikirim ulang terus");
      assert.equal(unknown.data.handled, false);

      const settled = await request("/public/payments/midtrans/notification", "POST", notify(order.order_id, order.amount), "", "");
      assert.equal(settled.status, 200); assert.equal(settled.data.outcome, "paid");
      const booking = await request(`/operations/bookings/${order.booking_id}`, "GET", undefined, admin);
      assert.equal(booking.data.booking.status, "confirmed");
      assert.equal(booking.data.booking.paid, 400000);
      assert.equal(booking.data.payments.length, 1);
      assert.equal(booking.data.payments[0].source, "gateway");
      assert.equal(booking.data.payments[0].method, "qris");
      assert.equal(booking.data.booking.hold_expires_at, null);
      await request("/public/payments/midtrans/notification", "POST", notify(order.order_id, order.amount), "", "");
      assert.equal((await request(`/operations/bookings/${order.booking_id}`, "GET", undefined, admin)).data.payments.length, 1, "notifikasi ganda tidak menambah pembayaran");
    });

    await t.test("halaman status pesanan menyamarkan nomor dan tidak membocorkan data lain", async () => {
      const order = (globalThis as Record<string, unknown>).orderPertama as { booking_id: string };
      const view = await request(`/public/orders/${order.booking_id}`, "GET");
      assert.equal(view.status, 200);
      assert.equal(view.data.order.status, "confirmed");
      assert.equal(view.data.order.total, 400000);
      assert.equal(view.data.order.addons.length, 1);
      assert.ok(view.data.order.phone.includes("•"), "nomor telepon disamarkan");
      assert.ok(!JSON.stringify(view.data).includes("081234500001"));
      assert.equal(view.data.payment.status, "paid");
      assert.equal(view.data.payment.redirect_url, null, "tautan bayar disembunyikan setelah lunas");
      assert.equal((await request("/public/orders/00000000-0000-4000-8000-000000000000", "GET")).status, 404);
    });

    await t.test("pembayaran gagal atau kedaluwarsa melepas slot dan mengembalikan stok", async () => {
      const created = await request("/public/checkout", "POST", checkout({ start_time: "14:00", end_time: "15:00", addons: [{ addon_id: addonId, quantity: 2 }] }));
      assert.equal(created.status, 201);
      assert.equal((db.prepare("SELECT stock FROM addons WHERE id=?").get(addonId) as { stock: number }).stock, 0);
      const expired = await request("/public/payments/midtrans/notification", "POST", notify(created.data.order_id, created.data.amount, "expire"), "", "");
      assert.equal(expired.data.outcome, "expired");
      const booking = await request(`/operations/bookings/${created.data.booking_id}`, "GET", undefined, admin);
      assert.equal(booking.data.booking.status, "expired");
      assert.equal((db.prepare("SELECT stock FROM addons WHERE id=?").get(addonId) as { stock: number }).stock, 2, "stok kembali setelah pembayaran gagal");
      const open = await request(`/public/availability?date=${tomorrow}`, "GET");
      const slots = open.data.courts.find((entry: { court: { id: string } }) => entry.court.id === courtId).slots;
      assert.equal(slots.find((slot: { start: string }) => slot.start === "14:00").state, "available", "slot terbuka lagi");
    });

    await t.test("batas waktu bayar yang lewat melepas slot walau webhook tidak pernah datang", async () => {
      const created = await request("/public/checkout", "POST", checkout({ start_time: "16:00", end_time: "17:00" }));
      assert.equal(created.status, 201);
      db.prepare("UPDATE bookings SET hold_expires_at=unixepoch()-60 WHERE id=?").run(created.data.booking_id);
      const open = await request(`/public/availability?date=${tomorrow}`, "GET");
      const slots = open.data.courts.find((entry: { court: { id: string } }) => entry.court.id === courtId).slots;
      assert.equal(slots.find((slot: { start: string }) => slot.start === "16:00").state, "available");
      assert.equal((await request(`/operations/bookings/${created.data.booking_id}`, "GET", undefined, admin)).data.booking.status, "expired");
      assert.equal((await request("/public/checkout", "POST", checkout({ start_time: "16:00", end_time: "17:00" }))).status, 201, "slot yang sudah dilepas bisa dipesan lagi");
    });

    await t.test("mode DP menagih sebagian dan menyisakan tagihan di venue", async () => {
      assert.equal((await request("/operations/payments/settings", "PUT", settings({ mode: "dp", dp_percent: 40, server_key: "" }), admin)).status, 200, "server key kosong berarti dipertahankan");
      const created = await request("/public/checkout", "POST", checkout({ start_time: "19:00", end_time: "20:00" }));
      assert.equal(created.status, 201);
      assert.equal(created.data.total, 300000);
      assert.equal(created.data.amount, 120000, "DP 40% dari 300.000");
      await request("/public/payments/midtrans/notification", "POST", notify(created.data.order_id, created.data.amount), "", "");
      const booking = await request(`/operations/bookings/${created.data.booking_id}`, "GET", undefined, admin);
      assert.equal(booking.data.booking.status, "confirmed");
      assert.equal(booking.data.booking.paid, 120000);
      assert.equal(booking.data.booking.total - booking.data.booking.paid, 180000, "sisanya dibayar di venue");
      assert.equal((await request("/operations/payments/settings", "PUT", settings(), admin)).status, 200);
    });

    await t.test("periksa status menanyakan langsung ke Midtrans bila webhook belum masuk", async () => {
      const created = await request("/public/checkout", "POST", checkout({ start_time: "21:00", end_time: "22:00" }));
      assert.equal(created.status, 201);
      statusReply = { status: 200, body: { status_code: "200", transaction_status: "settlement", fraud_status: "accept", transaction_id: `trx-refresh`, payment_type: "gopay", gross_amount: `${created.data.amount}.00` } };
      const refreshed = await request(`/public/orders/${created.data.booking_id}/refresh`, "POST", {});
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.data.order.status, "confirmed");
      assert.equal(refreshed.data.payment.status, "paid");
      const booking = await request(`/operations/bookings/${created.data.booking_id}`, "GET", undefined, admin);
      assert.equal(booking.data.payments[0].method, "ewallet", "gopay dicatat sebagai e-wallet");
      statusReply = { status: 404, body: { status_code: "404", status_message: "Transaction doesn't exist." } };
    });

    await t.test("link tagihan staf hanya mencatat pembayaran, tidak mengubah status booking", async () => {
      const booking = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Tamu Kasir", phone: "081234500002", date: tomorrow, start_time: "08:00", end_time: "09:00", notes: "" }, staff);
      assert.equal(booking.status, 201);
      const id = booking.data.booking.id;
      const link = await request(`/operations/bookings/${id}/payment-link`, "POST", {}, staff);
      assert.equal(link.status, 201);
      assert.equal(link.data.intent.kind, "tagihan");
      assert.equal(link.data.intent.amount, 300000);
      assert.match(link.data.intent.redirect_url, /vtweb/);
      assert.equal((await request(`/operations/bookings/${id}/payment-link`, "POST", { amount: 400000 }, staff)).status, 400, "nominal melebihi sisa tagihan ditolak");
      await request("/public/payments/midtrans/notification", "POST", notify(link.data.intent.order_id, 300000, "settlement", { payment_type: "bank_transfer" }), "", "");
      const after = await request(`/operations/bookings/${id}`, "GET", undefined, staff);
      assert.equal(after.data.booking.status, "confirmed");
      assert.equal(after.data.booking.paid, 300000);
      assert.equal(after.data.payments[0].method, "va");
      assert.equal((await request(`/operations/bookings/${id}/payment-link`, "POST", {}, staff)).status, 409, "booking lunas tidak perlu link baru");
    });

    await t.test("checkout ditolak saat pembayaran online dimatikan", async () => {
      assert.equal((await request("/operations/payments/settings", "PUT", settings({ enabled: false }), admin)).status, 200);
      const off = await request("/public/checkout", "POST", checkout({ start_time: "07:00", end_time: "08:00" }));
      assert.equal(off.status, 409);
      assert.match(off.data.message, /belum aktif/i);
      assert.equal((await request("/public/info", "GET")).data.payment.enabled, false);
    });

    await t.test("Snap yang gagal tidak meninggalkan slot tertahan", async () => {
      assert.equal((await request("/operations/payments/settings", "PUT", settings(), admin)).status, 200);
      snapReply = { status: 401, body: { error_messages: ["Access denied due to unauthorized transaction"] } };
      const failed = await request("/public/checkout", "POST", checkout({ start_time: "06:00", end_time: "07:00" }));
      assert.equal(failed.status, 502);
      const open = await request(`/public/availability?date=${tomorrow}`, "GET");
      const slots = open.data.courts.find((entry: { court: { id: string } }) => entry.court.id === courtId).slots;
      assert.equal(slots.find((slot: { start: string }) => slot.start === "06:00").state, "available", "slot dilepas kembali saat halaman pembayaran gagal dibuat");
      snapReply = { status: 201, body: { token: "tok-uji", redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-uji" } };
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + "padelix-pay-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
