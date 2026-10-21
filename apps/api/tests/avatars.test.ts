import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-avatar-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("avatars");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");

/** PNG 1x1 yang sah, cukup untuk lolos pemeriksaan tanda tangan berkas. */
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("foto profil staf dan pelanggan: unggah, ganti, hapus, dan ikut terhapus bersama akun", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "", type = "application/json") {
    const response = await fetch(base + url, {
      method, headers: { "Content-Type": type, Cookie: cookie, Origin: "http://localhost:3000" },
      ...(body !== undefined ? { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const count = async () => Number((await db.prepare("SELECT count(*) n FROM avatars").get() as { n: number }).n);
  let admin = "";

  try {
    await t.test("staf mengganti dan menghapus fotonya sendiri", async () => {
      const registered = await request("/auth/register", "POST", { name: "Admin Foto", email: "admin@foto.test", phone: "081234567890", password: "StrongPass123" });
      assert.equal(registered.status, 201); admin = registered.cookie;
      assert.equal(registered.data.user.avatarId, undefined);

      assert.equal((await request("/profile/avatar", "POST", Buffer.from("bukan foto"), admin, "image/png")).status, 400);
      assert.equal((await request("/profile/avatar", "POST", Buffer.from("teks"), admin, "text/plain")).status, 415);

      const first = await request("/profile/avatar", "POST", png, admin, "image/png");
      assert.equal(first.status, 200);
      const firstId = first.data.user.avatarId as string;
      assert.ok(firstId);
      assert.equal(first.data.user.passwordHash, undefined);
      const photo = await fetch(`${base}/public/photos/${firstId}`);
      assert.equal(photo.status, 200);
      assert.equal(photo.headers.get("content-type"), "image/png");

      const second = await request("/profile/avatar", "POST", png, admin, "image/png");
      assert.notEqual(second.data.user.avatarId, firstId, "id baru agar cache foto lama tidak terpakai");
      assert.equal((await fetch(`${base}/public/photos/${firstId}`)).status, 404);
      assert.equal(await count(), 1);
      assert.equal((await request("/auth/me", "GET", undefined, admin)).data.user.avatarId, second.data.user.avatarId);

      // Mengubah nama tidak menghapus foto.
      const renamed = await request("/profile", "PUT", { name: "Admin Baru", phone: "081234567890" }, admin);
      assert.equal(renamed.data.user.avatarId, second.data.user.avatarId);

      const removed = await request("/profile/avatar", "DELETE", undefined, admin);
      assert.equal(removed.status, 200);
      assert.equal(removed.data.user.avatarId, undefined);
      assert.equal(await count(), 0);
    });

    await t.test("foto staf ikut terhapus saat penggunanya dihapus", async () => {
      assert.equal((await request("/access/users", "POST", { name: "Operator", email: "staff@foto.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      const staff = (await request("/auth/login", "POST", { email: "staff@foto.test", password: "StrongPass123" }));
      const uploaded = await request("/profile/avatar", "POST", png, staff.cookie, "image/png");
      assert.equal(uploaded.status, 200);
      assert.equal(await count(), 1);
      const list = await request("/access/overview", "GET", undefined, admin);
      const target = (list.data.users as { id: string; avatarId?: string }[]).find(user => user.avatarId === uploaded.data.user.avatarId);
      assert.ok(target, "daftar pengguna memuat foto");
      assert.equal((await request(`/access/users/${target.id}`, "DELETE", undefined, admin)).status, 204);
      assert.equal(await count(), 0);
    });

    await t.test("pelanggan mengganti foto; foto unggahan menggantikan foto Google", async () => {
      const stamp = new Date().toISOString();
      await db.prepare("INSERT INTO customer_accounts (id,firebase_uid,email,name,phone,photo_url,created_at,last_login_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("akun-foto", "uid-foto", "rahma@foto.test", "Rahma", "6281234567890", "https://lh3.googleusercontent.com/foto", stamp, stamp);
      const token = randomBytes(32).toString("hex");
      await db.prepare("INSERT INTO sessions (id,subject_id,subject_type,expires_at) VALUES (?,?,?,?)")
        .run(createHash("sha256").update(token).digest("hex"), "akun-foto", "customer", Date.now() + 3600000);
      const cookie = `padelix_customer=${token}`;

      const before = await request("/customer/me", "GET", undefined, cookie);
      assert.equal(before.data.account.photo_url, "https://lh3.googleusercontent.com/foto");
      assert.equal(before.data.account.custom_photo, false);

      assert.equal((await request("/customer/me/avatar", "POST", png, "", "image/png")).status, 401);
      const uploaded = await request("/customer/me/avatar", "POST", png, cookie, "image/png");
      assert.equal(uploaded.status, 200);
      assert.equal(uploaded.data.account.custom_photo, true);
      assert.match(uploaded.data.account.photo_url, /^\/api\/public\/photos\/[0-9a-f-]+$/);
      assert.equal((await fetch(base + uploaded.data.account.photo_url.slice(4))).status, 200);

      const listed = await request("/operations/customers", "GET", undefined, admin);
      assert.equal(listed.status, 200);
      const row = (listed.data.accounts as { id: string; photo_url: string }[]).find(item => item.id === "akun-foto");
      assert.equal(row?.photo_url, uploaded.data.account.photo_url);

      const removed = await request("/customer/me/avatar", "DELETE", undefined, cookie);
      assert.equal(removed.data.account.photo_url, "https://lh3.googleusercontent.com/foto");
      assert.equal(removed.data.account.custom_photo, false);

      await request("/customer/me/avatar", "POST", png, cookie, "image/png");
      assert.equal(await count(), 1);
      assert.equal((await request("/customer/me", "DELETE", undefined, cookie)).status, 204);
      assert.equal(await count(), 0, "foto ikut terhapus bersama akun");
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
