import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-counter-midtrans-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("counter_midtrans");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";

const serverKey = "SB-Mid-server-kasir123";
const signature = (orderId: string, statusCode: string, grossAmount: string) =>
  createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");

/** Midtrans diganti stub: tidak ada permintaan jaringan selama uji. */
const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
let snapReply: { status: number; body: unknown } = { status: 201, body: { token: "tok-kasir", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-kasir" } };
let statusReply: { status: number; body: unknown } = { status: 404, body: { status_code: "404", status_message: "Transaction doesn't exist." } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (!url.includes("midtrans.com")) return realFetch(input, init);
  calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} });
  const reply = url.includes("/snap/v1/transactions") ? snapReply : statusReply;
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("kasir: bayar lewat Midtrans, pelanggan dari riwayat, dan tautan ke booking", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const notify = (orderId: string, amount: number, status = "settlement", overrides = {}) => ({
    order_id: orderId, status_code: "200", gross_amount: `${amount}.00`, signature_key: signature(orderId, "200", `${amount}.00`),
    transaction_status: status, fraud_status: "accept", transaction_id: `trx-${orderId}`, payment_type: "qris", ...overrides,
  });
  const stockOf = async (id: string) => (await db.prepare("SELECT stock FROM addons WHERE id=?").get(id) as { stock: number }).stock;
  const journal = async (ref: string) => await db.prepare("SELECT l.debit,l.credit,a.system_key FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE e.source='kasir' AND e.ref_id=?").all(ref) as { debit: number; credit: number; system_key: string | null }[];
  const today = localClock().date;
  let admin = "", staff = "", bola = "", raket = "", courtId = "", bookingId = "";

  try {
    await t.test("penyiapan: katalog, lapangan, booking hari ini", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Kasir", email: "admin@kasirmid.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir Sore", email: "kasir@kasirmid.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@kasirmid.test", password: "StrongPass123" })).cookie;
      bola = (await request("/operations/addons", "POST", { name: "Bola padel", category: "bola", type: "jual", pricing: "per_booking", price: 60000, stock: 5, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin)).data.addon.id;
      raket = (await request("/operations/addons", "POST", { name: "Sewa raket", category: "raket", type: "sewa", pricing: "per_booking", price: 40000, stock: 3, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin)).data.addon.id;
      const court = await request("/operations/courts", "POST", { name: "Court Kasir", hourly_rate: 200000, opens_at: "00:00", closes_at: "24:00", active: true }, admin);
      assert.equal(court.status, 201, JSON.stringify(court.data)); courtId = court.data.court.id;
      // Booking staf (tanpa data pelanggan terdaftar) sepanjang hari, agar selalu "belum selesai" saat test berjalan.
      bookingId = randomUUID();
      await db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,court_total,status,source,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,'confirmed','staff','uji',?)")
        .run(bookingId, courtId, "Rina Booking", "081277770000", today, "00:00", "24:00", 200000, 200000, new Date().toISOString());
    });

    await t.test("Midtrans belum aktif: metode midtrans ditolak dan opsinya tidak tersedia", async () => {
      const options = await request("/operations/counter/options", "GET", undefined, staff);
      assert.equal(options.data.midtrans.enabled, false);
      assert.equal((await request("/operations/counter", "POST", { customer: "Andi", lines: [{ addon_id: bola, quantity: 1 }], method: "midtrans" }, staff)).status, 409);
      const saved = await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-kasir", server_key: serverKey, mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin);
      assert.equal(saved.status, 200);
      const ready = await request("/operations/counter/options", "GET", undefined, staff);
      assert.equal(ready.data.midtrans.enabled, true);
      assert.equal(ready.data.midtrans.client_key, "SB-Mid-client-kasir");
      assert.ok(!JSON.stringify(ready.data).includes(serverKey), "server key tidak pernah dikirim ke browser");
      assert.ok(ready.data.bookings.some((b: { id: string }) => b.id === bookingId), "booking hari ini bisa dipilih");
    });

    let saleId = "", orderId = "", total = 0;
    await t.test("transaksi Midtrans menunggu bayar dan memegang stok", async () => {
      const created = await request("/operations/counter", "POST", { customer: "Andi Baru", phone: "0812 1111 2222", lines: [{ addon_id: bola, quantity: 2 }], method: "midtrans" }, staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      saleId = created.data.sale.id; total = created.data.sale.total;
      assert.equal(created.data.sale.status, "pending");
      assert.equal(created.data.sale.method, "midtrans");
      assert.equal(created.data.sale.pay_url, "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-kasir");
      assert.equal(created.data.sale.snap_token, "tok-kasir");
      orderId = created.data.sale.pay_order_id;
      assert.match(orderId, /^KSR-\d{4}-00001-/);
      const snap = calls.find(call => call.url.includes("/snap/v1/transactions"))!;
      assert.equal((snap.body.transaction_details as { gross_amount: number }).gross_amount, 120000);
      assert.equal((snap.body.item_details as { price: number; quantity: number }[]).reduce((sum, item) => sum + item.price * item.quantity, 0), 120000);
      assert.equal(await stockOf(bola), 3, "stok dipegang selama menunggu bayar");
      assert.equal((await journal(saleId)).length, 0, "belum ada jurnal sebelum lunas");
      const list = await request("/operations/counter", "GET", undefined, staff);
      assert.equal(list.data.summary.count, 0, "belum dihitung sebagai penjualan");
      assert.equal(list.data.summary.pending, 1);
      // Pelanggan baru dengan nomor telepon tersimpan di daftar pelanggan.
      const customer = await db.prepare("SELECT id,name FROM customers WHERE phone='6281211112222'").get() as { id: string; name: string };
      assert.equal(customer.name, "Andi Baru");
      assert.equal(created.data.sale.customer_id, customer.id);
      // Periksa status: Midtrans belum mengenal ordernya (pelanggan belum memilih metode).
      const refreshed = await request(`/operations/counter/${saleId}/refresh`, "POST", {}, staff);
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.data.sale.status, "pending");
    });

    await t.test("webhook: tanda tangan dan nominal diperiksa, lalu lunas dan dijurnal bersih potongan", async () => {
      await request("/operations/finance/settings", "GET", undefined, admin);
      assert.equal((await request("/public/payments/midtrans/notification", "POST", { ...notify(orderId, total), signature_key: "palsu" })).status, 403);
      assert.equal((await request("/public/payments/midtrans/notification", "POST", notify(orderId, 1000))).status, 409);
      const settled = await request("/public/payments/midtrans/notification", "POST", notify(orderId, total));
      assert.equal(settled.status, 200, JSON.stringify(settled.data));
      const detail = (await request(`/operations/counter/${saleId}`, "GET", undefined, staff)).data;
      assert.equal(detail.sale.status, "paid");
      assert.equal(detail.sale.method, "qris");
      assert.equal(detail.sale.pay_url, null, "tautan bayar tidak dikirim lagi setelah lunas");
      assert.ok(detail.sale.paid_at);
      const lines = await journal(saleId);
      const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0), credit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
      assert.equal(debit, credit, "jurnal seimbang");
      assert.equal(credit, total);
      // Webhook ganda tidak menggandakan apa pun.
      await request("/public/payments/midtrans/notification", "POST", notify(orderId, total));
      assert.equal((await journal(saleId)).length, lines.length);
      assert.equal(await stockOf(bola), 3);
      const list = await request("/operations/counter", "GET", undefined, staff);
      assert.equal(list.data.summary.count, 1);
      assert.equal(list.data.summary.by_method.qris, total);
      assert.equal((await request("/dashboard/summary", "GET", undefined, admin)).data.revenueToday, total);
    });

    await t.test("kedaluwarsa dari Midtrans melepas stok; dibatalkan kasir menghentikan transaksinya", async () => {
      const created = await request("/operations/counter", "POST", { customer: "Tono", lines: [{ addon_id: bola, quantity: 1 }, { addon_id: raket, quantity: 1 }], method: "midtrans" }, staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.equal(await stockOf(bola), 2);
      const options = await request("/operations/counter/options", "GET", undefined, staff);
      assert.equal(options.data.addons.find((a: { id: string }) => a.id === raket).available, 2, "raket dipegang selama menunggu bayar");
      await request("/public/payments/midtrans/notification", "POST", notify(created.data.sale.pay_order_id, created.data.sale.total, "expire"));
      const expired = (await request(`/operations/counter/${created.data.sale.id}`, "GET", undefined, staff)).data;
      assert.equal(expired.sale.status, "expired");
      assert.equal(await stockOf(bola), 3, "stok kembali");
      assert.equal((await request("/operations/counter/options", "GET", undefined, staff)).data.addons.find((a: { id: string }) => a.id === raket).available, 3);
      assert.equal((await journal(created.data.sale.id)).length, 0);

      const other = await request("/operations/counter", "POST", { lines: [{ addon_id: bola, quantity: 1 }], method: "midtrans" }, staff);
      const before = calls.length;
      const voided = await request(`/operations/counter/${other.data.sale.id}/void`, "POST", { reason: "Pelanggan bayar tunai saja" }, staff);
      assert.equal(voided.status, 200, JSON.stringify(voided.data));
      assert.equal(voided.data.sale.status, "void");
      assert.ok(calls.slice(before).some(call => call.url.endsWith("/expire")), "transaksi di Midtrans ikut dihentikan");
      assert.equal(await stockOf(bola), 3);
      // Uang yang tetap masuk setelah dibatalkan dicatat lunas dengan catatan untuk kasir.
      await request("/public/payments/midtrans/notification", "POST", notify(other.data.sale.pay_order_id, other.data.sale.total));
      const late = (await request(`/operations/counter/${other.data.sale.id}`, "GET", undefined, staff)).data;
      assert.equal(late.sale.status, "paid");
      assert.match(late.sale.notes, /setelah transaksi dibatalkan/);
      assert.equal(await stockOf(bola), 2);
    });

    await t.test("halaman bayar gagal dibuat: transaksi tidak tertahan", async () => {
      snapReply = { status: 401, body: { error_messages: ["Access denied"] } };
      const failed = await request("/operations/counter", "POST", { lines: [{ addon_id: bola, quantity: 1 }], method: "midtrans" }, staff);
      assert.equal(failed.status, 502);
      assert.equal(await stockOf(bola), 2, "stok dikembalikan");
      snapReply = { status: 201, body: { token: "tok-kasir", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-kasir" } };
    });

    await t.test("rekomendasi pelanggan dari riwayat dan booking hari ini", async () => {
      const empty = await request("/operations/counter/customers", "GET", undefined, staff);
      assert.equal(empty.status, 200);
      assert.equal(empty.data.customers[0].name, "Rina Booking", "pemesan lapangan hari ini paling atas");
      assert.equal(empty.data.customers[0].booking.id, bookingId);
      const andi = await request("/operations/counter/customers?q=andi", "GET", undefined, staff);
      assert.equal(andi.data.customers.length, 1);
      assert.equal(andi.data.customers[0].phone, "081211112222");
      assert.ok(andi.data.customers[0].customer_id);
      const byPhone = await request("/operations/counter/customers?q=0812 1111", "GET", undefined, staff);
      assert.equal(byPhone.data.customers[0].name, "Andi Baru");
      const tono = await request("/operations/counter/customers?q=ton", "GET", undefined, staff);
      assert.equal(tono.data.customers.length, 0, "transaksi yang tidak jadi dibayar bukan riwayat");
      assert.equal((await request("/operations/counter/customers?q=tidakada", "GET", undefined, staff)).data.customers.length, 0);
    });

    await t.test("transaksi dihubungkan ke booking: jam sewa ikut booking dan tampil di detail booking", async () => {
      assert.equal((await request("/operations/counter", "POST", { booking_id: "tidak-ada", lines: [{ addon_id: bola, quantity: 1 }], method: "cash" }, staff)).status, 404);
      const options = await request(`/operations/counter/options?booking_id=${bookingId}`, "GET", undefined, staff);
      assert.deepEqual(options.data.window, { date: today, start: "00:00", end: "24:00" });
      const linked = await request("/operations/counter", "POST", { booking_id: bookingId, lines: [{ addon_id: raket, quantity: 2 }], method: "cash" }, staff);
      assert.equal(linked.status, 201, JSON.stringify(linked.data));
      assert.equal(linked.data.sale.customer, "Rina Booking", "nama pemesan dipakai bila kosong");
      assert.equal(linked.data.sale.phone, "081277770000");
      assert.equal(linked.data.sale.start_time, "00:00");
      assert.equal(linked.data.sale.end_time, "24:00");
      assert.equal(linked.data.booking.id, bookingId);
      assert.equal(linked.data.booking.court_name, "Court Kasir");
      const booking = await request(`/operations/bookings/${bookingId}`, "GET", undefined, staff);
      assert.equal(booking.data.sales.length, 1);
      assert.equal(booking.data.sales[0].number, linked.data.sale.number);
      assert.equal(Number(booking.data.sales[0].open_rentals), 1);
      const unreturned = (await request("/operations/rentals/unreturned", "GET", undefined, staff)).data.unreturned;
      assert.equal(unreturned.find((row: { ref_id: string }) => row.ref_id === linked.data.sale.id).court_name, "Court Kasir");
      const list = await request("/operations/counter?q=rina", "GET", undefined, staff);
      assert.equal(list.data.sales[0].booking_court, "Court Kasir");
      // Pelanggan terdaftar dipilih dari riwayat.
      const andi = (await request("/operations/counter/customers?q=andi", "GET", undefined, staff)).data.customers[0];
      const repeat = await request("/operations/counter", "POST", { customer_id: andi.customer_id, lines: [{ addon_id: bola, quantity: 1 }], method: "cash" }, staff);
      assert.equal(repeat.status, 201, JSON.stringify(repeat.data));
      assert.equal(repeat.data.sale.customer, "Andi Baru");
      assert.equal(repeat.data.sale.phone, "081211112222");
      assert.equal(Number((await db.prepare("SELECT count(*) n FROM customers WHERE phone='6281211112222'").get() as { n: number }).n), 1);
      assert.equal((await request("/operations/counter/customers?q=andi", "GET", undefined, staff)).data.customers[0].visits, 2);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
