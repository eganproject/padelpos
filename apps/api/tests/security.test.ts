import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-security-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("security");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
delete process.env.SECRET_KEY;
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.SMTP_HOST;
delete process.env.WHATSAPP_PROVIDER;

const { app } = await import("../src/app.js");
const { db, saveSetting, readSetting } = await import("../src/store.js");
const { totpAt } = await import("../src/totp.js");
const { sealStoredSecrets } = await import("../src/secrets.js");
const { paymentConfig } = await import("../src/midtrans.js");

test("reset password, verifikasi 2 langkah, dan enkripsi kunci rahasia", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  let admin = "", secret = "", recovery: string[] = [];

  try {
    await t.test("penyiapan", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Aman", email: "admin@aman.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.ok(admin);
      assert.equal((await request("/access/users", "POST", { name: "Kasir Pagi", email: "kasir@aman.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
    });

    await t.test("G3: kunci rahasia disimpan terenkripsi dan tetap terbaca oleh aplikasi", async () => {
      const saved = await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-abc", server_key: "SB-Mid-server-rahasia123", mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.ok(!JSON.stringify(saved.data).includes("rahasia123"), "server key tidak dikirim ke browser");
      const row = await readSetting<{ server_key: string }>("payment");
      assert.match(row!.server_key, /^enc:v1:/);
      assert.ok(!row!.server_key.includes("rahasia123"));
      assert.equal((await paymentConfig()).serverKey, "SB-Mid-server-rahasia123");
      // Data lama berupa teks biasa: tetap terbaca, lalu dienkripsi saat server mulai.
      await saveSetting("whatsapp", { enabled: false, provider: "fonnte", token: "token-lama-polos" });
      assert.equal(await sealStoredSecrets(), 1);
      assert.match((await readSetting<{ token: string }>("whatsapp"))!.token, /^enc:v1:/);
      const { whatsappConfig } = await import("../src/whatsapp.js");
      assert.equal((await whatsappConfig()).token, "token-lama-polos");
      assert.equal(await sealStoredSecrets(), 0, "aman dijalankan ulang");
    });

    await t.test("G1: lupa password lewat email, tautan sekali pakai", async () => {
      // Email belum aktif: jawaban tetap umum dan tidak ada tautan yang dibuat.
      assert.equal((await request("/auth/recovery")).data.email, false);
      const quiet = await request("/auth/forgot", "POST", { email: "kasir@aman.test" });
      assert.equal(quiet.status, 200);
      assert.equal((await db.prepare("SELECT count(*) n FROM password_resets").get() as { n: number }).n, 0);

      const email = await request("/operations/notifications/settings", "PUT", { enabled: true, host: "127.0.0.1", port: 2525, secure: false, user: "mailer", password: "smtp-rahasia", from_name: "Venue", from_email: "noreply@aman.test", staff_recipients: [], reminder_hours: 24 }, admin);
      assert.equal(email.status, 200, JSON.stringify(email.data));
      assert.match((await readSetting<{ password: string }>("email"))!.password, /^enc:v1:/, "password SMTP terenkripsi");
      assert.equal((await request("/auth/recovery")).data.email, true);

      const unknown = await request("/auth/forgot", "POST", { email: "tidakada@aman.test" });
      const known = await request("/auth/forgot", "POST", { email: "kasir@aman.test" });
      assert.equal(known.status, 200);
      assert.equal(unknown.data.message, known.data.message, "email terdaftar tidak bisa ditebak dari jawabannya");
      const mail = await db.prepare("SELECT text FROM email_outbox WHERE kind='password_reset' ORDER BY created_at DESC LIMIT 1").get() as { text: string };
      const token = /token=([a-f0-9]{64})/.exec(mail.text)![1];
      const stored = await db.prepare("SELECT token_hash FROM password_resets").get() as { token_hash: string };
      assert.notEqual(stored.token_hash, token, "token hanya disimpan sebagai hash");

      const kasir = (await request("/auth/login", "POST", { email: "kasir@aman.test", password: "StrongPass123" })).cookie;
      assert.equal((await request("/auth/reset?token=" + token)).status, 200);
      assert.equal((await request("/auth/reset", "POST", { token, password: "lemah" })).status, 400);
      const done = await request("/auth/reset", "POST", { token, password: "PasswordBaru99" });
      assert.equal(done.status, 200, JSON.stringify(done.data));
      assert.equal((await request("/auth/me", "GET", undefined, kasir)).status, 401, "sesi lama dicabut");
      assert.equal((await request("/auth/reset", "POST", { token, password: "PasswordLain99" })).status, 410, "tautan tidak bisa dipakai dua kali");
      assert.equal((await request("/auth/login", "POST", { email: "kasir@aman.test", password: "PasswordBaru99" })).status, 200);
      assert.equal((await request("/auth/reset", "POST", { token: "a".repeat(64), password: "PasswordLain99" })).status, 410);
    });

    await t.test("G2: verifikasi 2 langkah dengan aplikasi authenticator", async () => {
      const kasir = (await request("/auth/login", "POST", { email: "kasir@aman.test", password: "PasswordBaru99" })).cookie;
      assert.equal((await request("/profile/2fa/setup", "POST", { password: "salah" }, kasir)).status, 400);
      const setup = await request("/profile/2fa/setup", "POST", { password: "PasswordBaru99" }, kasir);
      assert.equal(setup.status, 200, JSON.stringify(setup.data));
      secret = setup.data.secret;
      assert.match(setup.data.otpauth_url, /^otpauth:\/\/totp\//);
      assert.equal((await request("/profile/2fa/enable", "POST", { code: "000000" }, kasir)).status, 400);
      const enabled = await request("/profile/2fa/enable", "POST", { code: totpAt(secret) }, kasir);
      assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
      recovery = enabled.data.recovery_codes;
      assert.equal(recovery.length, 8);
      const users = await db.prepare("SELECT document FROM users").all() as { document: string }[];
      assert.ok(!users.some(row => row.document.includes(secret)), "rahasia TOTP terenkripsi di database");
      assert.ok(!users.some(row => row.document.includes(recovery[0])), "kode cadangan hanya disimpan sebagai hash");
      const me = (await request("/auth/me", "GET", undefined, kasir)).data.user;
      assert.equal(me.twoFactorEnabled, true);
      assert.equal(me.twoFactor, undefined);

      // Password benar belum cukup.
      const first = await request("/auth/login", "POST", { email: "kasir@aman.test", password: "PasswordBaru99" });
      assert.equal(first.status, 200);
      assert.equal(first.data.twoFactor, true);
      assert.equal(first.cookie, "", "belum ada sesi sebelum kode dimasukkan");
      assert.equal((await request("/auth/login/2fa", "POST", { ticket: first.data.ticket, code: "123456" })).status, 401);
      assert.equal((await request("/auth/login/2fa", "POST", { ticket: first.data.ticket + "x", code: totpAt(secret, Date.now() + 30000) })).status, 401, "tiket yang diubah ditolak");
      const second = await request("/auth/login/2fa", "POST", { ticket: first.data.ticket, code: totpAt(secret, Date.now() + 30000) });
      assert.equal(second.status, 200, JSON.stringify(second.data));
      assert.ok(second.cookie);
      // Kode yang sama tidak bisa dipakai ulang.
      assert.equal((await request("/auth/login/2fa", "POST", { ticket: first.data.ticket, code: totpAt(secret, Date.now() + 30000) })).status, 401);

      // Kode cadangan sekali pakai.
      const viaRecovery = await request("/auth/login/2fa", "POST", { ticket: first.data.ticket, code: recovery[0].toLowerCase() });
      assert.equal(viaRecovery.status, 200, JSON.stringify(viaRecovery.data));
      assert.equal(viaRecovery.data.recoveryLeft, 7);
      assert.equal((await request("/auth/login/2fa", "POST", { ticket: first.data.ticket, code: recovery[0] })).status, 401);
    });

    await t.test("G2: admin bisa mematikan 2 langkah staf yang kehilangan ponsel", async () => {
      const users = (await request("/access/overview", "GET", undefined, admin)).data.users as { id: string; email: string; twoFactorEnabled: boolean }[];
      const kasir = users.find(user => user.email === "kasir@aman.test")!;
      assert.equal(kasir.twoFactorEnabled, true);
      const reset = await request(`/access/users/${kasir.id}/reset-2fa`, "POST", {}, admin);
      assert.equal(reset.status, 200, JSON.stringify(reset.data));
      assert.equal(reset.data.user.twoFactorEnabled, false);
      const login = await request("/auth/login", "POST", { email: "kasir@aman.test", password: "PasswordBaru99" });
      assert.equal(login.data.twoFactor, undefined);
      assert.ok(login.cookie);
      // Matikan sendiri butuh password dan kode yang berlaku.
      const self = login.cookie;
      const again = await request("/profile/2fa/setup", "POST", { password: "PasswordBaru99" }, self);
      await request("/profile/2fa/enable", "POST", { code: totpAt(again.data.secret) }, self);
      assert.equal((await request("/profile/2fa/disable", "POST", { password: "PasswordBaru99", code: "000000" }, self)).status, 400);
      const off = await request("/profile/2fa/disable", "POST", { password: "PasswordBaru99", code: totpAt(again.data.secret, Date.now() + 30000) }, self);
      assert.equal(off.status, 200, JSON.stringify(off.data));
      assert.equal(off.data.enabled, false);
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
