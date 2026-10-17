import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import mysql from "mysql2/promise";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-database-test-"));
process.env.DATA_DIR = directory;
process.env.BACKUP_DIR = path.join(directory, "backups");
process.env.INTERNAL_PROXY_SECRET = "rahasia-uji";
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
const mainUrl = await useTestDatabase("database");
// Database kedua untuk impor SQLite; dibuat sekarang, lalu DATABASE_URL dikembalikan ke database utama.
const importUrl = await useTestDatabase("import");
process.env.DATABASE_URL = mainUrl;

const { app } = await import("../src/app.js");
const { db, isDuplicate } = await import("../src/store.js");
const { localClock, scheduleClash } = await import("../src/operations.js");
const backups = await import("../src/backups.js");

const stamp = new Date().toISOString();
const errorCode = async (work: () => Promise<unknown>) => { try { await work(); return "tidak ditolak"; } catch (error) { return (error as { code?: string }).code ?? (error as Error).message; } };
const signed = (ip: string, secret = "rahasia-uji") => { const at = Math.floor(Date.now() / 1000); return `${ip};${at};${createHmac("sha256", secret).update(`${ip};${at}`).digest("hex")}`; };

test("database MySQL: aturan skema, log aktivitas, backup, rate limit, dan impor SQLite", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "", headers: Record<string, string> = {}) {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const type = response.headers.get("content-type") ?? "";
    const data = response.status === 204 ? null : type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] || "", headers: response.headers };
  }
  const tomorrowDate = new Date(localClock().date + "T12:00:00Z"); tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  const password = "StrongPass123";
  let admin = "", staff = "", courtId = "", bookingId = "";
  try {
    await t.test("skema menolak data yang melanggar aturan, seperti di SQLite dulu", async () => {
      courtId = randomUUID();
      await db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,created_at) VALUES (?,?,?,?,?,?)").run(courtId, "Lapangan Uji", 300000, "06:00", "24:00", stamp);
      assert.ok(isDuplicate(await db.prepare("INSERT INTO courts (id,name,hourly_rate,opens_at,closes_at,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), "lapangan uji", 300000, "06:00", "24:00", stamp).catch(error => error)), "nama lapangan unik tanpa membedakan huruf besar");
      const insert = (id: string, start: string, end: string, status: string, extra: { hold?: number | null; source?: string; createdBy?: string | null } = {}) => () =>
        db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,court_total,status,created_by,created_at,hold_expires_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, courtId, "X", "081234567890", "2030-02-01", start, end, 300000, 300000, status, extra.createdBy === undefined ? "staff-1" : extra.createdBy, stamp, extra.hold ?? null, extra.source ?? "staff");
      assert.equal(await errorCode(insert("x1", "15:00", "16:00", "pending")), "ER_CHECK_CONSTRAINT_VIOLATED", "pending wajib punya batas hold");
      assert.equal(await errorCode(insert("x2", "16:00", "17:00", "confirmed", { source: "online", createdBy: null })), "ER_CHECK_CONSTRAINT_VIOLATED", "booking online wajib punya pelanggan");
      assert.equal(await errorCode(insert("x3", "17:00", "18:00", "menunggu")), "ER_CHECK_CONSTRAINT_VIOLATED", "status di luar daftar ditolak");
      assert.equal(await errorCode(() => db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,court_total,status,created_by,created_at) VALUES ('x4','tidak-ada','X','0812','2030-02-01','09:00','10:00',1,1,'confirmed','s',?)").run(stamp)), "ER_NO_REFERENCED_ROW_2", "foreign key aktif");

      const now = Math.floor(Date.now() / 1000);
      await insert("h1", "09:00", "10:00", "pending", { hold: now + 600 })();
      assert.equal(await scheduleClash(courtId, "2030-02-01", "09:30", "10:30"), true, "hold aktif memblokir slot");
      await insert("h2", "11:00", "12:00", "pending", { hold: now - 1 })();
      assert.equal(await scheduleClash(courtId, "2030-02-01", "11:00", "12:00"), false, "hold kedaluwarsa tidak memblokir");
      assert.equal(await scheduleClash(courtId, "2030-02-01", "09:00", "10:00", "h1"), false, "booking itu sendiri tidak dihitung bentrok");
      await db.prepare("INSERT INTO maintenance (id,court_id,date,start_time,end_time,reason) VALUES (?,?,?,?,?,?)").run(randomUUID(), courtId, "2030-02-01", "13:00", "14:00", "Servis");
      assert.equal(await scheduleClash(courtId, "2030-02-01", "13:30", "14:30"), true, "perawatan memblokir slot");

      const gateway = (id: string) => db.prepare("INSERT INTO payments (id,booking_id,amount,kind,method,source,gateway_ref,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, "h1", 1000, "payment", "ewallet", "gateway", "MID-123", "", null, stamp);
      await gateway("pg1");
      assert.ok(isDuplicate(await gateway("pg2").catch(error => error)), "gateway_ref ganda ditolak demi idempotensi webhook");
      await db.prepare("DELETE FROM payments WHERE id='pg1'").run();
      await db.prepare("DELETE FROM bookings WHERE id IN ('h1','h2')").run();
    });

    await t.test("API memetakan error MySQL ke pesan yang jelas", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Uji", email: "admin@uji.test", phone: "081234567890", password })).cookie;
      assert.ok(admin);
      const duplicate = await request("/operations/courts", "POST", { name: "LAPANGAN UJI", hourly_rate: 200000, opens_at: "06:00", closes_at: "22:00", active: true }, admin);
      assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Budi", phone: "081200000001", date: tomorrow, start_time: "09:00", end_time: "10:00", notes: "" }, admin);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bookingId = created.data.booking.id;
      assert.equal((await request("/operations/maintenance", "POST", { court_id: courtId, date: tomorrow, start_time: "09:30", end_time: "10:30", reason: "Servis" }, admin)).status, 409, "perawatan tidak boleh menimpa booking");
    });

    await t.test("log aktivitas mencatat nilai sebelum dan sesudah, dan bisa disaring", async () => {
      assert.equal((await request(`/operations/bookings/${bookingId}/discount`, "PUT", { amount: 50000, note: "Member" }, admin)).status, 200);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", { id: randomUUID(), amount: 100000, kind: "payment", method: "cash", note: "DP" }, admin)).status, 201);
      const log = await request("/operations/audit?action=booking", "GET", undefined, admin);
      assert.equal(log.status, 200);
      const discount = log.data.entries.find((entry: { action: string }) => entry.action === "booking.discount");
      assert.ok(discount, "potongan harga tercatat");
      assert.equal(discount.actor_name, "Admin Uji");
      assert.deepEqual(discount.detail.before, { discount: 0, note: "", total: 300000 });
      assert.equal(discount.detail.after.discount, 50000);
      assert.ok(log.data.entries.every((entry: { action: string }) => entry.action.startsWith("booking.")), "saringan jenis aksi");
      const payment = (await request("/operations/audit?action=payment", "GET", undefined, admin)).data.entries[0];
      assert.equal(payment.detail.amount, 100000);
      assert.equal(payment.detail.paid_before, 0);
      const search = (await request("/operations/audit?q=MEMBER", "GET", undefined, admin)).data.entries;
      assert.equal(search.length, 1, "pencarian isi rincian tanpa membedakan huruf besar");
      const page = await request("/operations/audit?limit=1", "GET", undefined, admin);
      assert.equal(page.data.entries.length, 1);
      assert.ok(page.data.next_before);
      const next = await request(`/operations/audit?limit=1&before=${page.data.next_before}`, "GET", undefined, admin);
      assert.ok(next.data.entries[0].id < page.data.entries[0].id, "halaman berikutnya lebih lama");
      const today = localClock().date;
      assert.ok((await request(`/operations/audit?from=${today}&to=${today}`, "GET", undefined, admin)).data.entries.length >= 3, "filter tanggal memakai jam venue");
      assert.equal((await request(`/operations/audit?from=2000-01-01&to=2000-01-02`, "GET", undefined, admin)).data.entries.length, 0);

      await request("/access/users", "POST", { name: "Staf Uji", email: "staf@uji.test", phone: "081234567891", password, role: "staff" }, admin);
      staff = (await request("/auth/login", "POST", { email: "staf@uji.test", password })).cookie;
      assert.equal((await request("/operations/audit", "GET", undefined, staff)).status, 403, "staf biasa tidak melihat log");
      assert.equal((await request("/operations/backups", "GET", undefined, staff)).status, 403, "staf biasa tidak melihat backup");
    });

    await t.test("backup lewat panel: buat, unduh, batasi jumlah, dan hapus", async () => {
      const first = await request("/operations/backups", "POST", {}, admin);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      const name = first.data.created as string;
      assert.match(name, /^padelix-\d{8}-\d{6}-manual\.json\.gz$/);
      const download = await request(`/operations/backups/${name}/download`, "GET", undefined, admin);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-type"), "application/gzip");
      const lines = gunzipSync(download.data as Buffer).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.equal(lines[0].format, "padelix-backup");
      assert.ok(lines.some(line => line.table === "bookings"));
      assert.ok(!lines.some(line => line.table === "sessions"), "sesi login tidak ikut");
      assert.equal((await request("/operations/backups/..%2F..%2Fetc%2Fpasswd/download", "GET", undefined, admin)).status, 404, "nama berkas dibatasi");
      assert.equal((await request("/operations/backups/padelix-20000101-000000-manual.json.gz/download", "GET", undefined, admin)).status, 404);

      await new Promise(resolve => setTimeout(resolve, 1100));
      const second = await request("/operations/backups", "POST", {}, admin);
      assert.equal(second.data.files.length, 2);
      const kept = await request("/operations/backups/settings", "PUT", { enabled: true, hour: 3, keep: 1 }, admin);
      assert.equal(kept.status, 200);
      assert.deepEqual(kept.data.files.map((file: { name: string }) => file.name), [second.data.created], "berkas tertua dihapus");
      assert.equal((await request("/operations/backups/settings", "PUT", { enabled: true, hour: 3, keep: 0 }, admin)).status, 400);
      const removed = await request(`/operations/backups/${second.data.created}`, "DELETE", undefined, admin);
      assert.equal(removed.data.files.length, 0);
      const actions = (await request("/operations/audit?action=backup", "GET", undefined, admin)).data.entries.map((entry: { action: string }) => entry.action);
      for (const action of ["backup.create", "backup.download", "backup.settings", "backup.delete"]) assert.ok(actions.includes(action), action);
    });

    await t.test("pemulihan mengembalikan data persis dan menutup semua sesi", async () => {
      const { name } = await backups.createBackup("manual");
      const before = await db.prepare("SELECT id,total,discount FROM bookings WHERE id=?").get(bookingId);
      await db.prepare("UPDATE courts SET name='Diubah' WHERE id=?").run(courtId);
      await db.prepare("DELETE FROM payments WHERE booking_id=?").run(bookingId);
      const result = await backups.restoreBackup(backups.backupPath(name));
      assert.ok(result.counts.bookings >= 1);
      assert.deepEqual(await db.prepare("SELECT id,total,discount FROM bookings WHERE id=?").get(bookingId), before);
      assert.equal((await db.prepare("SELECT name FROM courts WHERE id=?").get(courtId)).name, "Lapangan Uji");
      assert.equal((await db.prepare("SELECT count(*) n FROM payments WHERE booking_id=?").get(bookingId)).n, 1);
      assert.equal((await request("/auth/me", "GET", undefined, admin)).status, 401, "sesi lama tidak berlaku setelah pemulihan");
      admin = (await request("/auth/login", "POST", { email: "admin@uji.test", password })).cookie;
      assert.equal((await request("/auth/me", "GET", undefined, admin)).status, 200);
      await assert.rejects(backups.restoreBackup(path.join(directory, "bukan-backup.json.gz")));
    });

    await t.test("rate limit login dihitung per IP pengunjung yang ditandatangani server web", async () => {
      const attempt = (ip: string, secret?: string) => request("/auth/login", "POST", { email: "admin@uji.test", password: "salah-salah" }, "", { "x-padelix-client": signed(ip, secret) });
      for (let index = 0; index < 10; index++) assert.equal((await attempt("203.0.113.7")).status, 401);
      const blocked = await attempt("203.0.113.7");
      assert.equal(blocked.status, 429, "percobaan ke-11 untuk email yang sama dari IP itu ditahan");
      assert.equal((await attempt("198.51.100.20")).status, 401, "pengunjung lain tidak ikut terkunci");
      assert.equal((await attempt("203.0.113.7", "kunci-palsu")).status, 401, "header palsu tidak dipercaya, jadi tidak memakai kuota IP itu");
      const right = await request("/auth/login", "POST", { email: "admin@uji.test", password }, "", { "x-padelix-client": signed("198.51.100.20") });
      assert.equal(right.status, 200, "login benar dari IP lain tetap bisa");
    });

    await t.test("impor SQLite: kolom diiris, foto biner utuh, menu baru ditambahkan", async () => {
      const file = path.join(directory, "lama.sqlite");
      const legacy = new DatabaseSync(file);
      legacy.exec(`
        CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        INSERT INTO migrations VALUES (16, '2026-01-01');
        CREATE TABLE users (id TEXT PRIMARY KEY, document TEXT NOT NULL);
        CREATE TABLE menus (id TEXT PRIMARY KEY, document TEXT NOT NULL);
        CREATE TABLE roles (id TEXT PRIMARY KEY, document TEXT NOT NULL);
        CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hourly_rate INTEGER NOT NULL, opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kolom_lama TEXT);
        CREATE TABLE court_photos (id TEXT PRIMARY KEY, court_id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, bytes INTEGER NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, subject_id TEXT, subject_type TEXT, expires_at INTEGER);
      `);
      const menu = (id: string, order: number) => JSON.stringify({ id, name: id, path: id === "dashboard" ? "/admin" : `/admin/${id}`, icon: "Circle", group: "Operasional", order, active: true, createdAt: stamp });
      for (const [index, id] of ["dashboard", "bookings", "courts", "users", "roles", "menus", "profile"].entries()) legacy.prepare("INSERT INTO menus VALUES (?,?)").run(id, menu(id, index));
      legacy.prepare("INSERT INTO roles VALUES ('admin', ?)").run(JSON.stringify({ id: "admin", name: "Admin", slug: "admin", description: "", menuIds: ["dashboard", "bookings"], isSystem: true, createdAt: stamp }));
      legacy.prepare("INSERT INTO users VALUES ('u1', ?)").run(JSON.stringify({ id: "u1", name: "Pemilik", email: "pemilik@lama.test", phone: "0812", passwordHash: "x", role: "admin", createdAt: stamp }));
      legacy.prepare("INSERT INTO courts VALUES ('c1','Court Lama',250000,'07:00','23:00',1,?,'Deskripsi lama','dibuang')").run(stamp);
      const photo = Buffer.from(Array.from({ length: 2048 }, (_, index) => index % 256));
      legacy.prepare("INSERT INTO court_photos VALUES ('p1','c1','image/png',?,?,0,?)").run(photo, photo.length, stamp);
      legacy.prepare("INSERT INTO audit_log VALUES (7,'u1','court.create','c1',?)").run(stamp);
      legacy.prepare("INSERT INTO sessions VALUES ('s1','u1','staff',9999999999999)").run();
      legacy.close();

      const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "src/import-sqlite.ts", file, ...args], { env: { ...process.env, DATABASE_URL: importUrl }, encoding: "utf8" });
      const first = run();
      assert.equal(first.status, 0, first.stderr + first.stdout);
      assert.match(first.stdout, /menu baru untuk admin: .*audit/);
      assert.notEqual(run().status, 0, "impor kedua ditolak tanpa --yes");
      const again = run("--yes");
      assert.equal(again.status, 0, again.stderr);

      const target = await mysql.createConnection({ uri: importUrl, dateStrings: true });
      try {
        const [[court]] = await target.query("SELECT name,description,layout_w FROM courts WHERE id='c1'") as unknown as [[{ name: string; description: string; layout_w: number }]];
        assert.deepEqual(court, { name: "Court Lama", description: "Deskripsi lama", layout_w: 100 }, "kolom TEXT ikut, kolom baru memakai nilai bawaan");
        const [[stored]] = await target.query("SELECT data FROM court_photos WHERE id='p1'") as unknown as [[{ data: Buffer }]];
        assert.ok(stored.data.equals(photo), "foto biner utuh");
        const [[log]] = await target.query("SELECT id,detail FROM audit_log") as unknown as [[{ id: number; detail: string | null }]];
        assert.deepEqual(log, { id: 7, detail: null });
        const [[sessions]] = await target.query("SELECT count(*) n FROM sessions") as unknown as [[{ n: number }]];
        assert.equal(sessions.n, 0, "sesi lama tidak diimpor");
        const [menus] = await target.query("SELECT id FROM menus ORDER BY seq") as unknown as [{ id: string }[]];
        assert.deepEqual(menus.slice(0, 7).map(row => row.id), ["dashboard", "bookings", "courts", "users", "roles", "menus", "profile"], "urutan menu lama dipertahankan");
        const [[role]] = await target.query("SELECT document FROM roles WHERE id='admin'") as unknown as [[{ document: string }]];
        const menuIds = (JSON.parse(role.document) as { menuIds: string[] }).menuIds;
        assert.ok(menuIds.includes("audit") && menuIds.includes("backups") && menuIds.includes("bookings"));
        assert.ok(!menuIds.includes("courts"), "akses yang sengaja tidak diberikan tetap tidak diberikan");
        const [[accounts]] = await target.query("SELECT count(*) n FROM accounts") as unknown as [[{ n: number }]];
        assert.equal(accounts.n, 0, "data bawaan MySQL diganti isi SQLite, bukan dicampur");
      } finally { await target.end(); }

      const old = new DatabaseSync(path.join(directory, "versi-lama.sqlite"));
      old.exec("CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO migrations VALUES (9,'x');");
      old.close();
      const tooOld = spawnSync(process.execPath, ["--import", "tsx", "src/import-sqlite.ts", path.join(directory, "versi-lama.sqlite"), "--yes"], { env: { ...process.env, DATABASE_URL: importUrl }, encoding: "utf8" });
      assert.notEqual(tooOld.status, 0);
      assert.match(tooOld.stderr, /versi 9/);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + "padelix-database-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
