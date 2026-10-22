import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTestDatabase } from "./mysql.js";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-reports-test-"));
process.env.DATA_DIR = directory;
await useTestDatabase("reports");
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("arus kas, neraca saldo, aset tetap, tutup buku, dan laporan operasional", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/operations`;
  async function request(url: string, method = "GET", body?: unknown, cookie = admin) {
    const response = await fetch((url.startsWith("/auth") ? base.replace("/operations", "") : base) + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const today = localClock().date, year = Number(today.slice(0, 4)), last = year - 1;
  const account = async (key: string) => (await db.prepare("SELECT id FROM accounts WHERE system_key=?").get(key) as { id: string }).id;
  const saldo = async (key: string) => Number((await db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.system_key=?").get(key) as { n: number }).n);
  let admin = "", kas = "", assetId = "";
  const juta = 1_000_000;

  try {
    await t.test("penyiapan transaksi tahun lalu", async () => {
      admin = (await request("/auth/register", "POST", { name: "Admin Laporan", email: "admin@lapor.test", phone: "081234567890", password: "StrongPass123" }, "")).cookie;
      kas = await account("kas");
      for (const key of ["aset_tetap", "akumulasi_penyusutan", "beban_penyusutan", "laba_pelepasan_aset", "laba_ditahan"]) assert.ok(await account(key), key);
      assert.equal((await db.prepare("SELECT code FROM accounts WHERE system_key='aset_tetap'").get() as { code: string }).code, "1-500");
      assert.equal((await request("/finance/equity", "POST", { date: `${last}-01-05`, direction: "setor", cash_account_id: kas, amount: 100 * juta, memo: "Modal awal" })).status, 201);
      const listrik = (await db.prepare("SELECT id FROM accounts WHERE code='5-200'").get() as { id: string }).id;
      const lain = await account("pendapatan_lain");
      assert.equal((await request("/finance/records", "POST", { kind: "pengeluaran", date: `${last}-02-10`, account_id: listrik, amount: 2 * juta, settle: "tunai", cash_account_id: kas, description: "Listrik Februari" })).status, 201);
      assert.equal((await request("/finance/records", "POST", { kind: "pemasukan", date: `${last}-04-10`, account_id: lain, amount: 5 * juta, settle: "tunai", cash_account_id: kas, description: "Sewa ruang acara" })).status, 201);
    });

    await t.test("E3: aset tetap dengan pembelian tunai dan penyusutan bulanan", async () => {
      const created = await request("/finance/assets", "POST", { name: "Lampu LED lapangan", category: "Lampu", acquired_on: `${last}-03-10`, cost: 24 * juta, salvage: 0, life_months: 24, purchase: { settle: "tunai", cash_account_id: kas } });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assetId = created.data.asset.id;
      assert.match(created.data.asset.number, new RegExp(`^AT-${last}-00001$`));
      assert.equal(created.data.asset.monthly, juta);
      assert.equal(await saldo("aset_tetap"), 24 * juta, "pembelian dicatat ke akun aset");
      // Saat dibuat, penyusutan sampai bulan lalu langsung dicatat: Maret tahun lalu s.d. bulan lalu.
      const months = (year - last) * 12 + Number(today.slice(5, 7)) - 1 - 3 + 1;
      assert.equal(created.data.asset.months_done, months);
      assert.equal(await saldo("akumulasi_penyusutan"), -months * juta);
      const entries = await db.prepare("SELECT count(*) n FROM journal_entries WHERE source='penyusutan'").get() as { n: number };
      assert.equal(Number(entries.n), months, "satu jurnal per bulan");
      const again = await request("/finance/assets/depreciate", "POST", {});
      assert.equal(again.data.posted, 0, "aman diulang");
      const schedule = await request(`/finance/assets/${assetId}`);
      assert.equal(schedule.data.rows.length, 24);
      assert.equal(schedule.data.rows.at(-1).book_value, 0);
      assert.equal((await request(`/finance/assets/${assetId}`, "PUT", { name: "Lampu", acquired_on: `${last}-03-10`, cost: 20 * juta, life_months: 24 })).status, 409, "nilai tidak bisa diubah setelah disusutkan");
      assert.equal((await request(`/finance/assets/${assetId}`, "PUT", { name: "Lampu LED 4 lapangan", category: "Lampu", acquired_on: `${last}-03-10`, cost: 24 * juta, life_months: 24 })).status, 200);
    });

    await t.test("E1: arus kas dan neraca saldo tahun lalu", async () => {
      const flow = (await request(`/finance/reports/arus-kas?from=${last}-01-01&to=${last}-12-31`)).data;
      assert.equal(flow.opening, 0);
      const section = (key: string) => flow.sections.find((row: { key: string }) => row.key === key);
      assert.equal(section("pendanaan").net, 100 * juta);
      assert.equal(section("operasi").net, 3 * juta);
      assert.equal(section("investasi").net, -24 * juta);
      assert.equal(flow.closing, 79 * juta);
      assert.equal(flow.difference, 0);
      const trial = (await request(`/finance/reports/neraca-saldo?from=${last}-01-01&to=${last}-12-31`)).data;
      assert.equal(trial.balanced, true);
      assert.equal(trial.totals.debit, trial.totals.credit);
      const penyusutan = trial.rows.find((row: { code: string }) => row.code === "5-900");
      assert.equal(penyusutan.closing.debit, 10 * juta, "Maret–Desember");
    });

    await t.test("E3: tutup buku memindahkan laba ke Laba Ditahan dan mengunci tahunnya", async () => {
      const before = (await request("/finance/closing")).data;
      assert.equal(before.open[0].year, last);
      assert.equal(before.open[0].net, -7 * juta, "5 jt − 2 jt − 10 jt penyusutan");
      assert.equal((await request("/finance/closing", "POST", { year })).status, 400, "tahun berjalan belum bisa ditutup");
      const closed = await request("/finance/closing", "POST", { year: last });
      assert.equal(closed.status, 200, JSON.stringify(closed.data));
      assert.equal(closed.data.closings[0].year, last);
      assert.equal(closed.data.locked_until, `${last}-12-31`);
      assert.equal(await saldo("laba_ditahan"), 7 * juta, "rugi 7 jt di sisi debit Laba Ditahan");
      const pl = (await request(`/finance/reports/laba-rugi?from=${last}-01-01&to=${last}-12-31`)).data;
      assert.equal(pl.net, -7 * juta, "laba rugi tahun yang ditutup tetap utuh");
      const sheet = (await request(`/finance/reports/neraca?as_of=${last}-12-31`)).data;
      assert.equal(sheet.difference, 0);
      assert.ok(sheet.equity.some((row: { name: string; amount: number }) => row.name === "Laba Ditahan" && row.amount === -7 * juta));
      assert.ok(!sheet.equity.some((row: { id: string }) => row.id === "laba"), "tidak ada laba berjalan pada 31 Desember tahun yang ditutup");
      const now = (await request(`/finance/reports/neraca?as_of=${today}`)).data;
      assert.equal(now.difference, 0);
      assert.ok(now.equity.some((row: { id: string }) => row.id === "laba"), "laba tahun berjalan terpisah");
      assert.equal((await request("/finance/journal", "POST", { date: `${last}-06-01`, memo: "Koreksi", lines: [{ account_id: kas, debit: 1000 }, { account_id: await account("modal"), credit: 1000 }] })).status, 409, "tahun yang ditutup terkunci");
    });

    await t.test("E3: pelepasan aset mencatat laba penjualan", async () => {
      const sold = await request(`/finance/assets/${assetId}/dispose`, "POST", { date: today, amount: 10 * juta, cash_account_id: kas });
      assert.equal(sold.status, 200, JSON.stringify(sold.data));
      const monthsThisYear = Number(today.slice(5, 7));
      const accumulated = (10 + monthsThisYear) * juta, gain = 10 * juta - (24 * juta - accumulated);
      assert.equal(sold.data.asset.gain, gain);
      assert.equal(await saldo("aset_tetap"), 0);
      assert.equal(await saldo("akumulasi_penyusutan"), 0);
      assert.equal(await saldo("laba_pelepasan_aset"), -gain);
      const undo = await request(`/finance/assets/${assetId}/undo-dispose`, "POST", {});
      assert.equal(undo.status, 200, JSON.stringify(undo.data));
      assert.equal(await saldo("aset_tetap"), 24 * juta);
      assert.equal(await saldo("laba_pelepasan_aset"), 0);
    });

    await t.test("E2: laporan operasional", async () => {
      const court = (await request("/courts", "POST", { name: "Court Laporan", hourly_rate: 200000, opens_at: "08:00", closes_at: "22:00", active: true })).data.court;
      const day = new Date(today + "T12:00:00Z"); day.setUTCDate(day.getUTCDate() + 1);
      const tomorrow = day.toISOString().slice(0, 10);
      const booking = await request("/bookings", "POST", { court_id: court.id, customer: "Dimas", phone: "081200000009", date: tomorrow, start_time: "19:00", end_time: "21:00", notes: "" });
      assert.equal(booking.status, 201, JSON.stringify(booking.data));
      const report = await request(`/finance/reports/operasional?from=${tomorrow}&to=${tomorrow}`);
      assert.equal(report.status, 200, JSON.stringify(report.data));
      const row = report.data.courts.find((item: { id: string }) => item.id === court.id);
      assert.equal(row.sessions, 1);
      assert.equal(row.booked_hours, 2);
      assert.equal(row.open_hours, 14);
      assert.equal(row.court_revenue, 400000);
      assert.equal(report.data.customers[0].name, "Dimas");
      const evening = report.data.heat.find((item: { hour: string }) => item.hour === "19:00");
      assert.equal(evening.cells[new Date(tomorrow + "T00:00:00Z").getUTCDay()], 100);
    });

    await t.test("E3: tutup buku terakhir bisa dibatalkan", async () => {
      const undo = await request("/finance/closing/undo", "POST", { year: last });
      assert.equal(undo.status, 200, JSON.stringify(undo.data));
      assert.equal(undo.data.closings.length, 0);
      assert.equal(await saldo("laba_ditahan"), 0);
    });
  } finally {
    server.close();
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
