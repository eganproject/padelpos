import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-inventory-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("inventory");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("kunci pembukuan, harga pokok barang jual, dan tutup kasir", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const today = localClock().date;
  const shift = (days: number) => { const value = new Date(today + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) };
  const tomorrow = shift(1);
  const account = async (key: string) => (await db.prepare("SELECT id FROM accounts WHERE system_key=?").get(key) as { id: string }).id;
  /** Saldo akun (debit − kredit) dari seluruh jurnal. */
  const saldo = async (key: string) => Number((await db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.system_key=?").get(key) as { n: number }).n);
  const lock = async (until: string) => {
    const setup = (await request("/operations/finance/setup", "GET", undefined, admin)).data.settings;
    const saved = await request("/operations/finance/settings", "PUT", { cash_accounts: setup.cash_accounts, default_cash_account: setup.default_cash_account, locked_until: until }, admin);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
  };
  let admin = "", staff = "", courtId = "", bola = "", bookingId = "", saleId = "";

  try {
    await t.test("penyiapan", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Stok", email: "admin@stok.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir Sore", email: "kasir@stok.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@stok.test", password: "StrongPass123" })).cookie;
      courtId = (await request("/operations/courts", "POST", { name: "Court Stok", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin)).data.court.id;
      for (const key of ["persediaan", "hpp", "selisih_persediaan", "selisih_kas"]) assert.ok(await account(key), key);
      assert.equal((await db.prepare("SELECT code FROM accounts WHERE system_key='persediaan'").get() as { code: string }).code, "1-400", "akun bawaan 1-400 dipakai sebagai persediaan");
    });

    await t.test("A: booking di periode terkunci tidak bisa diubah sampai kuncinya dibuka", async () => {
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Rina", phone: "081200000001", date: tomorrow, start_time: "09:00", end_time: "10:00", notes: "" }, admin);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bookingId = created.data.booking.id;
      await lock(tomorrow);
      const cancelled = await request(`/operations/bookings/${bookingId}/status`, "PATCH", { status: "cancelled", reason: "Hujan deras" }, admin);
      assert.equal(cancelled.status, 409);
      assert.match(cancelled.data.message, /dikunci/);
      assert.equal((await request(`/operations/bookings/${bookingId}/discount`, "PUT", { amount: 20000, note: "Langganan" }, admin)).status, 409);
      assert.equal((await db.prepare("SELECT status FROM bookings WHERE id=?").get(bookingId) as { status: string }).status, "confirmed", "pembatalan dibatalkan seluruhnya");
      assert.equal(await saldo("pendapatan_lapangan"), -200000, "pendapatan periode terkunci tidak berubah");
      await lock("");
      assert.equal((await request(`/operations/bookings/${bookingId}/discount`, "PUT", { amount: 20000, note: "Langganan" }, admin)).status, 200);
    });

    await t.test("B: saldo awal persediaan dan pembelian restok", async () => {
      const created = await request("/operations/addons", "POST", { name: "Bola padel", category: "bola", type: "jual", pricing: "per_booking", price: 60000, cost: 30000, stock: 10, low_stock: 0, max_per_booking: 10, description: "", active: true, online: true }, admin);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bola = created.data.addon.id;
      assert.equal(created.data.addon.cost, 30000);
      assert.equal(await saldo("persediaan"), 300000, "10 × 30.000 sebagai saldo awal");
      assert.equal(await saldo("modal"), -300000);

      assert.equal((await request(`/operations/addons/${bola}/stock`, "POST", { reason: "restok", quantity: 10, purchase: { unit_cost: 36000, settle: "tempo" } }, admin)).status, 400, "pembelian tempo butuh pemasok");
      const kas = await account("kas");
      const restock = await request(`/operations/addons/${bola}/stock`, "POST", { reason: "restok", quantity: 10, note: "Toko Olahraga", purchase: { unit_cost: 36000, settle: "tunai", cash_account_id: kas } }, admin);
      assert.equal(restock.status, 201, JSON.stringify(restock.data));
      assert.equal(restock.data.addon.cost, 33000, "harga beli rata-rata (10 × 30.000 + 10 × 36.000) / 20");
      assert.equal(restock.data.addon.stock, 20);
      assert.match(restock.data.moves[0].record_number, /^BY-/, "pembelian tercatat sebagai pengeluaran");
      assert.equal(await saldo("persediaan"), 660000);
      assert.equal(await saldo("kas"), -360000);
    });

    await t.test("B: penjualan mencatat harga pokok, pembatalan mengembalikannya", async () => {
      const sale = await request("/operations/counter", "POST", { id: randomUUID(), customer: "Andi", lines: [{ addon_id: bola, quantity: 4 }], method: "cash", tendered: 240000 }, staff);
      assert.equal(sale.status, 201, JSON.stringify(sale.data));
      saleId = sale.data.sale.id;
      assert.equal(await saldo("hpp"), 4 * 33000);
      assert.equal(await saldo("persediaan"), 660000 - 4 * 33000);

      const lines = await request(`/operations/bookings/${bookingId}/addons`, "PUT", { lines: [{ addon_id: bola, quantity: 2 }] }, admin);
      assert.equal(lines.status, 200, JSON.stringify(lines.data));
      assert.equal(await saldo("hpp"), 6 * 33000, "booking dengan bola ikut mencatat harga pokok");

      const voided = await request(`/operations/counter/${saleId}/void`, "POST", { reason: "Salah input" }, staff);
      assert.equal(voided.status, 200, JSON.stringify(voided.data));
      assert.equal(await saldo("hpp"), 2 * 33000);
      assert.equal(await saldo("persediaan"), 660000 - 2 * 33000, "nilai persediaan sama dengan stok × harga beli");
      assert.equal((await db.prepare("SELECT stock FROM addons WHERE id=?").get(bola) as { stock: number }).stock, 18);
    });

    await t.test("B: barang rusak dan hitung ulang menjadi selisih persediaan", async () => {
      assert.equal((await request(`/operations/addons/${bola}/stock`, "POST", { reason: "rusak", quantity: 1, note: "Bocor" }, admin)).status, 201);
      assert.equal(await saldo("selisih_persediaan"), 33000);
      assert.equal((await request(`/operations/addons/${bola}/stock`, "POST", { reason: "koreksi", quantity: 18, note: "Hitung fisik" }, admin)).status, 201);
      assert.equal(await saldo("selisih_persediaan"), 0, "stok bertambah 1 mengurangi selisih");
      assert.equal(await saldo("persediaan"), 18 * 33000);
      const sheet = (await request(`/operations/finance/reports/neraca?as_of=${tomorrow}`, "GET", undefined, admin)).data;
      assert.equal(sheet.difference, 0, "neraca tetap seimbang");
    });

    await t.test("C: buka shift, rekap transaksi, dan tutup dengan selisih", async () => {
      const opened = await request("/operations/shifts", "POST", { opening_cash: 200000 }, staff);
      assert.equal(opened.status, 201, JSON.stringify(opened.data));
      assert.match(opened.data.number, /^TK-\d{4}-00001$/);
      assert.equal((await request("/operations/shifts", "POST", { opening_cash: 0 }, staff)).status, 409, "satu shift terbuka per staf");

      assert.equal((await request("/operations/counter", "POST", { customer: "Budi", lines: [{ addon_id: bola, quantity: 1 }], method: "cash" }, staff)).status, 201);
      assert.equal((await request("/operations/counter", "POST", { customer: "Citra", lines: [{ addon_id: bola, quantity: 1 }], method: "qris" }, staff)).status, 201);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", { id: randomUUID(), amount: 100000, kind: "payment", method: "cash" }, staff)).status, 201);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", { id: randomUUID(), amount: 50000, kind: "payment", method: "cash" }, admin)).status, 201, "pembayaran staf lain tidak masuk shift ini");

      const live = (await request("/operations/shifts", "GET", undefined, staff)).data.current;
      assert.equal(live.expected_cash, 200000 + 60000 + 100000);
      assert.equal(live.summary.methods.find((row: { method: string }) => row.method === "qris").net, 60000);
      assert.equal(live.summary.sources.kasir, 120000);
      assert.equal(live.summary.sources.booking, 100000);

      assert.equal((await request(`/operations/shifts/${live.id}/close`, "POST", { counted_cash: 355000 }, staff)).status, 400, "selisih wajib diberi catatan");
      const closed = await request(`/operations/shifts/${live.id}/close`, "POST", { counted_cash: 355000, note: "Kembalian salah" }, staff);
      assert.equal(closed.status, 200, JSON.stringify(closed.data));
      assert.equal(closed.data.difference, -5000);
      assert.equal(await saldo("selisih_kas"), 5000, "kurang kas dijurnal ke Selisih Kas");
      assert.equal((await request(`/operations/shifts/${live.id}/close`, "POST", { counted_cash: 0 }, staff)).status, 409);
      assert.equal((await request("/operations/shifts", "GET", undefined, staff)).data.current, null);

      // Transaksi setelah shift ditutup tidak mengubah rekap yang sudah dibekukan.
      assert.equal((await request("/operations/counter", "POST", { customer: "Dodi", lines: [{ addon_id: bola, quantity: 1 }], method: "cash" }, staff)).status, 201);
      assert.equal((await request(`/operations/shifts/${live.id}`, "GET", undefined, staff)).data.expected_cash, 360000);
      const receipt = await request(`/operations/shifts/${live.id}/receipt`, "GET", undefined, staff);
      assert.equal(receipt.status, 200);
      assert.equal(receipt.data.shift.number, live.number);
    });

    await t.test("C: shift staf lain hanya terlihat oleh Super Admin", async () => {
      const own = await request("/operations/shifts", "POST", { opening_cash: 0 }, admin);
      assert.equal(own.status, 201);
      assert.equal((await request(`/operations/shifts/${own.data.id}`, "GET", undefined, staff)).status, 403);
      assert.equal((await request(`/operations/shifts/${own.data.id}/close`, "POST", { counted_cash: 0 }, staff)).status, 403);
      const list = (await request("/operations/shifts", "GET", undefined, admin)).data;
      assert.equal(list.all_staff, true);
      assert.equal(list.shifts.length, 2);
      assert.equal((await request("/operations/shifts", "GET", undefined, staff)).data.shifts.length, 1);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
