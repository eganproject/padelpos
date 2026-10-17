import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-reschedule-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("reschedule");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
delete process.env.SMTP_HOST;

/** Server SMTP tiruan secukupnya untuk nodemailer: menyimpan setiap pesan yang diterima. */
const inbox: { from: string; to: string[]; data: string }[] = [];
const smtp = createServer((socket: Socket) => {
  let buffer = "", reading = false, mail = { from: "", to: [] as string[], data: "" };
  socket.write("220 uji ESMTP\r\n");
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (true) {
      if (reading) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        mail.data = buffer.slice(0, end); buffer = buffer.slice(end + 5); reading = false;
        inbox.push(mail); mail = { from: "", to: [], data: "" };
        socket.write("250 diterima\r\n");
        continue;
      }
      const end = buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const command = line.slice(0, 4).toUpperCase();
      if (command === "EHLO" || command === "HELO") socket.write("250-uji\r\n250 8BITMIME\r\n");
      else if (command === "MAIL") { mail.from = line; socket.write("250 ok\r\n"); }
      else if (command === "RCPT") { mail.to.push(line); socket.write("250 ok\r\n"); }
      else if (command === "DATA") { reading = true; socket.write("354 lanjut\r\n"); }
      else if (command === "QUIT") { socket.end("221 bye\r\n"); return; }
      else socket.write("250 ok\r\n");
    }
  });
});
await new Promise<void>(resolve => smtp.listen(0, "127.0.0.1", resolve));
const smtpPort = (smtp.address() as { port: number }).port;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");
const { deliverDue, queueReminders } = await import("../src/notifications.js");

