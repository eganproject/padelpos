import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-member2-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("member_phase2");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.PUBLIC_URL = "https://padelix.contoh";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.MIDTRANS_CLIENT_KEY;

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock, shiftDate } = await import("../src/clock.js");

test("member fase 2: tarif tetap member, kuota jam, jam khusus member, dan diskon member di kasir", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  async function balance(key: string, to: string) {
    const row = await db.prepare(`SELECT a.type,
        (SELECT COALESCE(SUM(l.debit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=a.id AND e.date<=?) debit,
        (SELECT COALESCE(SUM(l.credit),0) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=a.id AND e.date<=?) credit
      FROM accounts a WHERE a.system_key=?`).get(to, to, key) as { type: string; debit: number; credit: number };
    return row.type === "aset" || row.type === "beban" ? Number(row.debit) - Number(row.credit) : Number(row.credit) - Number(row.debit);
  }
  async function customer(name: string, phone: string) {
    const id = randomUUID(), token = randomBytes(16).toString("hex"), stamp = new Date().toISOString();
    await db.prepare("INSERT INTO customer_accounts (id,firebase_uid,email,name,phone,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)").run(id, `uid-${id}`, `${name.toLowerCase().replace(/\W/g, "")}@gmail.test`, name, phone, stamp, stamp);
    await db.prepare("INSERT INTO sessions (id,subject_id,subject_type,expires_at) VALUES (?,?,'customer',?)").run(createHash("sha256").update(token).digest("hex"), id, Date.now() + 3600000);
    return { id, cookie: `padelix_customer=${token}` };
  }
  const today = localClock().date, day1 = shiftDate(today, 2), day2 = shiftDate(today, 3), day3 = shiftDate(today, 4);
  let admin = "", courtId = "", ruleId = "", racketId = "", drinkId = "", platinumId = "", basicId = "", rinaId = "", dodiId = "";
  const booking = (date: string, start: string, end: string, extra = {}) => ({ court_id: courtId, customer: "Rina", phone: "081377700001", date, start_time: start, end_time: end, notes: "", ...extra });

  try {
    await t.test("persiapan: lapangan, tarif jam sepi, barang kasir", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin", email: "admin@fase2.test", phone: "081234567890", password: "StrongPass123" })).cookie;
      courtId = (await request("/operations/courts", "POST", { name: "Court A", hourly_rate: 200000, opens_at: "06:00", closes_at: "23:00", active: true }, admin)).data.court.id;
      const rules = await request("/operations/price-rules", "POST", { label: "Jam sepi", court_ids: [courtId], days: [0, 1, 2, 3, 4, 5, 6], start_time: "06:00", end_time: "12:00", hourly_rate: 150000 }, admin);
      assert.equal(rules.status, 201, JSON.stringify(rules.data));
      ruleId = rules.data.price_rules[0].id;
      racketId = (await request("/operations/addons", "POST", { name: "Raket", category: "raket", type: "sewa", pricing: "per_booking", price: 50000, stock: null, low_stock: 0, max_per_booking: 4, description: "", active: true, online: true }, admin)).data.addon.id;
      drinkId = (await request("/operations/addons", "POST", { name: "Minuman", category: "minuman", type: "jual", pricing: "per_booking", price: 10000, stock: 50, low_stock: 0, max_per_booking: 10, description: "", active: true, online: true }, admin)).data.addon.id;
    });

    await t.test("paket: tarif tetap per tarif lapangan, batas jam, dan akses jam khusus member", async () => {
      const wrong = await request("/operations/members/plans", "POST", { name: "Salah", price: 100000, duration_months: 1, court_discount: 10, rates: [{ rule_key: "tidak-ada", hourly_rate: 1000 }] }, admin);
      assert.equal(wrong.status, 404);
      const half = await request("/operations/members/plans", "POST", { name: "Salah", price: 100000, duration_months: 1, court_discount: 10, daily_hours: 1.25 }, admin);
      assert.equal(half.status, 400);
      const platinum = await request("/operations/members/plans", "POST", {
        name: "Platinum", price: 500000, duration_months: 1, court_discount: 10, addon_discount: 20,
        rates: [{ rule_key: ruleId, hourly_rate: 100000 }], daily_hours: 2, monthly_hours: 0,
      }, admin);
      assert.equal(platinum.status, 201, JSON.stringify(platinum.data));
      platinumId = platinum.data.plan.id;
      assert.equal(platinum.data.plan.daily_minutes, 120);
      assert.deepEqual(platinum.data.plan.rates, [{ rule_key: ruleId, hourly_rate: 100000 }]);
      basicId = (await request("/operations/members/plans", "POST", { name: "Basic", price: 100000, duration_months: 1, court_discount: 5, member_slots: false }, admin)).data.plan.id;
      const listed = await request("/operations/members", "GET", undefined, admin);
      assert.equal(listed.data.price_rules.length, 1);
      assert.equal(listed.data.plans.find((plan: { id: string }) => plan.id === platinumId).rates.length, 1);
      const guest = await request("/public/membership");
      const card = guest.data.plans.find((plan: { name: string }) => plan.name === "Platinum");
      assert.deepEqual(card.rates, [{ label: "Jam sepi", hourly_rate: 100000 }], "situs menampilkan tarif tetap dengan nama tarifnya");

      rinaId = (await request("/operations/members", "POST", { plan_id: platinumId, name: "Rina", phone: "081377700001", method: "cash" }, admin)).data.member.id;
      dodiId = (await request("/operations/members", "POST", { plan_id: basicId, name: "Dodi", phone: "081377700002", method: "cash" }, admin)).data.member.id;
    });

    await t.test("harga lapangan member: tarif tetap di jam sepi, diskon persen di jam lain", async () => {
      // 10:00–12:00 jam sepi 150.000/jam → member 100.000/jam. Hemat 100.000.
      const first = await request("/operations/bookings", "POST", booking(day1, "10:00", "12:00", { membership_id: rinaId, addons: [{ addon_id: racketId, quantity: 1 }] }), admin);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      assert.equal(first.data.booking.court_total, 300000);
      assert.equal(first.data.booking.member_court_cut, 100000);
      assert.equal(first.data.booking.member_discount, 110000, "ditambah 20% dari raket 50.000");
      assert.equal(first.data.booking.total, 240000);
      assert.equal(first.data.booking.member_note, "");
      assert.equal(await balance("potongan_member", day1), -110000);
      assert.equal(await balance("pendapatan_lapangan", day1), 300000, "pendapatan tetap pada harga normal");
      // Campuran: 11:00–12:00 tarif tetap (hemat 50.000), 12:00–13:00 harga normal diskon 10% (20.000).
      const mixed = await request("/operations/bookings", "POST", booking(day2, "11:00", "13:00", { membership_id: rinaId }), admin);
      assert.equal(mixed.data.booking.court_total, 350000);
      assert.equal(mixed.data.booking.member_discount, 70000);
      // Raket ditambah: potongan lapangan tetap, diskon raket mengikuti.
      const more = await request(`/operations/bookings/${first.data.booking.id}/addons`, "PUT", { lines: [{ addon_id: racketId, quantity: 2 }] }, admin);
      assert.equal(more.status, 200, JSON.stringify(more.data));
      assert.equal(more.data.booking.member_discount, 120000);
    });

    await t.test("kuota: lewat 2 jam per hari memakai harga normal, dan pindah jadwal ikut diperiksa", async () => {
      const lookup = await request(`/operations/members/lookup?q=Rina&date=${day1}`, "GET", undefined, admin);
      assert.deepEqual(lookup.data.members[0].quota, { day: 0, month: null });
      const over = await request("/operations/bookings", "POST", booking(day1, "14:00", "15:00", { membership_id: rinaId }), admin);
      assert.equal(over.status, 201, JSON.stringify(over.data));
      assert.equal(over.data.booking.member_discount, 0);
      assert.equal(over.data.booking.total, 200000);
      assert.equal(over.data.booking.membership_id, rinaId, "tetap tercatat sebagai booking member");
      assert.match(over.data.booking.member_note, /Kuota harga member 2 jam per hari sudah terpakai 2 jam/);
      // day2 sudah 2 jam: memindah booking day1 (2 jam harga member) ke day2 melewati kuota.
      const day1Booking = (await db.prepare("SELECT id FROM bookings WHERE date=? AND start_time='10:00'").get(day1) as { id: string }).id;
      const moved = await request(`/operations/bookings/${day1Booking}/reschedule`, "POST", { court_id: courtId, date: day2, start_time: "16:00", end_time: "18:00" }, admin);
      assert.equal(moved.status, 409);
      assert.match(moved.data.message, /Kuota harga member/);
      const fine = await request(`/operations/bookings/${day1Booking}/reschedule`, "POST", { court_id: courtId, date: day3, start_time: "16:00", end_time: "18:00" }, admin);
      assert.equal(fine.status, 200, JSON.stringify(fine.data));
      // Tarif tetap disalin dari booking: di jam normal tetap diskon 10%.
      assert.equal(fine.data.booking.member_court_cut, 40000);
    });

    await t.test("jam khusus member: hanya member dengan paket yang mengizinkan", async () => {
      const bad = await request("/operations/members/slots", "POST", { label: "X", days: [1], start_time: "20:00", end_time: "19:00" }, admin);
      assert.equal(bad.status, 400);
      const slots = await request("/operations/members/slots", "POST", { label: "Malam member", days: [0, 1, 2, 3, 4, 5, 6], start_time: "20:00", end_time: "22:00", court_ids: [] }, admin);
      assert.equal(slots.status, 201, JSON.stringify(slots.data));
      assert.equal(slots.data.member_slots.length, 1);
      const guest = await request("/operations/bookings", "POST", booking(day3, "21:00", "22:00", { customer: "Tamu", phone: "081399900001" }), admin);
      assert.equal(guest.status, 409);
      assert.match(guest.data.message, /Malam member \(20:00–22:00\) khusus member/);
      const basic = await request("/operations/bookings", "POST", booking(day3, "21:00", "22:00", { membership_id: dodiId }), admin);
      assert.equal(basic.status, 409);
      assert.match(basic.data.message, /tidak termasuk/);
      const member = await request("/operations/bookings", "POST", booking(day3, "20:00", "21:00", { membership_id: rinaId }), admin);
      assert.equal(member.status, 201, JSON.stringify(member.data));
      assert.equal((await request(`/operations/bookings/${member.data.booking.id}/member`, "PUT", { membership_id: null }, admin)).status, 409, "booking di jam khusus tidak bisa dilepas dari membernya");

      const availability = await request(`/public/availability?date=${day3}`);
      const slot = availability.data.courts[0].slots.find((entry: { start: string }) => entry.start === "21:00");
      assert.equal(slot.member_only, "Malam member");
      assert.equal(availability.data.courts[0].slots.find((entry: { start: string }) => entry.start === "19:00").member_only, null);

      const item = { court_id: courtId, date: day3, start_time: "21:00", end_time: "22:00", addons: [] };
      const anonymous = await request("/public/cart/quote", "POST", { items: [item] });
      assert.equal(anonymous.data.items[0].ok, false);
      assert.match(anonymous.data.items[0].reason, /Masuk dengan akun member/);
      const rina = await customer("Rina Online", "081377700001");
      await db.prepare("UPDATE memberships SET account_id=? WHERE id=?").run(rina.id, rinaId);
      const signed = await request("/public/cart/quote", "POST", { items: [item, { ...item, date: shiftDate(day3, 1), start_time: "10:00", end_time: "12:00" }, { ...item, date: shiftDate(day3, 1), start_time: "13:00", end_time: "14:00" }] }, rina.cookie);
      assert.equal(signed.data.items[0].ok, true, JSON.stringify(signed.data.items[0]));
      // Kuota dihitung bersama sesi lain di keranjang yang sama: 2 jam pertama harga member, sesi berikutnya normal.
      assert.equal(signed.data.items[1].member_discount, 100000);
      assert.equal(signed.data.items[2].member_discount, 0);
      assert.match(signed.data.items[2].member_note, /Kuota harga member/);
      const checkout = await request("/public/checkout", "POST", { items: [item], customer: "Tamu", phone: "081399900001" });
      assert.equal(checkout.status, 409);
    });

    await t.test("kasir: diskon tambahan member untuk barang katalog, biaya lain tidak, dan jurnal Potongan Member", async () => {
      const before = await balance("potongan_member", today);
      const sale = await request("/operations/counter", "POST", {
        customer: "Rina", membership_id: rinaId, method: "cash",
        lines: [{ addon_id: racketId, quantity: 1 }, { addon_id: drinkId, quantity: 2 }, { name: "Senar", unit_price: 30000, quantity: 1 }],
      }, admin);
      assert.equal(sale.status, 201, JSON.stringify(sale.data));
      // (50.000 + 20.000) × 20% = 14.000; senar 30.000 tidak didiskon.
      assert.equal(sale.data.sale.subtotal, 100000);
      assert.equal(sale.data.sale.member_discount, 14000);
      assert.equal(sale.data.sale.member_plan, "Platinum");
      assert.equal(sale.data.sale.total, 86000);
      assert.equal(await balance("kas", today) >= 86000, true);
      assert.equal(await balance("potongan_member", today) - before, -14000);
      const detail = await request(`/operations/members/${rinaId}`, "GET", undefined, admin);
      assert.equal(detail.data.totals.sales, 1);
      const voided = await request(`/operations/counter/${sale.data.sale.id}/void`, "POST", { reason: "Salah input" }, admin);
      assert.equal(voided.status, 200);
      assert.equal(await balance("potongan_member", today), before, "pembatalan membalik potongan member");
      const expired = await db.prepare("UPDATE memberships SET status='frozen' WHERE id=?").run(dodiId);
      assert.equal(expired.changes, 1);
      const frozen = await request("/operations/counter", "POST", { membership_id: dodiId, method: "cash", lines: [{ addon_id: drinkId, quantity: 1 }] }, admin);
      assert.equal(frozen.status, 409);
      const trial = await db.prepare("SELECT SUM(debit)-SUM(credit) n FROM journal_lines").get() as { n: number };
      assert.equal(Number(trial.n), 0);
    });

    await t.test("kasir: potongan member dihitung dulu, voucher memotong sisanya, jurnal seimbang", async () => {
      const promo = await request("/operations/vouchers", "POST", { code: "MEMBER10", name: "Promo member", kind: "percent", value: 1000, starts_on: today }, admin);
      assert.equal(promo.status, 201, JSON.stringify(promo.data));
      const sale = await request("/operations/counter", "POST", {
        customer: "Rina", membership_id: rinaId, method: "cash", voucher_code: "MEMBER10",
        lines: [{ addon_id: racketId, quantity: 1 }, { addon_id: drinkId, quantity: 2 }, { name: "Senar", unit_price: 30000, quantity: 1 }],
      }, admin);
      assert.equal(sale.status, 201, JSON.stringify(sale.data));
      // Member 20% × 70.000 = 14.000; voucher 10% × 70.000 (barang katalog) = 7.000; senar tidak didiskon.
      assert.equal(sale.data.sale.member_discount, 14000);
      assert.equal(sale.data.sale.voucher_discount, 7000);
      assert.equal(sale.data.sale.total, 79000);
      const trial = await db.prepare("SELECT SUM(debit)-SUM(credit) n FROM journal_lines").get() as { n: number };
      assert.equal(Number(trial.n), 0);
    });

    await t.test("kasir: booking hari ini dengan harga member membawa kode membernya", async () => {
      const now = localClock();
      const start = `${String(Math.min(21, Math.max(6, Number(now.time.slice(0, 2)) + 1))).padStart(2, "0")}:00`;
      if (start <= now.time || start >= "22:00") return; // terlalu malam untuk membuat booking hari ini
      const created = await request("/operations/bookings", "POST", booking(today, start, `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`, { membership_id: rinaId }), admin);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const options = await request("/operations/counter/options", "GET", undefined, admin);
      const linked = options.data.bookings.find((entry: { id: string }) => entry.id === created.data.booking.id);
      assert.match(linked.member_code, /^MBR-/);
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
