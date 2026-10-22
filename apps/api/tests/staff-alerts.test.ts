import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-staff-alert-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("staff_alerts");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
for (const name of ["MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "SMTP_HOST", "WHATSAPP_PROVIDER"]) delete process.env[name];

const serverKey = "SB-Mid-server-lonceng123";
const signature = (orderId: string, statusCode: string, grossAmount: string) => createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  if (!String(input).includes("midtrans.com")) return realFetch(input, init);
  const body = String(input).includes("/snap/v1/transactions") ? { token: "tok-uji", redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-uji" } : { status_code: "404" };
  return new Response(JSON.stringify(body), { status: String(input).includes("/snap/") ? 201 : 404, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");
const { queueUnreturnedAlerts, queueMemberReminders } = await import("../src/notifications.js");
const { pruneStaffNotifications } = await import("../src/staff-alerts.js");

test("notifikasi staf: lonceng panel admin, penyaring per role, dan status dibaca per pengguna", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const day = (offset: number) => { const value = new Date(localClock().date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  type Item = { id: string; event: string; title: string; body: string; link: string; tone: string; read: boolean };
  const bell = async (cookie: string, query = "") => (await request(`/profile/notifications${query}`, "GET", undefined, cookie)).data as { items: Item[]; unread: number; more: boolean; events: string[] };
  let admin = "", staff = "", courtId = "", raket = "", bookingId = "";

  try {
    await t.test("penyiapan", async () => {
      admin = (await request("/auth/register", "POST", { name: "Pemilik", email: "pemilik@lonceng.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir", email: "kasir@lonceng.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@lonceng.test", password: "StrongPass123" })).cookie;
      courtId = (await request("/operations/courts", "POST", { name: "Court Lonceng", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin)).data.court.id;
      raket = (await request("/operations/addons", "POST", { name: "Sewa raket", category: "raket", type: "sewa", pricing: "per_booking", price: 40000, stock: 5, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin)).data.addon.id;
      assert.equal((await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-lonceng", server_key: serverKey, mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin)).status, 200);
      assert.equal((await request("/profile/notifications")).status, 401, "lonceng butuh login staf");
      const empty = await bell(admin);
      assert.equal(empty.unread, 0);
      assert.deepEqual(empty.items, []);
    });

    await t.test("booking online yang dibayar muncul di lonceng semua staf yang punya menu Booking", async () => {
      const created = await request("/public/checkout", "POST", { items: [{ court_id: courtId, date: day(2), start_time: "10:00", end_time: "11:00", addons: [] }], customer: "Rina", phone: "0812 7777 8888", email: "", notes: "" });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.equal((await bell(admin)).unread, 0, "pesanan yang belum dibayar belum dikabarkan");
      const notify = (amount: number) => ({ order_id: created.data.transaction_id, status_code: "200", gross_amount: `${amount}.00`, signature_key: signature(created.data.transaction_id, "200", `${amount}.00`), transaction_status: "settlement", fraud_status: "accept", transaction_id: "trx-lonceng", payment_type: "qris" });
      assert.equal((await request("/public/payments/midtrans/notification", "POST", notify(created.data.amount))).status, 200);
      assert.equal((await request("/public/payments/midtrans/notification", "POST", notify(created.data.amount))).status, 200, "webhook ganda");
      for (const cookie of [admin, staff]) {
        const view = await bell(cookie);
        assert.equal(view.unread, 1, "satu notifikasi walau webhook datang dua kali");
        assert.equal(view.items[0].event, "booking_new");
        assert.equal(view.items[0].tone, "success");
        assert.match(view.items[0].title, /Booking online baru: Rina/);
        assert.match(view.items[0].body, /Court Lonceng/);
        bookingId = view.items[0].link.split("booking=")[1];
        assert.ok(bookingId);
      }
      assert.equal((await request(`/operations/bookings/${bookingId}`, "GET", undefined, admin)).status, 200, "tautan menuju booking yang benar");
    });

    await t.test("aksi staf: pelakunya tidak menerima notifikasinya sendiri", async () => {
      const booked = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Budi", phone: "081299998888", date: day(3), start_time: "08:00", end_time: "09:00" }, admin);
      assert.equal(booked.status, 201);
      assert.equal((await request(`/operations/bookings/${booked.data.booking.id}/payments`, "POST", { id: randomUUID(), amount: 100000, kind: "payment", method: "cash", note: "DP" }, staff)).status, 201);
      assert.equal((await request(`/operations/bookings/${booked.data.booking.id}/status`, "PATCH", { status: "cancelled", reason: "Hujan deras" }, staff)).status, 200);
      const owner = await bell(admin);
      assert.deepEqual(owner.items.map(item => item.event), ["cancelled", "payment_in", "booking_new"]);
      assert.match(owner.items[0].title, /Booking Budi dibatalkan/);
      assert.match(owner.items[0].body, /Hujan deras/);
      assert.match(owner.items[0].body, /periksa pengembaliannya/);
      assert.match(owner.items[1].title, /Pembayaran Rp100\.000 dari Budi/);
      const cashier = await bell(staff);
      assert.deepEqual(cashier.items.map(item => item.event), ["booking_new"], "kasir tidak melihat aksinya sendiri");
    });

    await t.test("tandai dibaca per pengguna: satu id atau semuanya", async () => {
      const owner = await bell(admin);
      const one = await request("/profile/notifications/read", "POST", { ids: [owner.items[0].id] }, admin);
      assert.equal(one.data.unread, 2);
      assert.equal((await bell(staff)).unread, 1, "status dibaca tidak memengaruhi staf lain");
      assert.equal((await bell(admin, "?unread=1")).items.length, 2, "saring yang belum dibaca");
      assert.equal((await request("/profile/notifications/read", "POST", {}, admin)).data.unread, 0);
      assert.equal((await request("/profile/notifications/unread", "GET", undefined, admin)).data.unread, 0);
      assert.ok((await bell(admin)).items.every(item => item.read));
    });

    await t.test("barang sewa lewat jam kembali dikabarkan sekali", async () => {
      const booked = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Sari", phone: "081211112222", date: day(1), start_time: "07:00", end_time: "08:00", addons: [{ addon_id: raket, quantity: 2 }] }, admin);
      assert.equal(booked.status, 201, JSON.stringify(booked.data));
      assert.equal(await queueUnreturnedAlerts(), 0, "jadwal belum dimulai");
      await db.prepare("UPDATE bookings SET date=? WHERE id=?").run(day(-1), booked.data.booking.id);
      assert.equal(await queueUnreturnedAlerts(), 1);
      assert.equal(await queueUnreturnedAlerts(), 0, "tidak dobel");
      const view = await bell(staff);
      assert.equal(view.items[0].event, "rental_unreturned");
      assert.match(view.items[0].title, /Barang sewa Sari belum kembali/);
      assert.match(view.items[0].body, /2× Sewa raket/);
      assert.equal(view.items[0].link, `/admin/bookings?tab=belum-kembali&booking=${booked.data.booking.id}`);
    });

    await t.test("pengaturan per role: hanya menu Notifikasi, dan hanya peristiwa yang menunya dimiliki role", async () => {
      assert.equal((await request("/operations/notifications/staff", "GET", undefined, staff)).status, 403);
      const current = await request("/operations/notifications/staff", "GET", undefined, admin);
      assert.equal(current.status, 200);
      const operator = current.data.roles.find((role: { id: string }) => role.id === "staff");
      assert.ok(!operator.allowed.includes("member"), "Operator tidak punya menu Member");
      assert.ok(operator.events.includes("booking_new"), "bawaan: semua yang bisa diakses");
      assert.equal(current.data.roles.find((role: { id: string }) => role.id === "admin").events.length, 6);
      assert.equal((await request("/operations/notifications/staff", "PUT", { roles: { tidakada: [] } }, admin)).status, 400);
      const saved = await request("/operations/notifications/staff", "PUT", { roles: { staff: ["rental_unreturned", "member"] } }, admin);
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.data.roles.find((role: { id: string }) => role.id === "staff").events, ["rental_unreturned"], "peristiwa tanpa akses menu tidak berlaku");
      const view = await bell(staff);
      assert.deepEqual(view.items.map(item => item.event), ["rental_unreturned"]);
      assert.deepEqual(view.events, ["rental_unreturned"]);
    });

    await t.test("member segera berakhir untuk role dengan menu Member", async () => {
      const plan = randomUUID(), member = randomUUID(), stamp = new Date().toISOString();
      await db.prepare("INSERT INTO membership_plans (id,name,price,duration_months,court_discount,position,created_at) VALUES (?,?,?,?,?,0,?)").run(plan, "Gold", 300000, 1, 1000, stamp);
      await db.prepare("INSERT INTO memberships (id,code,plan_id,name,phone,status,source,starts_on,ends_on,created_at) VALUES (?,?,?,?,?,'active','staff',?,?,?)").run(member, "MBR-0001", plan, "Dewi", "6281200001111", day(-25), day(3), stamp);
      await queueMemberReminders();
      const view = await bell(admin);
      assert.equal(view.items[0].event, "member");
      assert.match(view.items[0].title, /Member Dewi segera berakhir/);
      assert.equal(view.items[0].link, "/admin/member");
      assert.ok(!(await bell(staff)).items.some(item => item.event === "member"));
    });

    await t.test("notifikasi lama dibersihkan", async () => {
      await db.prepare("UPDATE staff_notifications SET created_at=?").run(new Date(Date.now() - 100 * 86400000).toISOString());
      assert.ok(await pruneStaffNotifications() > 0);
      assert.equal(Number((await db.prepare("SELECT count(*) n FROM staff_notification_reads").get() as { n: number }).n), 0, "status dibaca ikut terhapus");
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
