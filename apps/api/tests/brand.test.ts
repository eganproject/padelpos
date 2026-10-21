import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-brand-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("brand");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");

// PNG 1x1 transparan.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("Pengaturan > Brand: nama, kontak, warna, logo, favicon, dan hak akses", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "", type = "application/json") {
    const raw = Buffer.isBuffer(body);
    const response = await fetch(base + url, { method, headers: { "Content-Type": type, Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] || "", headers: response.headers };
  }
  let admin = "", staff = "";

  try {
    await t.test("menu Brand ada di grup Pengaturan dan hanya untuk Super Admin", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Brand", email: "admin@brand.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Operator", email: "op@brand.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "op@brand.test", password: "StrongPass123" })).cookie;
      const menu = await db.prepare("SELECT document FROM menus WHERE id='brand'").get() as { document: string };
      assert.equal(JSON.parse(menu.document).path, "/admin/brand");
      assert.equal(JSON.parse(menu.document).group, "Pengaturan");
      assert.equal((await request("/operations/brand", "GET", undefined, staff)).status, 403);
      assert.equal((await request("/operations/brand")).status, 401);
    });

    await t.test("bawaan: tanpa logo dan warna, nama dari Info venue", async () => {
      const brand = await request("/public/brand");
      assert.equal(brand.status, 200);
      assert.equal(brand.data.logo, null);
      assert.equal(brand.data.favicon, null);
      assert.equal(brand.data.primary_color, "");
      assert.equal(brand.data.show_name, true);
    });

    await t.test("menyimpan nama, kontak, dan warna tanpa menghapus alamat dan fasilitas", async () => {
      assert.equal((await request("/operations/content/info", "PUT", { name: "Lama", address: "Jl. Merdeka 1", facilities: ["parkir"] }, admin)).status, 200);
      const saved = await request("/operations/brand", "PUT", {
        name: "Smash Padel Club", tagline: "Padel terbaik di kota", whatsapp: "0812 3333 4444", email: "halo@smash.test",
        instagram: "https://instagram.com/smashpadel/", tiktok: "@smash.padel", website: "https://smash.test",
        primary_color: "#1D4ED8", accent_color: "#facc15", show_name: false, footer_text: "PT Smash Padel Indonesia", copyright: "",
      }, admin);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(saved.data.brand.name, "Smash Padel Club");
      assert.equal(saved.data.brand.primary_color, "#1d4ed8", "kode warna disimpan huruf kecil");
      assert.equal(saved.data.contact.whatsapp, "6281233334444");
      assert.equal(saved.data.contact.instagram, "smashpadel");
      assert.equal(saved.data.contact.tiktok, "smash.padel");
      const info = (await request("/public/info")).data;
      assert.equal(info.info.name, "Smash Padel Club");
      assert.equal(info.info.address, "Jl. Merdeka 1", "alamat dari Info venue tetap");
      assert.deepEqual(info.info.facilities, ["parkir"]);
      assert.equal(info.brand.footer_text, "PT Smash Padel Indonesia");
      assert.equal(info.brand.show_name, false);
    });

    await t.test("validasi: warna, nama kosong, dan tautan tanpa https", async () => {
      assert.equal((await request("/operations/brand", "PUT", { name: "Smash", primary_color: "biru" }, admin)).status, 400);
      assert.equal((await request("/operations/brand", "PUT", { name: "" }, admin)).status, 400);
      assert.equal((await request("/operations/brand", "PUT", { name: "Smash", facebook: "http://facebook.com/x" }, admin)).status, 400);
    });

    await t.test("logo dan favicon: unggah, sajikan, ganti, hapus", async () => {
      assert.equal((await request("/operations/brand/assets/logo", "POST", Buffer.from("bukan gambar"), admin, "image/png")).status, 400);
      assert.equal((await request("/operations/brand/assets/sembarang", "POST", png, admin, "image/png")).status, 404);
      assert.equal((await request("/operations/brand/assets/logo", "POST", png, staff, "image/png")).status, 403);
      const first = await request("/operations/brand/assets/logo", "POST", png, admin, "image/png");
      assert.equal(first.status, 200, JSON.stringify(first.data));
      const logo = first.data.brand.logo as string;
      assert.ok(logo);
      const file = await fetch(`${base}/public/photos/${logo}`);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get("content-type"), "image/png");
      assert.equal((await request("/operations/brand/assets/favicon", "POST", png, admin, "image/png")).data.brand.favicon !== null, true);
      const replaced = await request("/operations/brand/assets/logo", "POST", png, admin, "image/png");
      assert.notEqual(replaced.data.brand.logo, logo, "id baru agar cache browser ikut berganti");
      assert.equal((await fetch(`${base}/public/photos/${logo}`)).status, 404, "berkas lama terhapus");
      const removed = await request("/operations/brand/assets/logo", "DELETE", undefined, admin);
      assert.equal(removed.data.brand.logo, null);
      assert.ok(removed.data.brand.favicon);
    });

    await t.test("nota ikut membawa logo merek", async () => {
      const uploaded = await request("/operations/brand/assets/logo", "POST", png, admin, "image/png");
      const { bookingReceipt } = await import("../src/receipts.js");
      const court = await request("/operations/courts", "POST", { name: "Court Brand", hourly_rate: 100000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      const { localClock } = await import("../src/operations.js");
      const date = new Date(localClock().date + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() + 1);
      const booking = await request("/operations/bookings", "POST", { court_id: court.data.court.id, customer: "Budi", phone: "081299998888", email: "", date: date.toISOString().slice(0, 10), start_time: "10:00", end_time: "11:00", notes: "", addons: [] }, admin);
      const receipt = await bookingReceipt(booking.data.booking.id, "x");
      assert.equal(receipt.venue.logo, uploaded.data.brand.logo);
      assert.equal(receipt.venue.name, "Smash Padel Club");
      assert.equal(receipt.settings.show_logo, true);
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
