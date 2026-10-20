import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-counter-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("counter");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock, minutes, clockLabel } = await import("../src/operations.js");

test("transaksi kasir tanpa booking: sewa dan jual langsung", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const item = (overrides: Record<string, unknown>) => ({ name: "Item", category: "lainnya", type: "sewa", pricing: "per_booking", price: 25000, stock: 2, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true, ...overrides });
  const stockOf = async (id: string) => (await db.prepare("SELECT stock FROM addons WHERE id=?").get(id) as { stock: number }).stock;
  const journal = async (ref: string) => await db.prepare("SELECT l.debit,l.credit,a.system_key FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id WHERE e.source='kasir' AND e.ref_id=?").all(ref) as { debit: number; credit: number; system_key: string | null }[];
  let admin = "", staff = "", raket = "", bola = "", pelatih = "", saleId = "";

  try {
    await t.test("penyiapan katalog", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Kasir", email: "admin@kasir.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir Pagi", email: "kasir@kasir.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@kasir.test", password: "StrongPass123" })).cookie;
      raket = (await request("/operations/addons", "POST", item({ name: "Sewa raket", category: "raket", pricing: "per_hour", price: 30000 }), admin)).data.addon.id;
      bola = (await request("/operations/addons", "POST", item({ name: "Bola padel", category: "bola", type: "jual", price: 60000, stock: 5 }), admin)).data.addon.id;
      pelatih = (await request("/operations/addons", "POST", item({ name: "Pelatih", category: "pelatih", type: "layanan", stock: null, price: 150000, online: false }), admin)).data.addon.id;
    });

    await t.test("pilihan barang memuat item khusus kasir dan sisa stok", async () => {
      assert.equal((await request("/operations/counter/options")).status, 401);
      const options = await request("/operations/counter/options?duration=90", "GET", undefined, staff);
      assert.equal(options.status, 200, JSON.stringify(options.data));
      const ids = options.data.addons.map((a: { id: string }) => a.id);
      assert.ok(ids.includes(pelatih), "item khusus kasir ikut tampil");
      assert.equal(options.data.addons.find((a: { id: string }) => a.id === raket).available, 2);
      assert.equal(options.data.window.date, localClock().date);
    });

    await t.test("validasi transaksi", async () => {
      const lines = [{ addon_id: raket, quantity: 1 }];
      assert.equal((await request("/operations/counter", "POST", { lines, method: "cash", duration: 60 }, staff)).status, 400, "barang sewa butuh nama penyewa");
      assert.equal((await request("/operations/counter", "POST", { customer: "Andi", lines: [{ addon_id: raket, quantity: 3 }], method: "cash" }, staff)).status, 409, "stok raket hanya 2");
      assert.equal((await request("/operations/counter", "POST", { customer: "Andi", lines: [], method: "cash" }, staff)).status, 400);
      assert.equal((await request("/operations/counter", "POST", { customer: "Andi", lines, method: "cash", tendered: 1000 }, staff)).status, 400, "uang kurang");
      assert.equal((await request("/operations/counter", "POST", { customer: "Andi", lines, method: "cash", discount: 5000 }, staff)).status, 400, "potongan perlu alasan");
      assert.equal((await request("/operations/counter", "POST", { customer: "Andi", lines, method: "va" }, staff)).status, 400, "hanya tunai, transfer, QRIS");
    });

    await t.test("sewa raket 2 jam dan beli bola, dibayar tunai", async () => {
      const id = randomUUID();
      const body = { id, customer: "Andi", phone: "081200001111", duration: 120, lines: [{ addon_id: raket, quantity: 2 }, { addon_id: bola, quantity: 2 }], method: "cash", tendered: 300000 };
      const created = await request("/operations/counter", "POST", body, staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      saleId = created.data.sale.id;
      assert.equal(saleId, id);
      assert.match(created.data.sale.number, /^KSR-\d{4}-00001$/);
      // 2 raket × 30.000 × 2 jam (bisa terpotong di 24:00) + 2 bola × 60.000
      const hours = (minutes(created.data.sale.end_time) - minutes(created.data.sale.start_time)) / 60;
      assert.equal(created.data.sale.total, 2 * 30000 * hours + 120000);
      assert.equal(created.data.sale.status, "paid");
      assert.equal(created.data.lines.length, 2);
      assert.equal(await stockOf(bola), 3, "stok bola terpotong");
      const again = await request("/operations/counter", "POST", body, staff);
      assert.equal(again.data.sale.id, id, "klik ganda tidak membuat transaksi kedua");
      assert.equal(await stockOf(bola), 3);
      assert.equal(Number((await db.prepare("SELECT count(*) n FROM counter_sales").get() as { n: number }).n), 1);

      const lines = await journal(saleId);
      const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0), credit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
      assert.equal(debit, credit, "jurnal seimbang");
      assert.equal(Number(lines.find(l => l.system_key === "kas")!.debit), created.data.sale.total, "tunai masuk kas");
      assert.equal(Number(lines.find(l => l.system_key === "pendapatan_barang")!.credit), 120000);
      assert.equal(Number(lines.find(l => l.system_key === "pendapatan_sewa")!.credit), 2 * 30000 * hours);
    });

    await t.test("raket yang dipegang transaksi kasir mengurangi stok booking dan muncul di belum kembali", async () => {
      const options = await request("/operations/counter/options?duration=60", "GET", undefined, staff);
      assert.equal(options.data.addons.find((a: { id: string }) => a.id === raket).available, 0);
      const now = localClock(), next = Math.floor(minutes(now.time) / 30) * 30 + 30;
      if (next <= 23 * 60) {
        const booking = await request(`/operations/addons/options?date=${now.date}&start=${clockLabel(next)}&end=${clockLabel(next + 30)}`, "GET", undefined, staff);
        assert.equal(booking.data.addons.find((a: { id: string }) => a.id === raket).available, 0, "booking lapangan pada jam yang sama tidak bisa memakai raket itu");
      }
      assert.equal((await request("/operations/counter", "POST", { customer: "Budi", lines: [{ addon_id: raket, quantity: 1 }], method: "qris" }, staff)).status, 409);
      const out = await request("/operations/rentals/unreturned", "GET", undefined, staff);
      assert.equal(out.status, 200);
      const row = out.data.unreturned.find((l: { ref_id: string }) => l.ref_id === saleId);
      assert.equal(row.source, "kasir");
      assert.equal(row.quantity, 2);
      assert.equal(row.customer, "Andi");
      assert.equal((await request("/dashboard/summary", "GET", undefined, admin)).data.addons.unreturned, 2);
    });

    await t.test("raket ditandai kembali melepas unit", async () => {
      const line = (await request(`/operations/counter/${saleId}`, "GET", undefined, staff)).data.lines.find((l: { addon_id: string }) => l.addon_id === raket);
      assert.equal((await request(`/operations/counter/${saleId}/returned`, "PATCH", { line_ids: [(await request(`/operations/counter/${saleId}`, "GET", undefined, staff)).data.lines.find((l: { addon_id: string }) => l.addon_id === bola).id], returned: true }, staff)).status, 400, "bola bukan barang sewa");
      const returned = await request(`/operations/counter/${saleId}/returned`, "PATCH", { line_ids: [line.id], returned: true }, staff);
      assert.equal(returned.status, 200, JSON.stringify(returned.data));
      assert.ok(returned.data.lines.find((l: { id: string }) => l.id === line.id).returned_at);
      assert.ok(!(await request("/operations/rentals/unreturned", "GET", undefined, staff)).data.unreturned.some((l: { ref_id: string }) => l.ref_id === saleId));
      assert.equal((await request("/operations/counter/options?duration=60", "GET", undefined, staff)).data.addons.find((a: { id: string }) => a.id === raket).available, 2);
    });

    await t.test("daftar, nota, dan ringkasan pendapatan tambahan", async () => {
      const second = await request("/operations/counter", "POST", { lines: [{ addon_id: pelatih, quantity: 1 }, { name: "Air mineral", unit_price: 5000, quantity: 2 }], method: "transfer" }, staff);
      assert.equal(second.status, 201, JSON.stringify(second.data));
      assert.equal(second.data.sale.customer, "Pelanggan umum");
      assert.equal(second.data.sale.total, 160000);
      assert.equal(second.data.sale.tendered, null);
      const list = await request("/operations/counter", "GET", undefined, staff);
      assert.equal(list.data.sales.length, 2);
      assert.equal(list.data.summary.count, 2);
      assert.equal(list.data.summary.by_method.transfer, 160000);
      assert.equal((await request("/operations/counter?q=andi", "GET", undefined, staff)).data.sales.length, 1);
      const receipt = await request(`/operations/counter/${saleId}/receipt`, "GET", undefined, staff);
      assert.equal(receipt.status, 200);
      assert.equal(receipt.data.sale.customer, "Andi");
      assert.equal(receipt.data.lines.length, 2);
      assert.equal(receipt.data.cashier, "Kasir Pagi");
      const summary = (await request("/operations/addons", "GET", undefined, admin)).data.summary;
      assert.equal(summary.unreturned, undefined, "daftar belum kembali pindah ke halaman Booking");
      assert.ok(summary.today >= 160000 + 120000, "pendapatan tambahan termasuk transaksi kasir");
      assert.ok(summary.top.some((t: { name: string }) => t.name === "Pelatih"));
      assert.equal((await request(`/operations/addons/${pelatih}`, "DELETE", undefined, admin)).status, 409, "item yang pernah dijual di kasir tidak dapat dihapus");
    });

    await t.test("pembatalan mengembalikan stok dan membuat jurnal balik", async () => {
      assert.equal((await request(`/operations/counter/${saleId}/void`, "POST", { reason: "" }, staff)).status, 400);
      const voided = await request(`/operations/counter/${saleId}/void`, "POST", { reason: "Salah input" }, staff);
      assert.equal(voided.status, 200, JSON.stringify(voided.data));
      assert.equal(voided.data.sale.status, "void");
      assert.equal(await stockOf(bola), 5);
      const reversal = await journal(`${saleId}:batal`);
      assert.equal(Number(reversal.find(l => l.system_key === "kas")!.credit), voided.data.sale.total);
      assert.equal((await request(`/operations/counter/${saleId}/void`, "POST", { reason: "Lagi" }, staff)).status, 409);
      assert.equal((await request("/operations/counter", "GET", undefined, staff)).data.summary.count, 1);
      const moves = (await request(`/operations/addons/${bola}/stock`, "GET", undefined, admin)).data.moves as { reason: string; sale_number: string | null }[];
      assert.ok(moves.some(m => m.reason === "kembali" && m.sale_number), "riwayat stok menyebut nomor transaksi kasir");
      assert.equal((await request("/dashboard/summary", "GET", undefined, admin)).data.revenueToday, 160000, "penerimaan hari ini: transaksi lunas, tanpa yang dibatalkan");
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
