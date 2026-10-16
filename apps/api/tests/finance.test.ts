import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const directory = mkdtempSync(path.join(tmpdir(), "padelix-finance-test-"));
process.env.DATA_DIR = directory;
process.env.NODE_ENV = "test";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.VENUE_TIMEZONE = "Asia/Jakarta";
process.env.BOOTSTRAP_TOKEN = "";

const { app } = await import("../src/app.js");
const { db } = await import("../src/store.js");
const { localClock } = await import("../src/operations.js");

test("pembukuan: jurnal berpasangan, laba rugi, neraca, buku besar, dan buku besar pembantu", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function request(url: string, method = "GET", body?: unknown, cookie = "") {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "http://localhost:3000" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  const today = localClock().date;
  const shift = (days: number) => { const value = new Date(today + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) };
  const tomorrow = shift(1);
  let admin = "", staff = "", courtId = "", bookingId = "", partnerId = "", supplyId = "";
  const account = (code: string) => (db.prepare("SELECT id FROM accounts WHERE code=?").get(code) as { id: string }).id;
  const payment = (amount: number, kind = "payment", method = "cash") => ({ id: randomUUID(), amount, kind, method, note: kind === "refund" ? "Dibatalkan pelanggan" : "" });
  const balance = async (asOf = tomorrow, cookie = admin) => (await request(`/operations/finance/reports/neraca?as_of=${asOf}`, "GET", undefined, cookie)).data;

  try {
    await t.test("penyiapan: admin, operator, lapangan, dan bagan akun bawaan", async () => {
      const registered = await request("/auth/register", "POST", { name: "Admin Buku", email: "admin@buku.test", phone: "081234567890", password: "StrongPass123" });
      assert.equal(registered.status, 201); admin = registered.cookie;
      assert.equal((await request("/access/users", "POST", { name: "Operator Buku", email: "staff@buku.test", phone: "081234567891", role: "staff", password: "StrongPass123" }, admin)).status, 201);
      staff = (await request("/auth/login", "POST", { email: "staff@buku.test", password: "StrongPass123" })).cookie;
      const court = await request("/operations/courts", "POST", { name: "Court Buku", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true }, admin);
      assert.equal(court.status, 201); courtId = court.data.court.id;

      const setup = await request("/operations/finance/setup", "GET", undefined, admin);
      assert.equal(setup.status, 200);
      assert.equal(setup.data.accounts.length, 29, "26 akun bawaan ditambah Utang Pajak, Potongan Harga, dan Pendapatan Pembatalan");
      assert.equal(setup.data.accounts.filter((row: { is_cash: number }) => row.is_cash).length, 2, "Kas dan Bank");
      assert.equal(setup.data.settings.cash_accounts.cash, account("1-100"), "pembayaran tunai masuk ke Kas");
      assert.equal(setup.data.settings.cash_accounts.qris, account("1-200"), "pembayaran online masuk ke Bank");
    });

    await t.test("menu Keuangan tertutup untuk operator biasa", async () => {
      for (const url of ["/operations/finance/overview", "/operations/finance/setup", "/operations/finance/records", "/operations/finance/reports/neraca?as_of=" + today])
        assert.equal((await request(url, "GET", undefined, staff)).status, 403, url);
      assert.equal((await request("/operations/finance/records", "POST", {}, staff)).status, 403);
    });

    await t.test("tiap menu Keuangan hanya membuka bagiannya sendiri", async () => {
      const menus = (await request("/auth/navigation", "GET", undefined, admin)).data.menus.map((menu: { id: string }) => menu.id);
      for (const id of ["finance", "finance-records", "finance-journal", "finance-reports", "finance-settings"]) assert.ok(menus.includes(id), id);
      assert.equal((await request("/access/roles", "POST", { name: "Pembaca Laporan", slug: "pembaca-laporan", description: "", menuIds: ["finance-reports", "profile"] }, admin)).status, 201);
      assert.equal((await request("/access/users", "POST", { name: "Pembaca", email: "laporan@buku.test", phone: "081234567892", role: "pembaca-laporan", password: "StrongPass123" }, admin)).status, 201);
      const reader = (await request("/auth/login", "POST", { email: "laporan@buku.test", password: "StrongPass123" })).cookie;
      assert.equal((await request("/operations/finance/setup", "GET", undefined, reader)).status, 200, "daftar akun dibutuhkan semua halaman keuangan");
      assert.equal((await request(`/operations/finance/reports/laba-rugi?from=${today}&to=${today}`, "GET", undefined, reader)).status, 200);
      for (const url of ["/operations/finance/overview", "/operations/finance/records", "/operations/finance/journal"])
        assert.equal((await request(url, "GET", undefined, reader)).status, 403, url);
      assert.equal((await request("/operations/finance/settings", "PUT", {}, reader)).status, 403);
    });

    await t.test("booking otomatis menjadi pendapatan pada tanggal sesi, bukan tanggal pemesanan", async () => {
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Rina", phone: "081200000001", date: tomorrow, start_time: "09:00", end_time: "11:00", notes: "" }, admin);
      assert.equal(created.status, 201);
      bookingId = created.data.booking.id;
      assert.equal(created.data.booking.total, 600000);

      const journal = await request(`/operations/finance/journal?from=${tomorrow}&to=${tomorrow}&source=booking`, "GET", undefined, admin);
      assert.equal(journal.data.entries.length, 1);
      const entry = journal.data.entries[0];
      assert.match(entry.number, /^JU-\d{4}-\d{5}$/);
      assert.equal(entry.date, tomorrow, "diakui pada tanggal main");
      const debit = entry.lines.filter((line: { debit: number }) => line.debit > 0);
      const credit = entry.lines.filter((line: { credit: number }) => line.credit > 0);
      assert.equal(debit.length, 1);
      assert.equal(debit[0].account_code, "1-300", "Piutang Usaha");
      assert.equal(debit[0].debit, 600000);
      assert.equal(debit[0].booking_id, bookingId, "terhubung ke buku besar pembantu piutang");
      assert.equal(credit.length, 1);
      assert.equal(credit[0].account_code, "4-100", "Pendapatan Sewa Lapangan");
      assert.equal(credit[0].credit, 600000);

      // Belum ada uang masuk: seluruh tagihan berdiri sebagai piutang.
      const sheet = await balance();
      assert.equal(sheet.difference, 0, "neraca seimbang");
      assert.equal(sheet.receivable, 600000);
      assert.equal(sheet.total_assets, 600000);
      assert.equal(sheet.total_equity, 600000, "laba berjalan menyeimbangkan piutang");
    });

    await t.test("pembayaran masuk ke akun kas sesuai metodenya dan mengurangi piutang", async () => {
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", payment(200000, "payment", "cash"), admin)).status, 201);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", payment(100000, "payment", "transfer"), admin)).status, 201);
      const sheet = await balance();
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.receivable, 300000, "sisa tagihan");
      const cash = sheet.assets.find((row: { code: string }) => row.code === "1-100");
      const bank = sheet.assets.find((row: { code: string }) => row.code === "1-200");
      assert.equal(cash.amount, 200000, "tunai ke Kas");
      assert.equal(bank.amount, 100000, "transfer ke Bank");
    });

    await t.test("uang yang diterima untuk sesi yang belum main tampil sebagai kewajiban, bukan aset", async () => {
      // Hari ini sesi besok belum berjalan, jadi pendapatannya belum diakui.
      const sheet = await balance(today);
      assert.equal(sheet.difference, 0, "neraca tetap seimbang");
      assert.equal(sheet.receivable, 0);
      assert.equal(sheet.advances, 300000, "uang muka pelanggan");
      assert.ok(sheet.liabilities.some((row: { name: string; amount: number }) => row.name === "Uang Muka Pelanggan" && row.amount === 300000));
      assert.equal(sheet.total_equity, 0, "belum ada laba karena sesinya belum main");
    });

    await t.test("pengeluaran tunai langsung menjadi beban di laba rugi", async () => {
      const created = await request("/operations/finance/records", "POST", {
        kind: "pengeluaran", date: today, account_id: account("5-200"), amount: 450000,
        settle: "tunai", cash_account_id: account("1-100"), description: "Token listrik Agustus",
      }, admin);
      assert.equal(created.status, 201);
      assert.match(created.data.record.number, /^BY-\d{4}-\d{5}$/);
      assert.equal(created.data.record.account_name, "Listrik, Air & Internet");
      assert.ok(created.data.record.entry_number, "jurnalnya ikut dibuat");

      const report = (await request(`/operations/finance/reports/laba-rugi?from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(report.expense, 450000);
      assert.equal(report.expense_lines[0].name, "Listrik, Air & Internet");
      assert.equal(report.net, -450000, "hari ini baru ada pengeluaran");

      const sheet = await balance(today);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.assets.find((row: { code: string }) => row.code === "1-100").amount, 200000 - 450000);
    });

    await t.test("catatan yang salah dapat diperbaiki dan jurnalnya ikut berubah", async () => {
      const list = (await request(`/operations/finance/records?kind=pengeluaran`, "GET", undefined, admin)).data;
      const record = list.records[0];
      const updated = await request(`/operations/finance/records/${record.id}`, "PUT", {
        kind: "pengeluaran", date: today, account_id: account("5-200"), amount: 500000,
        settle: "tunai", cash_account_id: account("1-100"), description: "Token listrik Agustus",
      }, admin);
      assert.equal(updated.status, 200);
      assert.equal(updated.data.record.number, record.number, "nomor bukti tidak berubah");
      assert.equal(updated.data.record.entry_number, record.entry_number, "jurnalnya ditimpa, bukan ditambah");
      const report = (await request(`/operations/finance/reports/laba-rugi?from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(report.expense, 500000, "tidak tercatat dua kali");
    });

    await t.test("pembelian tempo memunculkan utang pemasok di buku besar pembantu", async () => {
      const partner = await request("/operations/finance/partners", "POST", { name: "Toko Bola Jaya", kind: "pemasok", phone: "0812999", note: "", active: true }, admin);
      assert.equal(partner.status, 201); partnerId = partner.data.partner.id;

      assert.equal((await request("/operations/finance/records", "POST", {
        kind: "pengeluaran", date: today, account_id: account("5-500"), amount: 750000, settle: "tempo", description: "Bola latihan 5 tabung",
      }, admin)).status, 400, "pembelian tempo wajib menyebut pemasok");

      const created = await request("/operations/finance/records", "POST", {
        kind: "pengeluaran", date: today, account_id: account("5-500"), amount: 750000,
        settle: "tempo", partner_id: partnerId, due_date: shift(14), description: "Bola latihan 5 tabung",
      }, admin);
      assert.equal(created.status, 201);
      supplyId = created.data.record.id;

      const ledger = (await request(`/operations/finance/reports/pembantu?kind=utang&from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(ledger.rows.length, 1);
      assert.equal(ledger.rows[0].name, "Toko Bola Jaya");
      assert.equal(ledger.rows[0].balance, 750000);
      assert.equal(ledger.rows[0].detail.length, 1, "rincian tagihan yang belum dibayar");
      assert.equal(ledger.total, 750000);

      const sheet = await balance(today);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.liabilities.find((row: { code: string }) => row.code === "2-100").amount, 750000);
    });

    await t.test("pelunasan utang memindahkan uang dari kas dan menutup buku pembantu", async () => {
      assert.equal((await request(`/operations/finance/records/${supplyId}/settle`, "POST", { date: shift(-1), cash_account_id: account("1-200"), note: "" }, admin)).status, 400, "tidak boleh mundur dari tanggal transaksinya");
      const settled = await request(`/operations/finance/records/${supplyId}/settle`, "POST", { date: today, cash_account_id: account("1-200"), note: "Transfer BCA" }, admin);
      assert.equal(settled.status, 200);
      assert.equal(settled.data.record.settled_at, today);
      assert.equal((await request(`/operations/finance/records/${supplyId}/settle`, "POST", { date: today, cash_account_id: account("1-200"), note: "" }, admin)).status, 409, "tidak bisa dilunasi dua kali");

      const ledger = (await request(`/operations/finance/reports/pembantu?kind=utang&from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(ledger.total, 0, "utang pemasok lunas");
      const sheet = await balance(today);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.assets.find((row: { code: string }) => row.code === "1-200").amount, 100000 - 750000);
      assert.ok(!sheet.liabilities.some((row: { code: string }) => row.code === "2-100"), "utang hilang dari neraca");
    });

    await t.test("buku besar sebuah akun menampilkan saldo awal, mutasi, dan saldo akhir", async () => {
      const ledger = (await request(`/operations/finance/reports/buku-besar?account_id=${account("1-100")}&from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(ledger.account.name, "Kas");
      assert.equal(ledger.opening, 0);
      assert.equal(ledger.debit, 200000, "satu penerimaan tunai");
      assert.equal(ledger.credit, 500000, "satu pembayaran listrik");
      assert.equal(ledger.closing, -300000);
      assert.equal(ledger.rows[ledger.rows.length - 1].balance, ledger.closing, "saldo berjalan berakhir di saldo akhir");
      assert.ok(ledger.rows.every((row: { counter: string }) => row.counter.length > 0), "setiap baris menyebut lawan akunnya");
    });

    await t.test("buku besar pembantu piutang merinci tagihan per pelanggan", async () => {
      const ledger = (await request(`/operations/finance/reports/pembantu?kind=piutang&from=${tomorrow}&to=${tomorrow}`, "GET", undefined, admin)).data;
      const rina = ledger.rows.find((row: { name: string }) => row.name === "Rina");
      assert.ok(rina, "pelanggan muncul di buku pembantu");
      assert.equal(rina.opening, -300000, "uang muka sebelum sesi berjalan");
      assert.equal(rina.debit, 600000, "tagihan sesi");
      assert.equal(rina.balance, 300000, "sisa yang harus dibayar");
      assert.equal(rina.detail[0].amount, 300000);
    });

    await t.test("transfer antar kas dan setoran modal tercatat tanpa menyentuh laba rugi", async () => {
      assert.equal((await request("/operations/finance/transfer", "POST", { date: today, from_account_id: account("1-100"), to_account_id: account("1-100"), amount: 100000, memo: "" }, admin)).status, 400, "akun asal dan tujuan harus berbeda");
      assert.equal((await request("/operations/finance/equity", "POST", { date: today, direction: "setor", cash_account_id: account("1-200"), amount: 5000000, memo: "Modal awal" }, admin)).status, 201);
      assert.equal((await request("/operations/finance/transfer", "POST", { date: today, from_account_id: account("1-200"), to_account_id: account("1-100"), amount: 1000000, memo: "Isi kas kasir" }, admin)).status, 201);

      const report = (await request(`/operations/finance/reports/laba-rugi?from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(report.income, 0, "setoran modal bukan pendapatan");
      assert.equal(report.expense, 500000 + 750000);
      const sheet = await balance(today);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.assets.find((row: { code: string }) => row.code === "1-100").amount, 200000 - 500000 + 1000000);
      assert.equal(sheet.assets.find((row: { code: string }) => row.code === "1-200").amount, 100000 - 750000 + 5000000 - 1000000);
      assert.equal(sheet.equity.find((row: { code: string }) => row.code === "3-100").amount, 5000000);
    });

    await t.test("jurnal manual wajib seimbang dan hanya jurnal manual yang boleh diubah", async () => {
      const unbalanced = await request("/operations/finance/journal", "POST", {
        date: today, memo: "Penyusutan peralatan",
        lines: [{ account_id: account("5-900"), debit: 200000, credit: 0 }, { account_id: account("1-600"), debit: 0, credit: 150000 }],
      }, admin);
      assert.equal(unbalanced.status, 400);
      assert.match(unbalanced.data.message, /seimbang/);

      const created = await request("/operations/finance/journal", "POST", {
        date: today, memo: "Penyusutan peralatan Agustus",
        lines: [{ account_id: account("5-900"), debit: 200000, credit: 0 }, { account_id: account("1-600"), debit: 0, credit: 200000 }],
      }, admin);
      assert.equal(created.status, 201);
      assert.equal(created.data.entry.source, "manual");

      const auto = (await request(`/operations/finance/journal?source=booking`, "GET", undefined, admin)).data.entries[0];
      assert.equal((await request(`/operations/finance/journal/${auto.id}`, "DELETE", undefined, admin)).status, 409, "jurnal otomatis dilindungi");
      assert.equal((await request(`/operations/finance/journal/${auto.id}`, "PUT", { date: today, memo: "Coba ubah", lines: created.data.entry.lines }, admin)).status, 409);

      const sheet = await balance(today);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.assets.find((row: { code: string }) => row.code === "1-600").amount, -200000, "akumulasi penyusutan mengurangi aset");
    });

    await t.test("pembukuan yang dikunci menolak perubahan pada periode lama", async () => {
      assert.equal((await request("/operations/finance/settings", "PUT", {
        cash_accounts: { cash: account("1-100"), transfer: account("1-200"), qris: account("1-200"), va: account("1-200"), ewallet: account("1-200"), card: account("1-200") },
        default_cash_account: account("1-100"), locked_until: today,
      }, admin)).status, 200);
      const blocked = await request("/operations/finance/records", "POST", {
        kind: "pengeluaran", date: today, account_id: account("5-950"), amount: 10000, settle: "tunai", cash_account_id: account("1-100"), description: "Uji kunci",
      }, admin);
      assert.equal(blocked.status, 409);
      assert.match(blocked.data.message, /dikunci/);
      assert.equal((await request("/operations/finance/records", "POST", {
        kind: "pengeluaran", date: shift(1), account_id: account("5-950"), amount: 10000, settle: "tunai", cash_account_id: account("1-100"), description: "Setelah tanggal kunci",
      }, admin)).status, 201, "tanggal setelah kunci tetap boleh");
      assert.equal((await request("/operations/finance/settings", "PUT", {
        cash_accounts: { cash: account("1-100"), transfer: account("1-200"), qris: account("1-200"), va: account("1-200"), ewallet: account("1-200"), card: account("1-200") },
        default_cash_account: account("1-100"), locked_until: "",
      }, admin)).status, 200);
    });

    await t.test("akun bawaan terlindungi, akun baru dapat dibuat dan dihapus selama belum terpakai", async () => {
      assert.equal((await request(`/operations/finance/accounts/${account("1-100")}`, "DELETE", undefined, admin)).status, 409, "akun bawaan tidak dapat dihapus");
      const created = await request("/operations/finance/accounts", "POST", { code: "5-250", name: "Air Minum Pemain", type: "beban", subtype: "beban", description: "", active: true }, admin);
      assert.equal(created.status, 201);
      assert.equal((await request("/operations/finance/accounts", "POST", { code: "5-250", name: "Nama lain", type: "beban", subtype: "beban", description: "", active: true }, admin)).status, 409, "kode akun tidak boleh kembar");
      assert.equal((await request("/operations/finance/accounts", "POST", { code: "5-260", name: "Salah kelompok", type: "beban", subtype: "kas_bank", description: "", active: true }, admin)).status, 400);
      assert.equal((await request(`/operations/finance/accounts/${created.data.account.id}`, "DELETE", undefined, admin)).status, 204);

      assert.equal((await request(`/operations/finance/partners/${partnerId}`, "DELETE", undefined, admin)).status, 409, "pemasok yang sudah dipakai jurnal dilindungi");
    });

    await t.test("pembatalan booking menarik kembali pendapatan dan pengembalian dana mengurangi kas", async () => {
      assert.equal((await request(`/operations/bookings/${bookingId}/status`, "PATCH", { status: "cancelled", reason: "Hujan deras" }, admin)).status, 200);
      const journal = (await request(`/operations/finance/journal?source=booking`, "GET", undefined, admin)).data;
      assert.equal(journal.entries.length, 0, "pendapatan batal ikut hilang");

      const beforeCash = (await balance(today)).assets.find((row: { code: string }) => row.code === "1-100").amount;
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", payment(200000, "refund", "cash"), admin)).status, 201);
      const sheet = await balance(today);
      assert.equal(sheet.difference, 0, "neraca tetap seimbang setelah pengembalian dana");
      assert.equal(sheet.assets.find((row: { code: string }) => row.code === "1-100").amount, beforeCash - 200000);
      assert.equal(sheet.advances, 100000, "sisa uang pelanggan yang belum dikembalikan");

      const report = (await request(`/operations/finance/reports/laba-rugi?from=${tomorrow}&to=${tomorrow}`, "GET", undefined, admin)).data;
      assert.equal(report.income, 0, "sesi yang batal tidak lagi dihitung sebagai pendapatan");
    });

    await t.test("ringkasan keuangan merangkum kas, laba, piutang, dan tagihan jatuh tempo", async () => {
      const overview = (await request(`/operations/finance/overview?from=${today}&to=${today}`, "GET", undefined, admin)).data;
      const sheet = await balance(today);
      assert.equal(overview.cash_total, sheet.assets.filter((row: { code: string }) => row.code.startsWith("1-1") || row.code === "1-200").reduce((sum: number, row: { amount: number }) => sum + row.amount, 0));
      assert.equal(overview.net, overview.income - overview.expense);
      assert.equal(overview.series.length, 6, "enam bulan terakhir");
      assert.equal(overview.series[5].month, today.slice(0, 7));
      assert.ok(overview.entries.length > 0, "jurnal terbaru ikut ditampilkan");
      assert.equal(overview.payable, 0, "utang pemasok sudah lunas");
    });

    await t.test("piutang dan uang muka dipisah per booking, tidak saling menutupi", async () => {
      const unpaid = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Budi", phone: "081200000002", date: tomorrow, start_time: "13:00", end_time: "14:00", notes: "" }, admin);
      const ahead = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Budi", phone: "081200000002", date: shift(2), start_time: "13:00", end_time: "14:00", notes: "" }, admin);
      assert.equal(unpaid.status, 201); assert.equal(ahead.status, 201);
      assert.equal((await request(`/operations/bookings/${ahead.data.booking.id}/payments`, "POST", payment(300000, "payment", "transfer"), admin)).status, 201);
      const before = await balance(tomorrow);
      assert.equal(before.difference, 0);
      assert.equal(before.receivable, 300000, "sesi besok belum dibayar tetap piutang");
      assert.equal(before.advances, 100000 + 300000, "uang muka sesi lusa ditambah dana Rina yang belum dikembalikan");
      assert.equal(before.assets.find((row: { code: string }) => row.code === "1-300").amount, 300000);

      const ledger = (await request(`/operations/finance/reports/pembantu?kind=piutang&from=${tomorrow}&to=${tomorrow}`, "GET", undefined, admin)).data;
      const budi = ledger.rows.find((row: { name: string }) => row.name === "Budi");
      assert.equal(budi.balance, 0, "per pelanggan saldonya memang nol");
      assert.equal(budi.detail.length, 2, "tetapi rinciannya menunjukkan kedua booking");
      assert.equal(budi.detail.reduce((sum: number, row: { amount: number }) => sum + row.amount, 0), budi.balance, "rincian selalu sama dengan saldo");
      for (const row of ledger.rows) assert.equal(row.detail.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0), row.balance, row.name);
      bookingId = unpaid.data.booking.id;
    });

    await t.test("mengganti rekening tujuan pembayaran tidak memindahkan uang yang sudah diterima", async () => {
      const mapping = (cash: string) => ({ cash_accounts: { cash, transfer: account("1-200"), qris: account("1-200"), va: account("1-200"), ewallet: account("1-200"), card: account("1-200") }, default_cash_account: account("1-100"), locked_until: "" });
      const at = (sheet: { assets: { code: string; amount: number }[] }, code: string) => sheet.assets.find(row => row.code === code)?.amount ?? 0;
      const start = await balance(shift(2));
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", payment(100000, "payment", "cash"), admin)).status, 201);
      assert.equal((await request("/operations/finance/settings", "PUT", mapping(account("1-200")), admin)).status, 200);
      assert.equal((await request(`/operations/bookings/${bookingId}/payments`, "POST", payment(50000, "payment", "cash"), admin)).status, 201);
      const end = await balance(shift(2));
      assert.equal(end.difference, 0);
      assert.equal(at(end, "1-100") - at(start, "1-100"), 100000, "tunai pertama tetap di Kas");
      assert.equal(at(end, "1-200") - at(start, "1-200"), 50000, "tunai berikutnya mengikuti pemetaan baru");
      assert.equal((await request("/operations/finance/settings", "PUT", mapping(account("1-100")), admin)).status, 200);
    });

    await t.test("daftar jurnal dan catatan menyebut jumlah lengkapnya walau dibatasi", async () => {
      const journal = (await request("/operations/finance/journal?limit=1", "GET", undefined, admin)).data;
      assert.equal(journal.entries.length, 1);
      assert.equal(journal.total, (db.prepare("SELECT count(*) n FROM journal_entries").get() as { n: number }).n);
      const records = (await request("/operations/finance/records", "GET", undefined, admin)).data;
      assert.equal(records.count, records.records.length);
      assert.equal(records.expense, (db.prepare("SELECT SUM(amount) n FROM finance_records WHERE kind='pengeluaran'").get() as { n: number }).n);
    });

    await t.test("pajak dan potongan harga masuk ke tagihan, jurnal, dan laba rugi dengan angka yang sama", async () => {
      const day = shift(3);
      const settings = (tax: unknown) => request("/operations/finance/settings", "PUT", {
        cash_accounts: { cash: account("1-100"), transfer: account("1-200"), qris: account("1-200"), va: account("1-200"), ewallet: account("1-200"), card: account("1-200") },
        default_cash_account: account("1-100"), locked_until: "", tax,
      }, admin);
      const code = (key: string) => (db.prepare("SELECT code FROM accounts WHERE system_key=?").get(key) as { code: string }).code;
      const entryOf = async (id: string) => (await request(`/operations/finance/journal?source=booking&from=${day}&to=${day}`, "GET", undefined, admin)).data.entries
        .find((entry: { ref_id: string }) => entry.ref_id === id) as { lines: { account_code: string; debit: number; credit: number }[] };
      const side = (entry: { lines: { account_code: string; debit: number; credit: number }[] }, account: string, key: "debit" | "credit") =>
        entry.lines.filter(line => line.account_code === account).reduce((sum, line) => sum + line[key], 0);

      assert.equal((await settings({ enabled: true, label: "PB1", rate: 10, inclusive: false })).status, 200);
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Sari", phone: "081200000003", date: day, start_time: "08:00", end_time: "09:00", notes: "" }, admin);
      assert.equal(created.status, 201);
      const id = created.data.booking.id;
      assert.equal(created.data.booking.court_total, 300000);
      assert.equal(created.data.booking.tax, 30000, "PB1 10% di luar harga");
      assert.equal(created.data.booking.total, 330000);
      let entry = await entryOf(id);
      assert.equal(side(entry, "1-300", "debit"), 330000, "piutang = yang ditagih");
      assert.equal(side(entry, "4-100", "credit"), 300000, "pendapatan tanpa pajak");
      assert.equal(side(entry, code("utang_pajak"), "credit"), 30000, "pajak menjadi utang, bukan pendapatan");

      assert.equal((await request(`/operations/bookings/${id}/discount`, "PUT", { amount: 50000, note: "" }, admin)).status, 400, "potongan wajib beralasan");
      const discounted = await request(`/operations/bookings/${id}/discount`, "PUT", { amount: 50000, note: "Member" }, admin);
      assert.equal(discounted.status, 200);
      assert.equal(discounted.data.booking.tax, 25000, "pajak dihitung dari harga setelah potongan");
      assert.equal(discounted.data.booking.total, 275000);
      entry = await entryOf(id);
      assert.equal(side(entry, "1-300", "debit"), 275000);
      assert.equal(side(entry, code("potongan_harga"), "debit"), 50000);
      assert.equal(side(entry, code("utang_pajak"), "credit"), 25000);
      const report = (await request(`/operations/finance/reports/laba-rugi?from=${day}&to=${day}`, "GET", undefined, admin)).data;
      assert.equal(report.income, 250000, "pendapatan bersih setelah potongan, tanpa pajak");

      assert.equal((await settings({ enabled: true, label: "PPN", rate: 11, inclusive: true })).status, 200);
      assert.equal((await request(`/operations/bookings/${id}`, "GET", undefined, admin)).data.booking.total, 275000, "mengubah pengaturan pajak tidak mengubah tagihan lama");
      const inclusive = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Tono", phone: "081200000004", date: day, start_time: "10:00", end_time: "11:00", notes: "" }, admin);
      assert.equal(inclusive.data.booking.total, 300000, "harga sudah termasuk PPN");
      assert.equal(inclusive.data.booking.tax, 29730, "11/111 dari 300.000");
      entry = await entryOf(inclusive.data.booking.id);
      assert.equal(side(entry, "4-100", "credit"), 270270);
      assert.equal(side(entry, code("utang_pajak"), "credit"), 29730);

      const sheet = await balance(day);
      assert.equal(sheet.difference, 0);
      assert.equal(sheet.liabilities.find((row: { code: string }) => row.code === code("utang_pajak")).amount, 25000 + 29730);
      const overview = (await request(`/operations/finance/overview?from=${day}&to=${day}`, "GET", undefined, admin)).data;
      assert.equal(overview.tax_payable, 25000 + 29730, "utang pajak tidak bercampur dengan utang pemasok");
      assert.equal(overview.payable, 0);
      assert.equal((await settings({ enabled: false, label: "PPN", rate: 11, inclusive: true })).status, 200);
    });

    await t.test("pembayaran booking batal dapat ditahan sebagian sebagai denda", async () => {
      const day = shift(3);
      const created = await request("/operations/bookings", "POST", { court_id: courtId, customer: "Dewi", phone: "081200000005", date: day, start_time: "14:00", end_time: "15:00", notes: "" }, admin);
      const id = created.data.booking.id;
      assert.equal((await request(`/operations/bookings/${id}/payments`, "POST", payment(100000, "payment", "cash"), admin)).status, 201);
      assert.equal((await request(`/operations/bookings/${id}/forfeit`, "PUT", { amount: 60000 }, admin)).status, 409, "booking aktif tidak bisa didenda");
      assert.equal((await request(`/operations/bookings/${id}/status`, "PATCH", { status: "cancelled", reason: "Batal mendadak" }, admin)).status, 200);
      assert.equal((await request(`/operations/bookings/${id}/forfeit`, "PUT", { amount: 100001 }, admin)).status, 400);
      const kept = await request(`/operations/bookings/${id}/forfeit`, "PUT", { amount: 60000 }, admin);
      assert.equal(kept.status, 200);
      assert.equal(kept.data.booking.forfeited, 60000);

      const report = (await request(`/operations/finance/reports/laba-rugi?from=${today}&to=${today}`, "GET", undefined, admin)).data;
      assert.equal(report.income_lines.find((line: { name: string }) => line.name === "Pendapatan Pembatalan").amount, 60000, "denda diakui pada tanggal ditahan");
      assert.equal((await request(`/operations/bookings/${id}/payments`, "POST", payment(40001, "refund", "cash"), admin)).status, 400, "yang ditahan tidak bisa ikut dikembalikan");
      assert.equal((await request(`/operations/bookings/${id}/payments`, "POST", payment(40000, "refund", "cash"), admin)).status, 201);
      const ledger = (await request(`/operations/finance/reports/pembantu?kind=piutang&from=${today}&to=${shift(3)}`, "GET", undefined, admin)).data;
      assert.ok(!ledger.rows.some((row: { name: string; balance: number }) => row.name === "Dewi" && row.balance !== 0), "tidak ada sisa uang Dewi yang menggantung");
      assert.equal((await balance(shift(3))).difference, 0);
    });

    await t.test("seluruh jurnal seimbang: total debit sama dengan total kredit", async () => {
      const totals = db.prepare("SELECT SUM(debit) debit,SUM(credit) credit FROM journal_lines").get() as { debit: number; credit: number };
      assert.equal(totals.debit, totals.credit);
      const perEntry = db.prepare("SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING SUM(debit)<>SUM(credit)").all();
      assert.equal(perEntry.length, 0, "tidak ada satu pun jurnal yang timpang");
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
