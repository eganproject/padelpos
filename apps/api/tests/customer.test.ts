import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-customer-test-"));
process.env.DATA_DIR = directory;
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.MIDTRANS_CLIENT_KEY;

const projectId = "padelix-uji";
const apiKey = "AIza" + "B".repeat(35);
/** Kunci Google tiruan: tidak ada permintaan jaringan selama uji. */
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...google.publicKey.export({ format: "jwk" }), kid: "kunci-uji", alg: "RS256", use: "sig" };

let projectReply: { status: number; body: unknown } = { status: 200, body: {} };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (url.includes("securetoken@system.gserviceaccount.com"))
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
  if (url.includes("getProjectConfig"))
    return new Response(JSON.stringify(projectReply.body), { status: projectReply.status, headers: { "Content-Type": "application/json" } });
  if (url.includes("midtrans.com"))
    return new Response(JSON.stringify({ token: "tok-uji", redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-uji" }), { status: 201, headers: { "Content-Type": "application/json" } });
  return realFetch(input, init);
}) as typeof fetch;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** ID token Firebase tiruan, ditandatangani seperti aslinya. */
function idToken(claims: Record<string, unknown> = {}, options: { key?: KeyObject; header?: Record<string, unknown> } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: "kunci-uji", typ: "JWT", ...options.header };
  const payload = {
    iss: `https://securetoken.google.com/${projectId}`, aud: projectId, auth_time: now - 10, iat: now - 10, exp: now + 3600,
    sub: "google-uid-rahma", email: "rahma@gmail.test", email_verified: true, name: "Rahma Pratiwi",
    picture: "https://lh3.googleusercontent.com/foto", firebase: { sign_in_provider: "google.com" }, ...claims,
  };
  const body = `${b64(header)}.${b64(payload)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), options.key ?? google.privateKey).toString("base64url")}`;
}

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("akun pelanggan: login Google lewat Firebase, profil, riwayat, klaim, dan panel admin", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const day = (offset: number) => { const value = new Date(localClock().date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  const login = (overrides = {}) => ({ enabled: true, api_key: apiKey, auth_domain: `${projectId}.firebaseapp.com`, project_id: projectId, app_id: "1:123456789012:web:abc123def456", ...overrides });
  let admin = "", staff = "", courtId = "", rahma = "", budi = "", staffBooking = "";

  try {
    await t.test("penyiapan: admin, operator, dan lapangan", async () => {
      const registered = await request("/auth/register", "POST", { name: "Admin Akun", email: "admin@akun.test", phone: "081234567890", password: "StrongPass123" });
      assert.equal(registered.status, 201); admin = registered.cookie;
      assert.equal((await request("/access/users", "POST", { name: "Operator", email: "staff@akun.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "staff@akun.test", password: "StrongPass123" })).cookie;
      const court = await request("/operations/courts", "POST", { name: "Court Akun", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      assert.equal(court.status, 201); courtId = court.data.court.id;
    });

    await t.test("login ditolak selama venue belum mengaktifkannya", async () => {
      assert.equal((await request("/public/info")).data.login.enabled, false);
      assert.equal((await request("/customer/session", "POST", { id_token: idToken() })).status, 409);
    });

    await t.test("pengaturan Firebase: hanya admin, isian tervalidasi, dan config sampai ke browser", async () => {
      assert.equal((await request("/operations/customers", "GET", undefined, staff)).status, 403, "operator tanpa menu Pelanggan ditolak");
      assert.equal((await request("/operations/customers/login", "PUT", login({ api_key: "bukan-kunci" }), admin)).status, 400);
      assert.equal((await request("/operations/customers/login", "PUT", login({ app_id: "" }), admin)).status, 409, "tidak bisa aktif bila konfigurasi belum lengkap");
      const saved = await request("/operations/customers/login", "PUT", login(), admin);
      assert.equal(saved.status, 200);
      assert.equal(saved.data.settings.ready, true);
      assert.equal(saved.data.settings.site_domain, "padelix.contoh");
      const info = (await request("/public/info")).data.login;
      assert.deepEqual(info, { enabled: true, firebase: { apiKey, authDomain: `${projectId}.firebaseapp.com`, projectId, appId: "1:123456789012:web:abc123def456" } });
    });

    await t.test("uji koneksi menjelaskan apa yang kurang di Firebase", async () => {
      projectReply = { status: 200, body: { projectId, authorizedDomains: ["localhost", "padelix.contoh"], idpConfig: [{ provider: "GOOGLE", enabled: true }] } };
      const ok = await request("/operations/customers/login/test", "POST", {}, admin);
      assert.equal(ok.data.ok, true);
      assert.ok(ok.data.checks.every((item: { ok: boolean }) => item.ok));

      projectReply = { status: 200, body: { projectId, authorizedDomains: ["localhost"] } };
      const missing = await request("/operations/customers/login/test", "POST", {}, admin);
      assert.equal(missing.data.ok, false);
      const domain = missing.data.checks.find((item: { key: string }) => item.key === "domain");
      assert.equal(domain.ok, false);
      assert.match(domain.detail, /padelix\.contoh/);
      assert.equal(missing.data.checks.find((item: { key: string }) => item.key === "google").ok, null, "tanpa data penyedia, statusnya tidak dikarang");

      projectReply = { status: 400, body: { error: { message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } } };
      const invalid = await request("/operations/customers/login/test", "POST", {}, admin);
      assert.equal(invalid.data.ok, false);
      assert.match(invalid.data.checks[0].detail, /tidak mengenali API key/);
    });

    await t.test("token palsu, kedaluwarsa, atau dari proyek lain ditolak", async () => {
      const refused = async (token: string, expected = 401) => assert.equal((await request("/customer/session", "POST", { id_token: token })).status, expected, token.slice(0, 20));
      await refused(idToken({}, { key: stranger.privateKey }));
      await refused(idToken({ aud: "proyek-lain" }));
      await refused(idToken({ iss: "https://securetoken.google.com/proyek-lain" }));
      await refused(idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }));
      await refused(idToken({ sub: "" }));
      await refused(idToken({}, { header: { kid: "kunci-tak-dikenal" } }));
      const unsigned = idToken().split(".").slice(0, 2).join(".").replace(/^[^.]+/, b64({ alg: "none", kid: "kunci-uji" })) + ".";
      await refused(unsigned);
      await refused(idToken({ firebase: { sign_in_provider: "password" } }), 403);
      assert.equal((await request("/customer/session", "POST", { id_token: "bukan token" })).status, 400);
      assert.equal(db.prepare("SELECT count(*) n FROM customer_accounts").get()!.n, 0, "tidak ada akun yang tercipta dari token yang ditolak");
    });

    await t.test("login pertama membuat akun, login berikutnya memakai akun yang sama", async () => {
      const first = await request("/customer/session", "POST", { id_token: idToken() });
      assert.equal(first.status, 201);
      assert.match(first.cookie, /^padelix_customer=/, "pelanggan memakai cookie sendiri, bukan cookie staf");
      assert.equal(first.data.account.needs_profile, true);
      assert.equal(first.data.account.email, "rahma@gmail.test");
      rahma = first.cookie;
      const again = await request("/customer/session", "POST", { id_token: idToken({ picture: "https://lh3.googleusercontent.com/baru" }) });
      assert.equal(again.status, 200);
      assert.equal(again.data.account.id, first.data.account.id);
      assert.equal(again.data.account.photo_url, "https://lh3.googleusercontent.com/baru");
      budi = (await request("/customer/session", "POST", { id_token: idToken({ sub: "google-uid-budi", email: "budi@gmail.test", name: "Budi" }) })).cookie;
    });

    await t.test("sesi staf dan sesi pelanggan tidak saling membuka", async () => {
      assert.equal((await request("/customer/me", "GET", undefined, admin)).status, 401);
      assert.equal((await request("/operations/bookings", "GET", undefined, rahma)).status, 401);
      assert.equal((await request("/customer/me")).status, 401);
      const guest = await request("/customer/session");
      assert.equal(guest.status, 200, "status sesi tamu bukan galat");
      assert.equal(guest.data.account, null);
      assert.equal((await request("/customer/session", "GET", undefined, rahma)).data.account.email, "rahma@gmail.test");
    });

    await t.test("profil: nomor HP wajib, dirapikan, dan ditolak bila bukan nomor Indonesia", async () => {
      assert.equal((await request("/customer/me", "PUT", { name: "Rahma", phone: "12345" }, rahma)).status, 400);
      const saved = await request("/customer/me", "PUT", { name: "Rahma Pratiwi", phone: "+62 812-3450-0001" }, rahma);
      assert.equal(saved.status, 200);
      assert.equal(saved.data.account.phone, "0812-3450-0001");
      assert.equal(saved.data.account.needs_profile, false);
      assert.equal((await request("/customer/me", "PUT", { name: "Budi", phone: "081234500001" }, budi)).status, 200, "nomor sama boleh dipakai dua akun: tidak ada kebocoran nomor terdaftar");
    });

    await t.test("staf menghubungkan booking kasir ke akun dengan nomor yang sama", async () => {
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Rahma", phone: "081234500001", date: day(2), start_time: "18:00", end_time: "20:00" }, admin);
      assert.equal(created.status, 201); staffBooking = created.data.booking.id;
      const detail = await request(`/operations/bookings/${staffBooking}`, "GET", undefined, admin);
      assert.equal(detail.data.account.linked, null);
      assert.equal(detail.data.account.suggestions.length, 2, "dua akun memakai nomor itu; staf yang memilih");
      const rahmaId = (await request("/customer/me", "GET", undefined, rahma)).data.account.id;
      const linked = await request(`/operations/bookings/${staffBooking}/account`, "POST", { account_id: rahmaId }, admin);
      assert.equal(linked.data.account.linked.id, rahmaId);

      const overview = await request("/customer/overview", "GET", undefined, rahma);
      assert.equal(overview.data.next.id, staffBooking);
      assert.equal(overview.data.upcoming_count, 1);
      assert.equal(overview.data.next.court_name, "Court Akun");
      assert.equal((await request("/customer/overview", "GET", undefined, budi)).data.upcoming_count, 0, "akun lain bernomor sama tidak ikut melihatnya");
    });

    await t.test("klaim pesanan lama dengan kode + nomor HP", async () => {
      const old = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Budi", phone: "0812 3450 0001", date: day(3), start_time: "08:00", end_time: "09:00" }, admin);
      const code = old.data.booking.id.slice(0, 8).toUpperCase();
      assert.equal((await request("/customer/claim", "POST", { code, phone: "081299999999" }, budi)).status, 404, "nomor salah");
      assert.equal((await request("/customer/claim", "POST", { code: "ABCDEF12", phone: "081234500001" }, budi)).status, 404, "kode salah, pesannya sama");
      const claimed = await request("/customer/claim", "POST", { code, phone: "081234500001" }, budi);
      assert.equal(claimed.status, 200);
      assert.equal(claimed.data.linked, 1);
      assert.equal((await request("/customer/claim", "POST", { code, phone: "081234500001" }, rahma)).status, 409, "sudah milik akun lain");
      assert.equal((await request("/customer/claim", "POST", { code, phone: "081234500001" }, budi)).data.already, 1);
      assert.equal((await request("/customer/bookings?scope=upcoming", "GET", undefined, budi)).data.items.length, 1);
    });

    await t.test("checkout sambil login masuk ke riwayat dan menunggu pembayaran", async () => {
      assert.equal((await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-uji", server_key: "SB-Mid-server-uji", mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin)).status, 200);
      const checkout = await request("/public/checkout", "POST", {
        items: [{ court_id: courtId, date: day(4), start_time: "10:00", end_time: "11:00", addons: [] }],
        customer: "Rahma Pratiwi", phone: "081234500001", email: "", notes: "",
      }, rahma);
      assert.equal(checkout.status, 201);
      const overview = await request("/customer/overview", "GET", undefined, rahma);
      assert.equal(overview.data.upcoming_count, 2);
      assert.equal(overview.data.awaiting.length, 1);
      assert.equal(overview.data.awaiting[0].order_code, checkout.data.code);
      assert.equal(overview.data.next.id, staffBooking, "yang terdekat dan sudah pasti tetap jadi jadwal berikutnya");

      const guest = await request("/public/checkout", "POST", {
        items: [{ court_id: courtId, date: day(4), start_time: "12:00", end_time: "13:00", addons: [] }],
        customer: "Tamu", phone: "081234500009", email: "", notes: "",
      });
      assert.equal(guest.status, 201);
      assert.equal(db.prepare("SELECT account_id FROM bookings WHERE order_id=?").get(guest.data.order_id)!.account_id, null, "tanpa login tidak terhubung ke akun mana pun");
    });

    await t.test("riwayat dibagi: akan datang, selesai, dibatalkan", async () => {
      const bookings = await request("/customer/bookings?scope=upcoming", "GET", undefined, rahma);
      assert.deepEqual(bookings.data.counts, { upcoming: 2, past: 0, cancelled: 0 });
      assert.ok(bookings.data.items[0].date <= bookings.data.items[1].date, "yang akan datang diurutkan dari yang terdekat");
      assert.equal((await request(`/operations/bookings/${staffBooking}/status`, "PATCH", { status: "cancelled", reason: "Hujan deras" }, admin)).status, 200);
      const after = await request("/customer/bookings?scope=cancelled", "GET", undefined, rahma);
      assert.equal(after.data.items[0].cancel_reason, "Hujan deras");
      assert.equal(after.data.counts.upcoming, 1);
    });

    await t.test("daftar akun di panel admin", async () => {
      const list = await request("/operations/customers", "GET", undefined, admin);
      assert.equal(list.status, 200);
      assert.equal(list.data.accounts.length, 2);
      const rahmaRow = list.data.accounts.find((row: { email: string }) => row.email === "rahma@gmail.test");
      assert.equal(rahmaRow.bookings, 1, "booking yang dibatalkan tidak dihitung");
    });

    await t.test("hapus akun: booking tetap ada, kaitannya dilepas, sesi berakhir", async () => {
      const before = db.prepare("SELECT count(*) n FROM bookings").get()!.n;
      assert.equal((await request("/customer/me", "DELETE", undefined, budi)).status, 204);
      assert.equal((await request("/customer/me", "GET", undefined, budi)).status, 401);
      assert.equal(db.prepare("SELECT count(*) n FROM bookings").get()!.n, before);
      assert.equal(db.prepare("SELECT count(*) n FROM customer_accounts").get()!.n, 1);
    });

    await t.test("keluar mengakhiri sesi di server, bukan hanya menghapus cookie", async () => {
      assert.equal((await request("/customer/logout", "POST", {}, rahma)).status, 204);
      assert.equal((await request("/customer/me", "GET", undefined, rahma)).status, 401);
    });
  } finally {
    server.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
