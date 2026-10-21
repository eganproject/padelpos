import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-voucher-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("vouchers");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.MIDTRANS_CLIENT_KEY;

const serverKey = "SB-Mid-server-voucher123";
const signature = (orderId: string, statusCode: string, grossAmount: string) =>
  createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");
/** Midtrans diganti stub: tidak ada permintaan jaringan selama uji. */
const snaps: { transaction_details: { order_id: string; gross_amount: number }; item_details: { id: string; price: number; quantity: number; name: string }[] }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (!url.includes("midtrans.com")) return realFetch(input, init);
  if (url.includes("/snap/v1/transactions")) {
    snaps.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ token: `tok-${snaps.length}`, redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-${snaps.length}` }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ status_code: "404" }), { status: 404, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock, shiftDate } = await import("../src/clock.js");

test("voucher & kode promo: kelola, checkout online, kasir, kuota, dan pembukuan", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const today = localClock().date, tomorrow = shiftDate(today, 1);
  let admin = "", staff = "", courtId = "", racketId = "", ballId = "";
  async function balance(key: string) {
    const row = await db.prepare(`SELECT a.type,
        (SELECT COALESCE(SUM(l.debit),0) FROM journal_lines l WHERE l.account_id=a.id) debit,
        (SELECT COALESCE(SUM(l.credit),0) FROM journal_lines l WHERE l.account_id=a.id) credit
      FROM accounts a WHERE a.system_key=?`).get(key) as { type: string; debit: number; credit: number };
    return row.type === "aset" || row.type === "beban" ? Number(row.debit) - Number(row.credit) : Number(row.credit) - Number(row.debit);
  }
  const voucher = (code: string, extra: Record<string, unknown> = {}) => ({ code, name: `Promo ${code}`, kind: "percent", value: 1000, starts_on: today, ...extra });
  const item = (start: string, end: string, addons: { addon_id: string; quantity: number }[] = []) => ({ court_id: courtId, date: tomorrow, start_time: start, end_time: end, addons });
  const checkout = (items: unknown[], code: string, phone = "081311112222") => request("/public/checkout", "POST", { items, customer: "Sari Promo", phone, email: "", notes: "", voucher_code: code });
  const webhook = (orderId: string, amount: number) => ({
    order_id: orderId, status_code: "200", gross_amount: `${amount}.00`, signature_key: signature(orderId, "200", `${amount}.00`),
    transaction_status: "settlement", fraud_status: "accept", transaction_id: `trx-${orderId}`, payment_type: "qris",
  });

  try {
    await t.test("migrasi: menu Voucher untuk admin, akun Potongan Voucher, kasir hanya bisa memeriksa kode", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Promo", email: "admin@promo.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir", email: "kasir@promo.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@promo.test", password: "StrongPass123" })).cookie;
      const account = await db.prepare("SELECT code,name FROM accounts WHERE system_key='potongan_voucher'").get() as { code: string; name: string };
      assert.deepEqual(account, { code: "4-970", name: "Potongan Voucher" });
      const navigation = await request("/auth/navigation", "GET", undefined, admin);
      assert.ok(navigation.data.menus.some((menu: { id: string; path: string }) => menu.id === "vouchers" && menu.path === "/admin/voucher"));
      assert.equal((await request("/operations/vouchers", "GET", undefined, staff)).status, 403);
      assert.equal((await request("/operations/vouchers/check", "POST", { code: "X", extras: 0, subtotal: 1000, cap: 1000 }, staff)).status, 200);

      courtId = (await request("/operations/courts", "POST", { name: "Court Promo", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin)).data.court.id;
      racketId = (await request("/operations/addons", "POST", { name: "Raket promo", category: "raket", type: "sewa", pricing: "per_booking", price: 50000, stock: null, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin)).data.addon.id;
      ballId = (await request("/operations/addons", "POST", { name: "Bola promo", category: "bola", type: "jual", pricing: "per_booking", price: 40000, stock: 50, low_stock: 0, max_per_booking: 10, description: "", active: true, online: true }, admin)).data.addon.id;
      assert.equal((await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-promo", server_key: serverKey, mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin)).status, 200);
    });

    await t.test("kelola voucher: kode huruf besar, unik, persen maksimal 99%, tanggal berurutan", async () => {
      const created = await request("/operations/vouchers", "POST", voucher("hemat10", { max_discount: 30000 }), admin);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.equal(created.data.voucher.code, "HEMAT10");
      assert.equal(created.data.voucher.state, "running");
      assert.equal((await request("/operations/vouchers", "POST", voucher("HEMAT10"), admin)).status, 409);
      assert.equal((await request("/operations/vouchers", "POST", voucher("GRATIS", { value: 10000 }), admin)).status, 400);
      assert.equal((await request("/operations/vouchers", "POST", voucher("ADA SPASI"), admin)).status, 400);
      assert.equal((await request("/operations/vouchers", "POST", voucher("MUNDUR", { starts_on: tomorrow, ends_on: today }), admin)).status, 400);
      const later = await request("/operations/vouchers", "POST", voucher("BESOK", { starts_on: tomorrow }), admin);
      assert.equal(later.data.voucher.state, "scheduled");
    });

    await t.test("keranjang: kode dipratinjau server, alasan tampil bila tidak berlaku", async () => {
      const quote = await request("/public/cart/quote", "POST", { items: [item("08:00", "10:00", [{ addon_id: racketId, quantity: 1 }])], voucher_code: "hemat10" });
      assert.equal(quote.status, 200);
      // 10% dari 450.000 = 45.000, dibatasi 30.000.
      assert.equal(quote.data.voucher.ok, true);
      assert.equal(quote.data.voucher_discount, 30000);
      assert.equal(quote.data.total, 420000);
      const early = await request("/public/cart/quote", "POST", { items: [item("08:00", "10:00")], voucher_code: "BESOK" });
      assert.equal(early.data.voucher.ok, false);
      assert.match(early.data.voucher.message, /baru bisa dipakai mulai/);
      assert.equal(early.data.total, 400000, "kode yang tidak berlaku tidak memotong apa pun");
      const unknown = await request("/public/cart/quote", "POST", { items: [item("08:00", "10:00")], voucher_code: "NGASAL" });
      assert.match(unknown.data.voucher.message, /tidak ditemukan/);
    });

    let firstOrder = "";
    await t.test("checkout online: potongan dibagi per sesi, tercantum di Midtrans, kuota terpakai", async () => {
      assert.equal((await request("/operations/vouchers", "POST", voucher("SEKALI", { kind: "amount", value: 50000, quota: 1, min_order: 300000 }), admin)).status, 201);
      const tooSmall = await checkout([item("08:00", "09:00")], "SEKALI");
      assert.equal(tooSmall.status, 409);
      assert.match(tooSmall.data.message, /minimal Rp300\.000/);

      const result = await checkout([item("08:00", "09:00"), item("12:00", "14:00")], "sekali");
      assert.equal(result.status, 201, JSON.stringify(result.data));
      firstOrder = result.data.order_id;
      const sessions = await db.prepare("SELECT court_total,voucher_code,voucher_discount,total FROM bookings WHERE order_id=? ORDER BY start_time").all(firstOrder) as { court_total: number; voucher_code: string; voucher_discount: number; total: number }[];
      assert.deepEqual(sessions.map(row => Number(row.voucher_discount)), [16667, 33333], "dibagi menurut harga sesi");
      assert.ok(sessions.every(row => row.voucher_code === "SEKALI"));
      assert.equal(result.data.total, 550000);
      const snap = snaps.at(-1)!;
      assert.equal(snap.transaction_details.gross_amount, 550000);
      assert.equal(snap.item_details.reduce((sum, line) => sum + line.price * line.quantity, 0), 550000);
      assert.ok(snap.item_details.some(line => line.name === "Voucher SEKALI" && line.price < 0));

      const again = await checkout([item("16:00", "18:00")], "SEKALI", "081399998888");
      assert.equal(again.status, 409);
      assert.match(again.data.message, /Kuota voucher SEKALI sudah habis/);
      assert.equal((await db.prepare("SELECT count(*) n FROM bookings WHERE start_time='16:00'").get() as { n: number }).n, 0, "gagal voucher berarti tidak ada slot yang terkunci");
    });

    await t.test("pesanan kedaluwarsa melepas kuota; pesanan lunas dijurnal ke Potongan Voucher", async () => {
      await db.prepare("UPDATE bookings SET hold_expires_at=UNIX_TIMESTAMP()-5 WHERE order_id=?").run(firstOrder);
      const list = await request("/operations/vouchers", "GET", undefined, admin);
      const sekali = list.data.vouchers.find((row: { code: string }) => row.code === "SEKALI");
      assert.equal(sekali.used, 0, "booking yang tidak dibayar tidak dihitung");

      const paid = await checkout([item("16:00", "18:00")], "SEKALI", "081399998888");
      assert.equal(paid.status, 201, JSON.stringify(paid.data));
      assert.equal((await request("/public/payments/midtrans/notification", "POST", webhook(paid.data.transaction_id, paid.data.amount))).status, 200);
      const row = await db.prepare("SELECT status,total,voucher_discount FROM bookings WHERE order_id=?").get(paid.data.order_id) as { status: string; total: number; voucher_discount: number };
      assert.deepEqual({ ...row, total: Number(row.total), voucher_discount: Number(row.voucher_discount) }, { status: "confirmed", total: 350000, voucher_discount: 50000 });
      assert.equal(await balance("potongan_voucher"), -50000, "potongan mengurangi pendapatan (saldo debit)");
      assert.equal(await balance("pendapatan_lapangan"), 400000, "pendapatan tetap dicatat dengan harga normal");
      const detail = await request(`/operations/vouchers/${sekali.id}`, "GET", undefined, admin);
      assert.equal(detail.data.voucher.used, 1);
      assert.equal(detail.data.voucher.discount_given, 50000);
      assert.deepEqual(detail.data.redemptions.map((r: { live: boolean }) => r.live), [true, false]);
      const order = await request(`/public/orders/${paid.data.order_id}`);
      assert.equal(order.data.order.sessions[0].voucher_code, "SEKALI");
      const pl = await request(`/operations/finance/reports/laba-rugi?from=${today}&to=${tomorrow}`, "GET", undefined, admin);
      assert.ok(JSON.stringify(pl.data).includes("Potongan Voucher"));
      assert.equal((await request(`/operations/vouchers/${sekali.id}`, "DELETE", undefined, admin)).status, 409, "voucher yang sudah dipakai tidak dihapus");
      assert.equal((await request(`/operations/vouchers/${sekali.id}`, "PUT", voucher("SEKALI2", { kind: "amount", value: 50000 }), admin)).status, 409, "kodenya tidak bisa diganti");
    });

    await t.test("batas per pelanggan dikenali dari nomor HP dalam format apa pun", async () => {
      assert.equal((await request("/operations/vouchers", "POST", voucher("PERTAMA", { per_customer: 1, kind: "amount", value: 20000 }), admin)).status, 201);
      assert.equal((await checkout([item("19:00", "20:00")], "PERTAMA", "0812-5555-0001")).status, 201);
      const quote = await request("/public/cart/quote", "POST", { items: [item("21:00", "22:00")], voucher_code: "PERTAMA", phone: "+62 812 5555 0001" });
      assert.equal(quote.data.voucher.ok, false);
      assert.match(quote.data.voucher.message, /sudah pernah dipakai nomor ini/);
      assert.equal((await checkout([item("21:00", "22:00")], "PERTAMA", "6281255550001")).status, 409);
    });

    let bookingId = "";
    await t.test("booking kasir: kode dipakai saat dibuat, dilepas, dan dipasang lagi; kode khusus situs ditolak", async () => {
      assert.equal((await request("/operations/vouchers", "POST", voucher("WEBONLY", { channel: "online" }), admin)).status, 201);
      const rejected = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Andi", phone: "081377770000", date: tomorrow, start_time: "06:00", end_time: "08:00", voucher_code: "WEBONLY" }, staff);
      assert.equal(rejected.status, 409);
      assert.match(rejected.data.message, /hanya berlaku untuk pemesanan lewat situs/);

      assert.equal((await request("/operations/vouchers", "POST", voucher("LAPANGAN", { target: "court", value: 2500 }), admin)).status, 201);
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Andi", phone: "081377770000", date: tomorrow, start_time: "06:00", end_time: "08:00", voucher_code: "lapangan", addons: [{ addon_id: racketId, quantity: 2 }] }, staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bookingId = created.data.booking.id;
      // 25% dari sewa lapangan 400.000 saja; raket tidak ikut.
      assert.equal(created.data.booking.voucher_discount, 100000);
      assert.equal(created.data.booking.total, 400000);
      assert.equal(await balance("potongan_voucher"), -150000);

      const removed = await request(`/operations/bookings/${bookingId}/voucher`, "PUT", { code: null }, staff);
      assert.equal(removed.status, 200);
      assert.equal(removed.data.booking.total, 500000);
      assert.equal(await balance("potongan_voucher"), -50000);
      const reapplied = await request(`/operations/bookings/${bookingId}/voucher`, "PUT", { code: "HEMAT10" }, staff);
      assert.equal(reapplied.data.booking.voucher_discount, 30000);
      assert.equal((await request(`/operations/bookings/${bookingId}/voucher`, "PUT", { code: "LAPANGAN" }, staff)).status, 409, "satu voucher per booking");

      // Potongan voucher tetap walau tambahan berubah.
      const edited = await request(`/operations/bookings/${bookingId}/addons`, "PUT", { lines: [] }, staff);
      assert.equal(edited.data.booking.voucher_discount, 30000);
      assert.equal(edited.data.booking.total, 370000);
      const receipt = await request(`/operations/bookings/${bookingId}/receipt`, "GET", undefined, staff);
      if (receipt.status === 200) assert.equal(receipt.data.booking.voucher_code, "HEMAT10");
    });

    await t.test("transaksi kasir: voucher memotong barang, bukan biaya lain; batal melepas kuota dan membalik jurnal", async () => {
      const courtOnly = await request("/operations/counter", "POST", { lines: [{ addon_id: ballId, quantity: 2 }], method: "cash", voucher_code: "LAPANGAN" }, staff);
      assert.equal(courtOnly.status, 409);
      assert.match(courtOnly.data.message, /hanya untuk sewa lapangan/);

      assert.equal((await request("/operations/vouchers", "POST", voucher("KASIR5K", { kind: "amount", value: 5000, channel: "kasir", quota: 1 }), admin)).status, 201);
      const check = await request("/operations/vouchers/check", "POST", { code: "kasir5k", extras: 80000, subtotal: 90000, cap: 90000 }, staff);
      assert.deepEqual([check.data.voucher.ok, check.data.voucher.amount], [true, 5000]);
      const sale = await request("/operations/counter", "POST", { lines: [{ addon_id: ballId, quantity: 2 }, { name: "Parkir", unit_price: 10000, quantity: 1 }], method: "cash", voucher_code: "KASIR5K" }, staff);
      assert.equal(sale.status, 201, JSON.stringify(sale.data));
      assert.equal(sale.data.sale.voucher_discount, 5000);
      assert.equal(sale.data.sale.total, 85000);
      const before = await balance("potongan_voucher");
      assert.equal((await request("/operations/counter", "POST", { lines: [{ addon_id: ballId, quantity: 1 }], method: "cash", voucher_code: "KASIR5K" }, staff)).status, 409, "kuota 1 sudah dipakai");
      assert.equal((await request(`/operations/counter/${sale.data.sale.id}/void`, "POST", { reason: "Salah input" }, staff)).status, 200);
      assert.equal(await balance("potongan_voucher"), before + 5000, "jurnal balik mengembalikan potongan");
      assert.equal((await request("/operations/counter", "POST", { lines: [{ addon_id: ballId, quantity: 1 }], method: "cash", voucher_code: "KASIR5K" }, staff)).status, 201, "kuota kembali setelah dibatalkan");
    });

    await t.test("sisa tagihan setelah voucher minimal Rp1.000", async () => {
      assert.equal((await request("/operations/vouchers", "POST", voucher("BESAR", { kind: "amount", value: 1000000 }), admin)).status, 201);
      const sale = await request("/operations/counter", "POST", { lines: [{ addon_id: ballId, quantity: 1 }], method: "cash", voucher_code: "BESAR" }, staff);
      assert.equal(sale.status, 201);
      assert.equal(sale.data.sale.total, 1000);
      const neraca = await request(`/operations/finance/reports/neraca?as_of=${tomorrow}`, "GET", undefined, admin);
      assert.equal(neraca.data.difference, 0, "neraca tetap seimbang");
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