test("pindah jadwal, notifikasi email, dan daftar booking per rentang", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const day = (offset: number) => { const value = new Date(localClock().date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10); };
  const [d2, d3] = [day(2), day(3)];
  let admin = "", staff = "", courtA = "", courtB = "", raket = "", bookingId = "";
  const outbox = async (kind: string) => await db.prepare("SELECT recipient,subject,text,status FROM email_outbox WHERE kind=? ORDER BY created_at").all(kind) as { recipient: string; subject: string; text: string; status: string }[];

  try {
    await t.test("penyiapan: admin, operator, dua lapangan, raket sewa, dan SMTP", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Jadwal", email: "admin@jadwal.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Operator Jadwal", email: "staff@jadwal.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "staff@jadwal.test", password: "StrongPass123" })).cookie;
      courtA = (await request("/operations/courts", "POST", { name: "Court A", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin)).data.court.id;
      courtB = (await request("/operations/courts", "POST", { name: "Court B", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true }, admin)).data.court.id;
      raket = (await request("/operations/addons", "POST", { name: "Raket", category: "raket", type: "sewa", pricing: "per_hour", price: 20000, stock: 2, low_stock: 0, max_per_booking: 2, description: "", active: true, online: true }, admin)).data.addon.id;

      assert.equal((await request("/operations/notifications", "GET", undefined, staff)).status, 403, "operator tanpa menu Notifikasi Email ditolak");
      assert.equal((await request("/operations/notifications/settings", "PUT", { enabled: true }, admin)).status, 409, "tidak bisa aktif tanpa server SMTP");
      const saved = await request("/operations/notifications/settings", "PUT", {
        enabled: true, host: "127.0.0.1", port: smtpPort, user: "booking@venue.test", password: "rahasia-smtp", from_name: "Venue Uji",
        from_email: "booking@venue.test", staff_recipients: ["Kasir@Venue.test"], reminder_hours: 24,
      }, admin);
      assert.equal(saved.status, 200);
      assert.equal(saved.data.settings.ready, true);
      assert.equal(saved.data.settings.password_set, true);
      assert.ok(!JSON.stringify(saved.data).includes("rahasia-smtp"), "password SMTP tidak pernah dikirim ke browser");
      assert.deepEqual(saved.data.settings.staff_recipients, ["kasir@venue.test"]);
      const kept = await request("/operations/notifications/settings", "PUT", { ...saved.data.settings, password: "" }, admin);
      assert.equal(kept.data.settings.password_set, true, "password kosong berarti password lama dipertahankan");
      const menu = await request("/auth/navigation", "GET", undefined, admin);
      assert.ok(menu.data.menus.some((item: { id: string; group: string }) => item.id === "notifications" && item.group === "Pengaturan"));
    });

    await t.test("email uji terkirim langsung lewat SMTP", async () => {
      const sent = await request("/operations/notifications/test", "POST", { to: "pemilik@venue.test" }, admin);
      assert.equal(sent.status, 200, JSON.stringify(sent.data));
      const mail = inbox.at(-1)!;
      assert.match(mail.to.join(), /pemilik@venue\.test/);
      assert.match(mail.data, /Subject: Email uji/);
    });

    await t.test("staf memindah booking: harga, tambahan per jam, dan jurnal ikut jadwal baru", async () => {
      const created = await request("/operations/bookings", "POST", { court_id: courtA, customer: "Sinta", phone: "081200000001", email: "Sinta@Contoh.test", date: d2, start_time: "10:00", end_time: "11:00", addons: [{ addon_id: raket, quantity: 2 }] }, staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bookingId = created.data.booking.id;
      assert.equal(created.data.booking.total, 240000, "sewa 200.000 + 2 raket x 20.000");
      assert.equal(created.data.booking.email, "sinta@contoh.test");
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", { id: randomUUID(), amount: 100000, kind: "payment", method: "cash", note: "" }, staff)).status, 201);

      // Booking lain memakai Court B pukul 18:00 dan dua raket pukul 20:00.
      assert.equal((await request("/operations/bookings", "POST", { court_id: courtB, customer: "Lain", phone: "081200000002", date: d3, start_time: "18:00", end_time: "19:00" }, staff)).status, 201);
      assert.equal((await request("/operations/bookings", "POST", { court_id: courtA, customer: "Raket Habis", phone: "081200000003", date: d3, start_time: "20:00", end_time: "21:00", addons: [{ addon_id: raket, quantity: 2 }] }, staff)).status, 201);

      const move = (body: object, cookie = staff) => request(`/operations/bookings/${bookingId}/reschedule`, "POST", body, cookie);
      assert.equal((await move({ court_id: courtB, date: d3, start_time: "18:30", end_time: "20:00" })).status, 409, "bentrok dengan booking lain ditolak");
      const noRacket = await move({ court_id: courtB, date: d3, start_time: "20:00", end_time: "21:00" });
      assert.equal(noRacket.status, 409, "raket di jam baru sudah dipakai booking lain");
      assert.match(noRacket.data.message, /Raket/);
      assert.equal((await move({ court_id: courtA, date: d2, start_time: "10:00", end_time: "11:00" })).status, 400, "jadwal yang sama ditolak");
      assert.equal((await move({ court_id: courtA, date: day(-1), start_time: "10:00", end_time: "11:00" })).status, 400, "tidak boleh ke masa lalu");

      const moved = await move({ court_id: courtB, date: d3, start_time: "08:00", end_time: "09:30" });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      const booking = moved.data.booking;
      assert.deepEqual([booking.court_id, booking.date, booking.start_time, booking.end_time], [courtB, d3, "08:00", "09:30"]);
      assert.equal(booking.court_total, 450000, "1,5 jam x tarif Court B");
      assert.equal(booking.total, 510000, "raket per jam ikut 1,5 jam: 2 x 20.000 x 1,5");
      assert.equal(booking.paid, 100000, "pembayaran ikut pindah");
      assert.equal(booking.reschedule_count, 1);
      const detail = await request(`/operations/bookings/${bookingId}`, "GET", undefined, staff);
      assert.equal(detail.data.addons[0].subtotal, 60000);
      const entry = await db.prepare("SELECT date FROM journal_entries WHERE source='booking' AND ref_id=?").get(bookingId) as { date: string };
      assert.equal(entry.date, d3, "pendapatan diakui pada tanggal main yang baru");
      const piutang = await db.prepare("SELECT SUM(l.debit) debit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.source='booking' AND e.ref_id=?").get(bookingId) as { debit: number };
      assert.equal(piutang.debit, 510000);

      const mail = await outbox("reschedule");
      assert.equal(mail.length, 1);
      assert.equal(mail[0].recipient, "sinta@contoh.test");
      assert.match(mail[0].text, /Court A/); assert.match(mail[0].text, /Court B/);
      assert.match(mail[0].text, /Sisa tagihan: Rp410\.000/);
      assert.equal((await outbox("staff_new")).length, 0, "pemindahan oleh staf tidak mengirim email ke staf");

      // Slot lama terbuka lagi, slot baru terisi.
      const free = await request("/operations/bookings", "POST", { court_id: courtA, customer: "Pengisi", phone: "081200000004", date: d2, start_time: "10:00", end_time: "11:00" }, staff);
      assert.equal(free.status, 201, "slot lama dapat dipesan orang lain");
      assert.equal((await request("/operations/bookings", "POST", { court_id: courtB, customer: "Telat", phone: "081200000005", date: d3, start_time: "08:30", end_time: "09:00" }, staff)).status, 409);
    });

    await t.test("pindah ke slot lebih murah memunculkan kelebihan bayar untuk dikembalikan", async () => {
      const created = await request("/operations/bookings", "POST", { court_id: courtB, customer: "Lunas", phone: "081200000006", date: d2, start_time: "14:00", end_time: "15:00" }, staff);
      const id = created.data.booking.id;
      await request(`/operations/bookings/${id}/payments`, "POST", { id: randomUUID(), amount: 300000, kind: "payment", method: "transfer", note: "" }, staff);
      const moved = await request(`/operations/bookings/${id}/reschedule`, "POST", { court_id: courtA, date: d2, start_time: "14:00", end_time: "15:00" }, staff);
      assert.equal(moved.status, 200);
      assert.equal(moved.data.booking.total, 200000);
      const refund = await request(`/operations/bookings/${id}/payments`, "POST", { id: randomUUID(), amount: 100000, kind: "refund", method: "transfer", note: "Selisih pindah lapangan" }, staff);
      assert.equal(refund.status, 201, "kelebihan bayar dapat dikembalikan lewat refund biasa");
    });

    await t.test("pelanggan memindah booking miliknya sendiri sesuai kebijakan venue", async () => {
      const accountId = randomUUID(), token = randomBytes(32).toString("hex"), stamp = new Date().toISOString();
      await db.prepare("INSERT INTO customer_accounts (id,firebase_uid,email,name,phone,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)").run(accountId, "uid-rina", "rina@gmail.test", "Rina", "6281200000007", stamp, stamp);
      await db.prepare("INSERT INTO sessions (id,subject_id,subject_type,expires_at) VALUES (?,?,?,?)").run(createHash("sha256").update(token).digest("hex"), accountId, "customer", Date.now() + 3600000);
      const rina = `padelix_customer=${token}`;
      const own = await request("/operations/bookings", "POST", { court_id: courtA, customer: "Rina", phone: "081200000007", date: d2, start_time: "16:00", end_time: "17:00" }, staff);
      const ownId = own.data.booking.id;
      await db.prepare("UPDATE bookings SET account_id=? WHERE id=?").run(accountId, ownId);
      const move = (id: string, body: object) => request(`/customer/bookings/${id}/reschedule`, "POST", body, rina);
      const target = { court_id: courtA, date: d3, start_time: "16:00", end_time: "17:00" };

      assert.equal((await request(`/customer/bookings/${ownId}/reschedule`, "POST", target)).status, 401, "harus masuk");
      assert.equal((await move(ownId, target)).status, 403, "kebijakan belum mengizinkan");
      let list = await request("/customer/bookings?scope=upcoming", "GET", undefined, rina);
      assert.equal(list.data.items[0].reschedule.allowed, false);

      assert.equal((await request("/operations/content/policies", "PUT", { reschedule: "yes", reschedule_hours: 12 }, admin)).status, 200);
      list = await request("/customer/bookings?scope=upcoming", "GET", undefined, rina);
      assert.equal(list.data.items[0].reschedule.allowed, true);
      assert.equal((await move(bookingId, target)).status, 404, "booking orang lain tidak dapat disentuh");
      assert.equal((await move(ownId, { ...target, end_time: "18:00" })).status, 400, "durasi harus sama");

      const moved = await move(ownId, target);
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      assert.equal(moved.data.booking.date, d3);
      assert.equal(moved.data.booking.reschedule.allowed, false);
      assert.equal((await move(ownId, { ...target, start_time: "17:00", end_time: "18:00" })).status, 409, "pelanggan hanya boleh sekali");
      assert.equal((await outbox("reschedule")).at(-1)!.recipient, "rina@gmail.test", "tanpa email isian staf, email akun Google yang dipakai");
      assert.equal((await outbox("staff_new")).at(-1)!.recipient, "kasir@venue.test", "staf diberi tahu saat pelanggan sendiri yang memindah");
    });

    await t.test("pembatalan dan pengingat masuk antrean sekali saja, lalu terkirim", async () => {
      const soon = localClock(new Date(Date.now() + 3 * 3600000));
      const later = localClock(new Date(Date.now() + 4 * 3600000));
      if (soon.date === later.date && soon.time < later.time && soon.time >= "06:00") {
        const start = soon.time.slice(0, 3) + (soon.time.slice(3) < "30" ? "30" : "00");
        const startHour = soon.time.slice(3) < "30" ? soon.time.slice(0, 2) : String(Number(soon.time.slice(0, 2)) + 1).padStart(2, "0");
        const begin = `${startHour}:${start.slice(3)}`, end = `${String(Number(startHour) + 1).padStart(2, "0")}:${start.slice(3)}`;
        if (end <= "23:00") {
          const created = await request("/operations/bookings", "POST", { court_id: courtA, customer: "Dekat", phone: "081200000008", email: "dekat@contoh.test", date: soon.date, start_time: begin, end_time: end }, staff);
          assert.equal(created.status, 201, JSON.stringify(created.data));
          assert.ok(await queueReminders() >= 1);
          assert.equal(await queueReminders(), 0, "pengingat tidak dobel");
          assert.ok((await outbox("reminder")).some(mail => mail.recipient === "dekat@contoh.test"));
        }
      }
      const cancelled = await request(`/operations/bookings/${bookingId}/status`, "PATCH", { status: "cancelled", reason: "Lampu lapangan rusak" }, staff);
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
      const mail = await outbox("cancelled");
      assert.equal(mail.length, 1);
      assert.match(mail[0].text, /Lampu lapangan rusak/);
      assert.match(mail[0].text, /Pembayaran diterima: Rp100\.000/);

      const result = await deliverDue(100);
      assert.ok(result.sent >= 3, JSON.stringify(result));
      assert.equal(result.failed, 0);
      assert.ok(inbox.some(item => item.to.join().includes("sinta@contoh.test") && /dibatalkan/.test(item.data)));
      const queue = await request("/operations/notifications", "GET", undefined, admin);
      assert.equal(queue.data.outbox.counts.pending ?? 0, 0);
      assert.ok(queue.data.outbox.items.every((item: { status: string; text?: string }) => item.status === "sent" && item.text === undefined), "isi email tidak dikirim ke panel");
    });

    await t.test("SMTP gagal: dicoba ulang, lalu dapat dikirim ulang dari panel", async () => {
      await request("/operations/notifications/settings", "PUT", { enabled: true, host: "127.0.0.1", port: 1, from_email: "booking@venue.test", staff_recipients: [] }, admin);
      const created = await request("/operations/bookings", "POST", { court_id: courtB, customer: "Gagal", phone: "081200000009", email: "gagal@contoh.test", date: d3, start_time: "21:00", end_time: "22:00" }, staff);
      await request(`/operations/bookings/${created.data.booking.id}/status`, "PATCH", { status: "cancelled", reason: "Uji gagal kirim" }, staff);
      const first = await deliverDue();
      assert.equal(first.failed, 1);
      const row = await db.prepare("SELECT id,status,attempts,last_error FROM email_outbox WHERE recipient='gagal@contoh.test'").get() as { id: string; status: string; attempts: number; last_error: string };
      assert.equal(row.status, "pending"); assert.equal(row.attempts, 1); assert.ok(row.last_error);
      assert.equal((await deliverDue()).failed, 0, "belum jatuh tempo, tidak dicoba lagi");
      await db.prepare("UPDATE email_outbox SET status='failed' WHERE id=?").run(row.id);
      await request("/operations/notifications/settings", "PUT", { enabled: true, host: "127.0.0.1", port: smtpPort, from_email: "booking@venue.test", staff_recipients: [] }, admin);
      assert.equal((await request(`/operations/notifications/${row.id}/retry`, "POST", {}, admin)).status, 200);
      await deliverDue();
      assert.equal((await db.prepare("SELECT status FROM email_outbox WHERE id=?").get(row.id) as { status: string }).status, "sent");
    });

    await t.test("daftar booking per rentang, pencarian, dan dashboard tanpa membaca seluruh riwayat", async () => {
      await db.prepare("INSERT INTO bookings (id,court_id,customer,phone,date,start_time,end_time,total,court_total,status,source,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,'completed','staff',?,?)")
        .run(randomUUID(), courtA, "Arsip Lama", "081299999999", day(-200), "10:00", "11:00", 200000, 200000, "x", new Date().toISOString());
      const recent = await request("/operations/bookings?window=recent", "GET", undefined, staff);
      assert.equal(recent.status, 200);
      assert.ok(!recent.data.bookings.some((b: { customer: string }) => b.customer === "Arsip Lama"), "bawaan panel tidak memuat riwayat lama");
      const search = await request("/operations/bookings?window=recent&q=arsip", "GET", undefined, staff);
      assert.equal(search.data.bookings.length, 1, "pencarian menembus rentang bawaan");
      assert.equal((await request(`/operations/bookings?q=${encodeURIComponent("100%")}`, "GET", undefined, staff)).data.bookings.length, 0, "tanda persen dicari apa adanya");
      const byDate = await request(`/operations/bookings?date=${d2}&status=confirmed`, "GET", undefined, staff);
      assert.ok(byDate.data.bookings.every((b: { date: string; status: string }) => b.date === d2 && b.status === "confirmed"));
      const limited = await request("/operations/bookings?limit=1", "GET", undefined, staff);
      assert.equal(limited.data.bookings.length, 1); assert.equal(limited.data.truncated, true);

      const summary = await request("/dashboard/summary", "GET", undefined, admin);
      assert.equal(summary.status, 200);
      assert.equal(summary.data.daily.length, 7);
      const expected = (await db.prepare(`SELECT b.*,COALESCE((SELECT SUM(CASE kind WHEN 'payment' THEN amount ELSE -amount END) FROM payments WHERE booking_id=b.id),0) paid FROM bookings b`).all() as { status: string; total: number; paid: number; forfeited: number }[])
        .reduce((sum, b) => sum + (b.status === "confirmed" || b.status === "completed" ? Math.max(0, b.total - b.paid) : 0), 0);
      assert.equal(summary.data.receivable, expected);
      assert.equal(summary.data.revenueWeek, 100000 + 300000 - 100000, "pembayaran dan refund minggu ini");
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    smtp.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
