import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-receipt-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("receipt");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db, migrate } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("nota cetak: data nota, pengaturan ukuran kertas, dan menu Nota & Cetak", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const day = (offset: number) => { const value = new Date(localClock().date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  let admin = "", staff = "", bookingId = "";

  try {
    await t.test("penyiapan: admin, operator, venue, lapangan, booking kasir dengan DP", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Nota", email: "admin@nota.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir Sore", email: "kasir@nota.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@nota.test", password: "StrongPass123" })).cookie;
      assert.equal((await request("/operations/content/info", "PUT", { name: "Padel Nota", address: "Jl. Contoh 1", whatsapp: "0812 1111 2222" }, admin)).status, 200);
      const court = await request("/operations/courts", "POST", { name: "Court Nota", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      const created = await request("/operations/bookings", "POST", { court_id: court.data.court.id, customer: "Budi", phone: "081299998888", email: "", date: day(1), start_time: "19:00", end_time: "21:00", notes: "", addons: [] }, staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bookingId = created.data.booking.id;
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", { id: randomUUID(), amount: 150000, kind: "payment", method: "cash", note: "DP" }, staff)).status, 201);
    });

    await t.test("kasir mengambil data nota lengkap dengan pengaturan bawaan", async () => {
      const receipt = await request(`/operations/bookings/${bookingId}/receipt`, "GET", undefined, staff);
      assert.equal(receipt.status, 200, JSON.stringify(receipt.data));
      assert.equal(receipt.data.booking.code, bookingId.slice(0, 8).toUpperCase());
      assert.equal(receipt.data.booking.order_code, null, "booking kasir tidak punya kode pesanan online");
      assert.equal(receipt.data.booking.source, "staff");
      assert.equal(receipt.data.booking.total, 400000);
      assert.equal(receipt.data.booking.paid, 150000);
      assert.equal(receipt.data.payments.length, 1);
      assert.equal(receipt.data.venue.name, "Padel Nota");
      assert.equal(receipt.data.venue.whatsapp, "6281211112222");
      assert.equal(receipt.data.cashier, "Kasir Sore", "nama yang mencetak, bukan pembuat booking");
      assert.equal(receipt.data.settings.paper, "80mm");
      assert.equal((await request("/operations/receipt-settings", "GET", undefined, staff)).data.settings.paper, "80mm", "kasir boleh membaca ukuran bawaan");
      assert.equal((await request(`/operations/bookings/${randomUUID()}/receipt`, "GET", undefined, staff)).status, 404);
      assert.equal((await request(`/operations/bookings/${bookingId}/receipt`)).status, 401);
    });

    await t.test("ukuran bawaan hanya diubah lewat menu Nota & Cetak, dengan validasi", async () => {
      const settings = { paper: "58mm", custom_width: 76, header_note: "NPWP 01.234", footer_note: "Sampai jumpa lagi", show_payments: true, show_cashier: false };
      assert.equal((await request("/operations/receipt-settings", "PUT", settings, staff)).status, 403);
      assert.equal((await request("/operations/receipt-settings", "PUT", { ...settings, paper: "struk" }, admin)).status, 400);
      assert.equal((await request("/operations/receipt-settings", "PUT", { ...settings, paper: "custom", custom_width: 20 }, admin)).status, 400);
      const saved = await request("/operations/receipt-settings", "PUT", settings, admin);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.settings.paper, "58mm");
      assert.ok(saved.data.settings.updated_at);
      const receipt = await request(`/operations/bookings/${bookingId}/receipt`, "GET", undefined, staff);
      assert.equal(receipt.data.settings.paper, "58mm");
      assert.equal(receipt.data.settings.footer_note, "Sampai jumpa lagi");
      const log = await db.prepare("SELECT count(*) n FROM audit_log WHERE action='receipt.settings'").get() as { n: number };
      assert.equal(log.n, 1);
    });

    await t.test("migrasi 3 menambah menu Nota & Cetak ke database lama, hanya untuk Super Admin", async () => {
      const menus = (await request("/access/overview", "GET", undefined, admin)).data.menus as { id: string; path: string }[];
      assert.ok(menus.some(menu => menu.id === "receipts" && menu.path === "/admin/nota"), "instalasi baru mendapat menu dari versi 1");
      // Tiru database sebelum fitur ini: menu dan hak akses Super Admin belum ada, migrasi 3 belum jalan.
      await db.prepare("DELETE FROM menus WHERE id='receipts'").run();
      const role = JSON.parse((await db.prepare("SELECT document FROM roles WHERE id='admin'").get() as { document: string }).document) as { menuIds: string[] };
      await db.prepare("UPDATE roles SET document=? WHERE id='admin'").run(JSON.stringify({ ...role, menuIds: role.menuIds.filter(id => id !== "receipts") }));
      await db.prepare("DELETE FROM migrations WHERE version=3").run();
      await migrate();
      await migrate();
      const after = (await request("/access/overview", "GET", undefined, admin)).data as { menus: { id: string }[]; roles: { id: string; menuIds: string[] }[] };
      assert.equal(after.menus.filter(menu => menu.id === "receipts").length, 1, "tidak dobel");
      assert.ok(after.roles.find(item => item.id === "admin")!.menuIds.includes("receipts"));
      assert.ok(!after.roles.find(item => item.id === "staff")!.menuIds.includes("receipts"));
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
