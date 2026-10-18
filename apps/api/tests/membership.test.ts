import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-member-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("membership");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.MIDTRANS_CLIENT_KEY;

const serverKey = "SB-Mid-server-member123";
const signature = (orderId: string, statusCode: string, grossAmount: string) =>
  createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");
/** Midtrans diganti stub: tidak ada permintaan jaringan selama uji. */
const snaps: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (!url.includes("midtrans.com")) return realFetch(input, init);
  if (url.includes("/snap/v1/transactions")) {
    snaps.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ token: `tok-${snaps.length}`, redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-${snaps.length}` }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ status_code: "404" }), { status: 404, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock, shiftDate, shiftMonths } = await import("../src/clock.js");
const { queueMemberReminders } = await import("../src/notifications.js");

test("member berbayar: paket, pendaftaran, harga member, perpanjangan, pembatalan, dan pembukuannya", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const today = localClock().date, tomorrow = shiftDate(today, 1);
  const yearEnd = shiftDate(shiftMonths(today, 12), -1);
  let admin = "", staff = "", courtId = "", racketId = "", goldId = "", silverId = "", budiId = "";
  /** Saldo akun sistem dari jurnal sampai tanggal itu, dengan tanda normal akunnya. */
  async function balance(key: string, to = today, from = "0000-01-01") {
    const row = await db.prepare(`SELECT a.type,
        (SELECT COALESCE(SUM(l.debit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=a.id AND e.date BETWEEN ? AND ?) debit,
        (SELECT COALESCE(SUM(l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=a.id AND e.date BETWEEN ? AND ?) credit
      FROM accounts a WHERE a.system_key=?`).get(from, to, from, to, key) as { type: string; debit: number; credit: number };
    return row.type === "aset" || row.type === "beban" ? Number(row.debit) - Number(row.credit) : Number(row.credit) - Number(row.debit);
  }
  async function customer(name: string, phone: string) {
    const id = randomUUID(), token = randomBytes(16).toString("hex"), stamp = new Date().toISOString();
    await db.prepare("INSERT INTO customer_accounts (id,firebase_uid,email,name,phone,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)").run(id, `uid-${id}`, `${name.toLowerCase()}@gmail.test`, name, phone, stamp, stamp);
    await db.prepare("INSERT INTO sessions (id,subject_id,subject_type,expires_at) VALUES (?,?,'customer',?)").run(createHash("sha256").update(token).digest("hex"), id, Date.now() + 3600000);
    return { id, cookie: `padelix_customer=${token}` };
  }
  const webhook = (orderId: string, amount: number, status = "settlement") => ({
    order_id: orderId, status_code: "200", gross_amount: `${amount}.00`, signature_key: signature(orderId, "200", `${amount}.00`),
    transaction_status: status, fraud_status: "accept", transaction_id: `trx-${orderId}`, payment_type: "qris",
  });
  const booking = (start: string, end: string, extra = {}) => ({ court_id: courtId, customer: "Budi Member", phone: "081300000001", date: tomorrow, start_time: start, end_time: end, notes: "", ...extra });

  try {
    await t.test("migrasi: akun sistem, menu Member untuk admin, dan operator tanpa akses panel member", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Member", email: "admin@member.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      assert.equal((await request("/access/users", "POST", { name: "Kasir", email: "kasir@member.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "kasir@member.test", password: "StrongPass123" })).cookie;
      const keys = (await db.prepare("SELECT system_key FROM accounts WHERE system_key IN ('pendapatan_keanggotaan','potongan_member','pendapatan_dimuka')").all() as { system_key: string }[]).map(row => row.system_key).sort();
      assert.deepEqual(keys, ["pendapatan_dimuka", "pendapatan_keanggotaan", "potongan_member"]);
      const navigation = await request("/auth/navigation", "GET", undefined, admin);
      assert.ok(navigation.data.menus.some((menu: { id: string; path: string }) => menu.id === "members" && menu.path === "/admin/member"), "menu Member tampil untuk admin");
      assert.equal((await request("/operations/members", "GET", undefined, staff)).status, 403, "operator bawaan tidak membuka panel member");
      assert.equal((await request("/operations/members/lookup?q=budi", "GET", undefined, staff)).status, 200, "tetapi kasir bisa mencari member saat booking");

      const court = await request("/operations/courts", "POST", { name: "Court Member", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      courtId = court.data.court.id;
      const racket = await request("/operations/addons", "POST", { name: "Raket member", category: "raket", type: "sewa", pricing: "per_booking", price: 50000, stock: null, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin);
      assert.equal(racket.status, 201); racketId = racket.data.addon.id;
      assert.equal((await request("/operations/payments/settings", "PUT", { enabled: true, environment: "sandbox", client_key: "SB-Mid-client-member", server_key: serverKey, mode: "full", dp_percent: 50, hold_minutes: 20, note: "" }, admin)).status, 200);
      assert.equal((await request("/operations/notifications/settings", "PUT", { enabled: true, host: "127.0.0.1", port: 2525, from_email: "member@venue.test", staff_recipients: ["kasir@venue.test"] }, admin)).status, 200);
    });

    await t.test("paket: diskon dalam persen disimpan sebagai basis poin dan divalidasi", async () => {
      const invalid = await request("/operations/members/plans", "POST", { name: "Salah", price: 100000, duration_months: 1, court_discount: 120 }, admin);
      assert.equal(invalid.status, 400);
      const gold = await request("/operations/members/plans", "POST", { name: "Gold", description: "Tahunan", price: 1200000, registration_fee: 100000, duration_months: 12, court_discount: 20, addon_discount: 10 }, admin);
      assert.equal(gold.status, 201); goldId = gold.data.plan.id;
      assert.equal(gold.data.plan.court_discount, 2000);
      assert.equal(gold.data.plan.addon_discount, 1000);
      const silver = await request("/operations/members/plans", "POST", { name: "Silver", price: 300000, duration_months: 1, court_discount: 10, online: false }, admin);
      silverId = silver.data.plan.id;
      assert.equal((await request("/operations/members/plans", "POST", { name: "gold", price: 1000, duration_months: 1, court_discount: 0 }, admin)).status, 409, "nama paket unik tanpa peduli huruf besar");
      const guest = await request("/public/membership");
      assert.deepEqual(guest.data.plans.map((plan: { name: string }) => plan.name), ["Gold"], "paket yang tidak dijual online tidak tampil");
    });

    await t.test("kasir mendaftarkan member lunas: aktif setahun dan iurannya dijurnal sebagai diterima di muka", async () => {
      const created = await request("/operations/members", "POST", { plan_id: goldId, name: "Budi Member", phone: "0813-0000-0001", email: "budi@contoh.test", method: "cash" }, admin);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      budiId = created.data.member.id;
      assert.equal(created.data.member.state, "active");
      assert.equal(created.data.member.starts_on, today);
      assert.equal(created.data.member.ends_on, yearEnd);
      assert.match(created.data.member.code, /^MBR-[A-Z2-9]{6}$/);
      assert.equal(created.data.invoices[0].amount, 1300000, "iuran ditambah biaya daftar");
      assert.equal(created.data.invoices[0].status, "paid");
      assert.equal(await balance("kas"), 1300000);
      assert.equal(await balance("pendapatan_dimuka", shiftDate(today, -1)), 0);
      // Hari ini: biaya daftar dan iuran bulan pertama sudah diakui, sisanya 11 bulan masih kewajiban.
      assert.equal(await balance("pendapatan_keanggotaan"), 200000);
      assert.equal(await balance("pendapatan_dimuka"), 1100000);
      assert.equal(await balance("pendapatan_dimuka", yearEnd), 0, "habis diakui di akhir masa berlaku");
      assert.equal(await balance("pendapatan_keanggotaan", yearEnd), 1300000);
      const entries = await db.prepare("SELECT count(*) n FROM journal_entries WHERE source='keanggotaan'").get() as { n: number };
      assert.equal(Number(entries.n), 13, "satu penerimaan dan dua belas pengakuan bulanan");
      const neraca = await request(`/operations/finance/reports/neraca?as_of=${today}`, "GET", undefined, admin);
      assert.equal(neraca.data.difference, 0);
      assert.ok(neraca.data.liabilities.some((row: { name: string; amount: number }) => row.name === "Pendapatan Diterima di Muka" && row.amount === 1100000));

      const twin = await request("/operations/members", "POST", { plan_id: silverId, name: "Budi Lain", phone: "081300000001", method: null }, admin);
      assert.equal(twin.status, 409);
      assert.match(twin.data.message, /sudah terdaftar sebagai member/);
    });

    let bookingId = "";
    await t.test("booking kasir dengan member: potongan lapangan dan tambahan, jurnalnya terpisah dari potongan manual", async () => {
      const found = await request(`/operations/members/lookup?q=0813000&date=${tomorrow}`, "GET", undefined, staff);
      assert.equal(found.data.members.length, 1);
      assert.equal(found.data.members[0].valid, true);
      const created = await request("/operations/bookings", "POST", booking("10:00", "12:00", { membership_id: budiId, addons: [{ addon_id: racketId, quantity: 1 }] }), staff);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      bookingId = created.data.booking.id;
      // Lapangan 400.000 × 20% + raket 50.000 × 10%.
      assert.equal(created.data.booking.member_discount, 85000);
      assert.equal(created.data.booking.total, 365000);
      assert.equal(created.data.booking.member_plan, "Gold");
      assert.equal(await balance("potongan_member", tomorrow), -85000, "akun lawan pendapatan bersaldo debit");
      assert.equal(await balance("pendapatan_lapangan", tomorrow), 400000, "pendapatan tetap dicatat pada harga normal");
      assert.equal(await balance("pendapatan_sewa", tomorrow), 50000);

      const discounted = await request(`/operations/bookings/${bookingId}/discount`, "PUT", { amount: 15000, note: "Kompensasi" }, staff);
      assert.equal(discounted.data.booking.total, 350000);
      assert.equal(await balance("potongan_harga", tomorrow), -15000);
      const moved = await request(`/operations/bookings/${bookingId}/reschedule`, "POST", { court_id: courtId, date: tomorrow, start_time: "14:00", end_time: "16:00" }, staff);
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      assert.equal(moved.data.booking.member_discount, 85000, "tarif member ikut pindah");
      assert.equal(moved.data.booking.total, 350000);
      const more = await request(`/operations/bookings/${bookingId}/addons`, "PUT", { lines: [{ addon_id: racketId, quantity: 2 }] }, staff);
      assert.equal(more.status, 200, JSON.stringify(more.data));
      assert.equal(more.data.booking.member_discount, 90000);
      assert.equal(more.data.booking.total, 395000);
    });

    await t.test("harga member hanya bila aktif pada tanggal main, bisa dipasang menyusul, dan berhenti saat dibekukan", async () => {
      const beyond = await request("/operations/bookings", "POST", booking("10:00", "11:00", { date: shiftDate(yearEnd, 1), membership_id: budiId }), staff);
      assert.equal(beyond.status, 409);
      assert.match(beyond.data.message, /tidak mencakup tanggal main/);
      const plain = await request("/operations/bookings", "POST", booking("18:00", "19:00"), staff);
      assert.equal(plain.data.booking.total, 200000);
      const attached = await request(`/operations/bookings/${plain.data.booking.id}/member`, "PUT", { membership_id: budiId }, staff);
      assert.equal(attached.status, 200, JSON.stringify(attached.data));
      assert.equal(attached.data.booking.total, 160000);
      const removed = await request(`/operations/bookings/${plain.data.booking.id}/member`, "PUT", { membership_id: null }, staff);
      assert.equal(removed.data.booking.total, 200000);
      assert.equal(removed.data.booking.member_discount, 0);

      assert.equal((await request(`/operations/members/${budiId}/freeze`, "POST", { frozen: true }, admin)).data.member.state, "frozen");
      const frozen = await request("/operations/bookings", "POST", booking("20:00", "21:00", { membership_id: budiId }), staff);
      assert.equal(frozen.status, 409);
      assert.match(frozen.data.message, /dibekukan/);
      const back = await request(`/operations/members/${budiId}/freeze`, "POST", { frozen: false }, admin);
      assert.equal(back.data.member.state, "active");
      assert.equal(back.data.member.ends_on, yearEnd, "dibekukan kurang dari sehari tidak menggeser tanggal berakhir");
    });

    await t.test("perpanjang lebih awal menyambung dari tanggal berakhir, tanpa biaya daftar", async () => {
      const renewed = await request(`/operations/members/${budiId}/renew`, "POST", { plan_id: silverId, method: "transfer" }, admin);
      assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
      const invoice = renewed.data.invoices[0];
      assert.equal(invoice.amount, 300000);
      assert.equal(invoice.period_start, shiftDate(yearEnd, 1));
      assert.equal(renewed.data.member.ends_on, shiftDate(shiftMonths(shiftDate(yearEnd, 1), 1), -1));
      assert.equal(renewed.data.member.starts_on, today, "masa berlaku bersambung");
      assert.equal(renewed.data.member.plan.name, "Silver");
      assert.equal(await balance("bank"), 300000, "transfer masuk ke rekening bank");
      assert.equal(renewed.data.unearned, 1100000 + 300000);
    });

    let rina = { id: "", cookie: "" };
    await t.test("pelanggan mendaftar online lewat Midtrans dan langsung aktif setelah lunas", async () => {
      rina = await customer("Rina", "6281300000002");
      const page = await request("/customer/membership", "GET", undefined, rina.cookie);
      assert.equal(page.status, 200);
      assert.equal(page.data.membership, null);
      assert.equal(page.data.settings.online_payment, true);
      assert.equal((await request("/customer/membership", "POST", { plan_id: silverId, name: "Rina", phone: "081300000002", agree: true }, rina.cookie)).status, 409, "paket kasir tidak bisa dibeli online");
      assert.equal((await request("/customer/membership", "POST", { plan_id: goldId, name: "Rina", phone: "081300000002" }, rina.cookie)).status, 400, "wajib menyetujui syarat");
      const started = await request("/customer/membership", "POST", { plan_id: goldId, name: "Rina", phone: "081300000002", agree: true }, rina.cookie);
      assert.equal(started.status, 201, JSON.stringify(started.data));
      assert.match(started.data.redirect_url, /midtrans/);
      const snap = snaps.at(-1) as { transaction_details: { order_id: string; gross_amount: number }; item_details: { price: number }[] };
      assert.equal(snap.transaction_details.gross_amount, 1300000);
      assert.equal(snap.item_details.reduce((sum, line) => sum + line.price, 0), 1300000);
      const pending = await request("/customer/membership", "GET", undefined, rina.cookie);
      assert.equal(pending.data.membership.state, "pending_payment");
      assert.ok(pending.data.invoices[0].pay_url);

      const forged = await request("/public/payments/midtrans/notification", "POST", { ...webhook(snap.transaction_details.order_id, 1300000), signature_key: "salah" });
      assert.equal(forged.status, 403);
      const paid = await request("/public/payments/midtrans/notification", "POST", webhook(snap.transaction_details.order_id, 1300000));
      assert.equal(paid.status, 200, JSON.stringify(paid.data));
      assert.equal((await request("/public/payments/midtrans/notification", "POST", webhook(snap.transaction_details.order_id, 1300000))).status, 200, "webhook ulang aman");
      const active = await request("/customer/membership", "GET", undefined, rina.cookie);
      assert.equal(active.data.membership.state, "active");
      assert.equal(active.data.membership.ends_on, yearEnd);
      assert.equal(Number((await db.prepare("SELECT count(*) n FROM membership_invoices WHERE status='paid' AND membership_id=?").get(active.data.membership.id) as { n: number }).n), 1);
      const mails = await db.prepare("SELECT kind,recipient FROM email_outbox WHERE kind IN ('member_bill','member_active','staff_new') ORDER BY created_at").all() as { kind: string; recipient: string }[];
      assert.ok(mails.some(mail => mail.kind === "member_bill" && mail.recipient === "rina@gmail.test"));
      assert.ok(mails.some(mail => mail.kind === "member_active" && mail.recipient === "rina@gmail.test"));
      assert.ok(mails.some(mail => mail.kind === "staff_new" && mail.recipient === "kasir@venue.test"), "staf diberi tahu ada member online baru");
      const inbox = await request("/customer/notifications", "GET", undefined, rina.cookie);
      assert.ok(inbox.data.items.some((item: { title: string }) => item.title === "Keanggotaan aktif"));
    });

    await t.test("checkout online member: potongan di keranjang sama dengan tagihan, tamu membayar harga umum", async () => {
      const cart = { items: [{ court_id: courtId, date: tomorrow, start_time: "08:00", end_time: "09:00", addons: [{ addon_id: racketId, quantity: 1 }] }] };
      const guest = await request("/public/cart/quote", "POST", cart);
      assert.equal(guest.data.total, 250000);
      assert.equal(guest.data.member_discount, 0);
      const quote = await request("/public/cart/quote", "POST", cart, rina.cookie);
      assert.equal(quote.data.member_discount, 45000);
      assert.equal(quote.data.total, 205000);
      assert.equal(quote.data.items[0].member_plan, "Gold");
      const checkout = await request("/public/checkout", "POST", { ...cart, customer: "Rina", phone: "081300000002", email: "", notes: "" }, rina.cookie);
      assert.equal(checkout.status, 201, JSON.stringify(checkout.data));
      assert.equal(checkout.data.total, 205000);
      const snap = snaps.at(-1) as { item_details: { id: string; price: number }[] };
      assert.ok(snap.item_details.some(line => line.id.startsWith("member-") && line.price === -45000), "potongan member tampil di halaman Midtrans");
      // Nomor HP member saja tidak memberi harga member.
      const stranger = await request("/public/checkout", "POST", { items: [{ ...cart.items[0], start_time: "09:00", end_time: "10:00" }], customer: "Orang Lain", phone: "081300000002", email: "", notes: "" });
      assert.equal(stranger.data.total, 250000);
    });

    await t.test("persetujuan admin: pendaftar online yang sudah bayar menunggu, masa berlaku dihitung sejak disetujui", async () => {
      const settings = await request("/operations/members/settings", "PUT", { enabled: true, approval: true, terms: "Kartu tidak dapat dipindahtangankan.", reminder_days: 5 }, admin);
      assert.equal(settings.status, 200);
      const sari = await customer("Sari", "6281300000003");
      const started = await request("/customer/membership", "POST", { plan_id: goldId, name: "Sari", phone: "081300000003", agree: true }, sari.cookie);
      const orderId = (snaps.at(-1) as { transaction_details: { order_id: string } }).transaction_details.order_id;
      assert.equal(started.status, 201);
      await request("/public/payments/midtrans/notification", "POST", webhook(orderId, 1300000));
      const waiting = await request("/customer/membership", "GET", undefined, sari.cookie);
      assert.equal(waiting.data.membership.state, "pending_approval");
      assert.equal(await balance("pendapatan_dimuka", yearEnd), 300000 + 1200000, "iuran yang belum disetujui tetap kewajiban");
      const quote = await request("/public/cart/quote", "POST", { items: [{ court_id: courtId, date: tomorrow, start_time: "11:00", end_time: "12:00", addons: [] }] }, sari.cookie);
      assert.equal(quote.data.member_discount, 0, "belum disetujui, belum dapat harga member");
      const list = await request("/operations/members?state=pending_approval", "GET", undefined, admin);
      assert.equal(list.data.members.length, 1);
      const approved = await request(`/operations/members/${list.data.members[0].id}/approve`, "POST", {}, admin);
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      assert.equal(approved.data.member.state, "active");
      assert.equal(approved.data.member.starts_on, today);
    });

    await t.test("member dari kasir dihubungkan ke akun dengan kode member dan nomor HP", async () => {
      const budi = await customer("Budi", "6281300000001");
      const detail = await request(`/operations/members/${budiId}`, "GET", undefined, admin);
      assert.equal(detail.data.account_suggestions.length, 1, "akun dengan nomor HP sama disarankan ke admin");
      const code = detail.data.member.code as string;
      assert.equal((await request("/customer/membership/claim", "POST", { code, phone: "081399999999" }, budi.cookie)).status, 404);
      const claimed = await request("/customer/membership/claim", "POST", { code: code.replace("MBR-", "").toLowerCase(), phone: "0813 0000 0001" }, budi.cookie);
      assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
      assert.equal(claimed.data.membership.code, code);
      assert.equal((await request("/customer/membership/claim", "POST", { code, phone: "081300000001" }, rina.cookie)).status, 409, "kartu yang sudah terhubung tidak bisa diambil akun lain");
    });

    await t.test("pengingat masa berlaku dikirim sekali sebelum dan sekali sesudah berakhir", async () => {
      await db.prepare("UPDATE memberships SET ends_on=? WHERE id=?").run(shiftDate(today, 3), budiId);
      await queueMemberReminders();
      await queueMemberReminders();
      const expiring = await db.prepare("SELECT count(*) n FROM email_outbox WHERE kind='member_expiring' AND recipient='budi@contoh.test'").get() as { n: number };
      assert.equal(Number(expiring.n), 1);
      await db.prepare("UPDATE memberships SET ends_on=? WHERE id=?").run(shiftDate(today, -1), budiId);
      await queueMemberReminders();
      const expired = await db.prepare("SELECT count(*) n FROM email_outbox WHERE kind='member_expired'").get() as { n: number };
      assert.equal(Number(expired.n), 1);
      const list = await request("/operations/members?state=expired", "GET", undefined, admin);
      assert.deepEqual(list.data.members.map((member: { id: string }) => member.id), [budiId]);
      await db.prepare("UPDATE memberships SET ends_on=? WHERE id=?").run(shiftDate(shiftMonths(shiftDate(yearEnd, 1), 1), -1), budiId);
    });

    await t.test("pembatalan: sisa iuran dikembalikan sebagian dan sisanya diakui sebagai pendapatan", async () => {
      const before = (await request(`/operations/members/${budiId}`, "GET", undefined, admin)).data.unearned;
      assert.equal(before, 1400000);
      assert.equal((await request(`/operations/members/${budiId}/cancel`, "POST", { reason: "Pindah kota", refund: before + 1, method: "cash" }, admin)).status, 400);
      const kasBefore = await balance("kas", yearEnd), incomeBefore = await balance("pendapatan_keanggotaan", "9999-12-31");
      const cancelled = await request(`/operations/members/${budiId}/cancel`, "POST", { reason: "Pindah kota", refund: 500000, method: "cash" }, admin);
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
      assert.equal(cancelled.data.member.state, "cancelled");
      assert.equal(cancelled.data.unearned, 0);
      assert.equal(await balance("kas", yearEnd), kasBefore - 500000);
      const membershipIds = (await db.prepare("SELECT id FROM memberships WHERE id<>?").all(budiId) as { id: string }[]).length;
      assert.equal(membershipIds, 2);
      // Pendapatan total Budi: biaya daftar + iuran bulan berjalan + sisa yang tidak dikembalikan (1.400.000 − 500.000).
      assert.equal(await balance("pendapatan_keanggotaan", "9999-12-31") - incomeBefore, -(1100000 + 300000) + 900000);
      const neraca = await request(`/operations/finance/reports/neraca?as_of=${yearEnd}`, "GET", undefined, admin);
      assert.equal(neraca.data.difference, 0);
      const again = await request("/operations/members", "POST", { plan_id: silverId, name: "Budi Member", phone: "081300000001", method: null }, admin);
      assert.equal(again.status, 201, "nomor HP boleh didaftarkan lagi setelah keanggotaan lama dibatalkan");
      assert.equal(again.data.member.state, "pending_payment");
      const stats = await request("/operations/members", "GET", undefined, admin);
      assert.equal(stats.data.stats.active, 2);
      assert.equal(stats.data.stats.waiting, 1);
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
