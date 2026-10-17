import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { localClock } from "./clock.js";
import { checkImage } from "./photos.js";
import { allocate, taxSettings, type TaxSettings } from "./bill.js";

/**
 * Pembukuan venue. Seluruh laporan (laba rugi, neraca, buku besar, buku besar pembantu) dihitung
 * dari satu sumber: jurnal berpasangan pada `journal_entries` + `journal_lines`. Karena setiap
 * jurnal wajib seimbang, neraca tidak pernah perlu "dicocokkan" secara manual.
 *
 * Yang dijurnal otomatis:
 * - Pendapatan booking dicatat pada TANGGAL SESI bermain (Dr Piutang Usaha, Cr akun pendapatan).
 * - Setiap pembayaran dan pengembalian dana dicatat pada tanggal transaksinya (Dr/Cr Kas atau Bank).
 * Uang yang sudah masuk untuk sesi yang belum main membuat saldo piutang pelanggan menjadi negatif;
 * di neraca saldo itu digeser menjadi kewajiban "Uang Muka Pelanggan" (lihat balanceSheet).
 *
 * Modul ini sengaja tidak mengimpor operations.ts maupun payments.ts agar tidak ada lingkaran impor:
 * data booking dibaca langsung dari tabelnya.
 */

export type AccountType = "aset" | "liabilitas" | "ekuitas" | "pendapatan" | "beban";
export type AccountSubtype = "kas_bank" | "piutang" | "persediaan" | "aset_tetap" | "utang" | "modal" | "pendapatan" | "beban";
export type EntrySource = "manual" | "catatan" | "pelunasan" | "transfer" | "modal" | "booking" | "pembayaran";
export interface Account { id: string; code: string; name: string; type: AccountType; subtype: AccountSubtype; is_cash: number; system_key: string | null; description: string; active: number; position: number; created_at: string }
export interface Partner { id: string; name: string; kind: "pemasok" | "pelanggan" | "karyawan" | "lainnya"; phone: string; note: string; active: number; created_at: string }
export interface JournalLine { id: string; account_id: string; account_code: string; account_name: string; debit: number; credit: number; memo: string; partner_id: string | null; partner_name: string | null; booking_id: string | null }
export interface JournalEntry { id: string; number: string; date: string; memo: string; source: EntrySource; ref_id: string | null; created_by: string | null; created_at: string; lines: JournalLine[] }
export interface FinanceRecord {
  id: string; number: string; kind: "pengeluaran" | "pemasukan"; date: string; account_id: string; account_code: string; account_name: string;
  amount: number; settle: "tunai" | "tempo"; cash_account_id: string | null; cash_account_name: string | null;
  partner_id: string | null; partner_name: string | null; description: string; due_date: string | null;
  settled_at: string | null; entry_id: string | null; entry_number: string | null; photo_id: string | null; created_by: string | null; created_at: string;
}
export interface GatewayFee { percent: number; flat: number }
export interface FinanceSettings {
  cash_accounts: Record<string, string>; default_cash_account: string; locked_until: string; updated_at: string;
  tax: TaxSettings; gateway_fees: Record<string, GatewayFee>;
}

const maxAmount = 999_999_999_999;
const periodOf = (input: unknown) => {
  const value = z.object({ from: dateSchema, to: dateSchema }).parse(input);
  check(value.from <= value.to, 400, "Tanggal akhir harus sama dengan atau setelah tanggal mulai.");
  return value;
};
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid.").refine(value => {
  const date = new Date(value + "T00:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Tanggal tidak valid.");
const optionalDate = z.union([dateSchema, z.literal("")]).default("");
const amountSchema = z.number().int().positive().max(maxAmount, "Nominal terlalu besar.");
const idSchema = z.string().trim().min(1).max(64);

// --- Akun & mitra ----------------------------------------------------------

const accountColumns = "id,code,name,type,subtype,is_cash,system_key,description,active,position,created_at";
export const accounts = async () => await db.prepare(`SELECT ${accountColumns} FROM accounts ORDER BY code`).all() as Account[];
export const partners = async () => await db.prepare("SELECT id,name,kind,phone,note,active,created_at FROM partners ORDER BY name").all() as Partner[];
async function getAccount(id: string) {
  const account = await db.prepare(`SELECT ${accountColumns} FROM accounts WHERE id=?`).get(id) as Account | undefined;
  check(account, 404, "Akun tidak ditemukan.");
  return account;
}
async function systemAccount(key: string) {
  const account = await db.prepare(`SELECT ${accountColumns} FROM accounts WHERE system_key=?`).get(key) as Account | undefined;
  check(account, 500, "Bagan akun bawaan tidak lengkap. Jalankan ulang API agar akun standar dibuat kembali.");
  return account;
}

export async function settings(): Promise<FinanceSettings> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key`='finance'").get() as { document: string } | undefined;
  const stored = row ? JSON.parse(row.document) as Partial<FinanceSettings> : {};
  return {
    cash_accounts: stored.cash_accounts ?? {}, default_cash_account: stored.default_cash_account ?? "", locked_until: stored.locked_until ?? "", updated_at: stored.updated_at ?? "",
    tax: await taxSettings(), gateway_fees: stored.gateway_fees ?? {},
  };
}
/** Potongan payment gateway untuk satu pembayaran online, sesuai tarif yang diatur di Pengaturan. */
export async function gatewayFee(method: string, amount: number) {
  const fee = (await settings()).gateway_fees[method];
  if (!fee) return 0;
  return Math.max(0, Math.min(amount, Math.round(amount * fee.percent / 100) + fee.flat));
}
/** Akun kas/bank tujuan sebuah metode pembayaran. Jatuh ke Kas bila pengaturannya sudah tidak valid. */
async function cashAccountFor(method: string) {
  const config = await settings();
  for (const candidate of [config.cash_accounts[method], config.default_cash_account]) {
    if (candidate && await db.prepare("SELECT 1 FROM accounts WHERE id=? AND is_cash=1 AND active=1").get(candidate)) return candidate;
  }
  return (await systemAccount("kas")).id;
}
/** Pembukuan yang sudah dikunci tidak boleh disentuh lagi oleh pencatatan manual. */
export async function ensureOpen(date: string) {
  const locked = (await settings()).locked_until;
  check(!locked || date > locked, 409, `Pembukuan sampai ${locked} sudah dikunci. Pilih tanggal setelahnya atau ubah kuncinya di Pengaturan.`);
}

// --- Jurnal ----------------------------------------------------------------

interface LineInput { account_id: string; debit?: number; credit?: number; memo?: string; partner_id?: string | null; booking_id?: string | null }
interface EntryInput { date: string; memo: string; source: EntrySource; ref_id?: string | null; lines: LineInput[]; actor: string | null }

async function nextNumber(table: "journal_entries" | "finance_records", prefix: string, year: string) {
  const last = await db.prepare(`SELECT number FROM ${table} WHERE number LIKE ? ORDER BY number DESC LIMIT 1`).get(`${prefix}-${year}-%`) as { number: string } | undefined;
  return `${prefix}-${year}-${String(last ? Number(last.number.slice(-5)) + 1 : 1).padStart(5, "0")}`;
}

/**
 * Tulis satu jurnal. Bila `ref_id` diisi, jurnal lama dengan sumber dan rujukan yang sama ditimpa —
 * itulah yang membuat penjurnalan otomatis aman dipanggil berulang kali.
 */
async function putEntry(input: EntryInput) {
  const lines = input.lines.filter(line => (line.debit ?? 0) > 0 || (line.credit ?? 0) > 0);
  check(lines.length >= 2, 400, "Jurnal membutuhkan minimal dua baris.");
  check(lines.every(line => ((line.debit ?? 0) > 0) !== ((line.credit ?? 0) > 0)), 400, "Setiap baris hanya boleh diisi debit saja atau kredit saja.");
  const debit = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
  const credit = lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
  check(debit === credit, 400, "Jurnal belum seimbang: total debit harus sama dengan total kredit.");
  const existing = input.ref_id
    ? await db.prepare("SELECT id FROM journal_entries WHERE source=? AND ref_id=?").get(input.source, input.ref_id) as { id: string } | undefined
    : undefined;
  const id = existing?.id ?? randomUUID();
  if (existing) {
    await db.prepare("UPDATE journal_entries SET date=?,memo=? WHERE id=?").run(input.date, input.memo, id);
    await db.prepare("DELETE FROM journal_lines WHERE entry_id=?").run(id);
  } else {
    await db.prepare("INSERT INTO journal_entries (id,number,date,memo,source,ref_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, await nextNumber("journal_entries", "JU", input.date.slice(0, 4)), input.date, input.memo, input.source, input.ref_id ?? null, input.actor, new Date().toISOString());
  }
  for (const [position, line] of lines.entries())
    await db.prepare("INSERT INTO journal_lines (id,entry_id,account_id,debit,credit,memo,partner_id,booking_id,position) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), id, line.account_id, line.debit ?? 0, line.credit ?? 0, line.memo ?? "", line.partner_id ?? null, line.booking_id ?? null, position);
  return id;
}
async function dropEntry(source: EntrySource, refId: string) {
  const entry = await db.prepare("SELECT id FROM journal_entries WHERE source=? AND ref_id=?").get(source, refId) as { id: string } | undefined;
  if (entry) await db.prepare("DELETE FROM journal_entries WHERE id=?").run(entry.id);
}

// --- Penjurnalan otomatis dari operasional ---------------------------------

const addonAccountKey: Record<string, string> = { sewa: "pendapatan_sewa", jual: "pendapatan_barang", layanan: "pendapatan_jasa", lainnya: "pendapatan_lain" };

/**
 * Samakan jurnal sebuah booking dengan keadaannya sekarang: pendapatan diakui saat booking aktif
 * atau selesai, dan dihapus lagi bila booking batal atau kedaluwarsa. Dipanggil dari operations.ts
 * dan payments.ts di dalam transaksi yang sudah berjalan, jadi fungsi ini tidak membuka transaksi.
 *
 * Jurnal pendapatan: Dr Piutang (total tagihan) + Dr Potongan Harga (diskon)
 *                    = Cr pendapatan per jenis (tanpa pajak) + Cr Utang Pajak.
 * Booking batal yang pembayarannya ditahan sebagai denda: Dr Piutang, Cr Pendapatan Pembatalan.
 */
export async function syncBooking(bookingId: string) {
  const booking = await db.prepare("SELECT id,customer,date,status,total,court_total,discount,tax,forfeited,forfeited_at FROM bookings WHERE id=?").get(bookingId) as
    { id: string; customer: string; date: string; status: string; total: number; court_total: number | null; discount: number; tax: number; forfeited: number; forfeited_at: string | null } | undefined;
  if (!booking) return;
  const receivable = { account_id: (await systemAccount("piutang")).id, booking_id: booking.id, memo: booking.customer };
  if (booking.status === "confirmed" || booking.status === "completed") {
    const extras = await db.prepare("SELECT type,SUM(subtotal) amount FROM booking_addons WHERE booking_id=? GROUP BY type").all(bookingId) as { type: string; amount: number }[];
    const extrasTotal = extras.reduce((sum, row) => sum + row.amount, 0);
    // Pendapatan bersih pajak; berlaku untuk pajak di luar maupun sudah termasuk harga.
    const revenue = booking.total + booking.discount - booking.tax;
    const parts = [{ key: "pendapatan_lapangan", amount: booking.court_total ?? booking.total - extrasTotal }];
    for (const row of extras) parts.push({ key: addonAccountKey[row.type] ?? "pendapatan_lain", amount: row.amount });
    const shares = allocate(revenue, parts.map(part => Math.max(0, part.amount)));
    const merged = new Map<string, number>();
    parts.forEach((part, index) => merged.set(part.key, (merged.get(part.key) ?? 0) + shares[index]));
    const revenueLines: LineInput[] = [];
    for (const [key, amount] of merged) revenueLines.push({ account_id: (await systemAccount(key)).id, credit: amount });
    await putEntry({
      date: booking.date, source: "booking", ref_id: booking.id, actor: null,
      memo: `Pendapatan booking ${booking.customer}`,
      lines: [
        { ...receivable, debit: booking.total },
        { account_id: (await systemAccount("potongan_harga")).id, debit: booking.discount, memo: "Potongan harga" },
        ...revenueLines,
        { account_id: (await systemAccount("utang_pajak")).id, credit: booking.tax, memo: booking.customer },
      ],
    });
  } else if (booking.forfeited > 0) {
    await putEntry({
      date: booking.forfeited_at ?? booking.date, source: "booking", ref_id: booking.id, actor: null,
      memo: `Pembayaran booking batal ditahan · ${booking.customer}`,
      lines: [{ ...receivable, debit: booking.forfeited }, { account_id: (await systemAccount("pendapatan_pembatalan")).id, credit: booking.forfeited }],
    });
  } else await dropEntry("booking", booking.id);
  // Pembayaran tidak pernah berubah setelah dicatat, jadi jurnalnya cukup dibuat sekali. Menulis ulang
  // jurnal lama akan memindahkan uang yang sudah diterima ke rekening lain begitu pemetaan kas di
  // Pengaturan diganti, dan saldo kas periode yang sudah ditutup ikut bergeser diam-diam.
  const payments = await db.prepare(`SELECT p.id,p.amount,p.fee,p.kind,p.method,p.created_at FROM payments p
    WHERE p.booking_id=? AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.source='pembayaran' AND e.ref_id=p.id)
    ORDER BY p.created_at`).all(bookingId) as
    { id: string; amount: number; fee: number; kind: "payment" | "refund"; method: string; created_at: string }[];
  for (const payment of payments) {
    const cash = { account_id: await cashAccountFor(payment.method), memo: `${payment.kind === "refund" ? "Pengembalian" : "Pembayaran"} ${payment.method}` };
    // Potongan payment gateway tidak pernah masuk rekening: dicatat sebagai beban, bukan pengurang piutang.
    const fee = payment.kind === "payment" ? Math.min(payment.fee, payment.amount) : 0;
    await putEntry({
      date: localClock(new Date(payment.created_at)).date, source: "pembayaran", ref_id: payment.id, actor: null,
      memo: `${payment.kind === "refund" ? "Pengembalian dana" : "Penerimaan"} ${booking.customer}`,
      lines: payment.kind === "refund"
        ? [{ ...receivable, debit: payment.amount }, { ...cash, credit: payment.amount }]
        : [{ ...cash, debit: payment.amount - fee }, { account_id: (await systemAccount("beban_gateway")).id, debit: fee, memo: "Potongan payment gateway" }, { ...receivable, credit: payment.amount }],
    });
  }
}

// Versi SQLite dulu membukukan ulang booking lama sekali (migrasi 12). Di MySQL tidak perlu: booking baru
// langsung dibukukan, dan data hasil impor SQLite atau pemulihan backup sudah membawa jurnalnya.

// --- Saldo & rangkuman -----------------------------------------------------

interface Movement { account_id: string; debit: number; credit: number }
async function movements(from: string | null, to: string | null) {
  const rows = await db.prepare(`SELECT l.account_id,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE (? IS NULL OR e.date>=?) AND (? IS NULL OR e.date<=?) GROUP BY l.account_id`).all(from, from, to, to) as Movement[];
  return new Map(rows.map(row => [row.account_id, row]));
}
/** Saldo positif berarti "normal": aset dan beban bertambah di debit, sisanya di kredit. */
const signed = (type: AccountType, debit: number, credit: number) => (type === "aset" || type === "beban" ? debit - credit : credit - debit);
const balanceOf = (account: Account, index: Map<string, Movement>) => {
  const row = index.get(account.id);
  return row ? signed(account.type, row.debit, row.credit) : 0;
};
const shiftDay = (date: string, days: number) => { const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10) };
const shiftMonth = (date: string, months: number) => { const value = new Date(date.slice(0, 7) + "-01T00:00:00Z"); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10) };
const monthEnd = (date: string) => shiftDay(shiftMonth(date, 1), -1);
const dayCount = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;

/** Saldo piutang tiap pelanggan, dipakai buku besar pembantu sekaligus reklasifikasi neraca. */
async function receivableByCustomer(to: string) {
  const rows = await db.prepare(`SELECT COALESCE(b.customer_id,b.phone) \`key\`,b.customer,b.phone,SUM(l.debit-l.credit) balance
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN bookings b ON b.id=l.booking_id
    JOIN accounts a ON a.id=l.account_id
    WHERE a.system_key='piutang' AND e.date<=? GROUP BY \`key\`,b.customer,b.phone`).all(to) as
    { key: string; customer: string; phone: string; balance: number }[];
  const merged = new Map<string, { key: string; customer: string; phone: string; balance: number }>();
  for (const row of rows) {
    const current = merged.get(row.key);
    if (current) current.balance += row.balance; else merged.set(row.key, { ...row });
  }
  return [...merged.values()];
}
/**
 * Saldo piutang tiap booking. Piutang dan uang muka dipisah per booking, bukan dinetokan per
 * pelanggan: sesi yang sudah main tapi belum dibayar tetap piutang walau pelanggan yang sama sudah
 * membayar di muka untuk sesi minggu depan.
 */
async function receivableByBooking(to: string) {
  return await db.prepare(`SELECT COALESCE(b.customer_id,b.phone) \`key\`,b.id,b.date,b.start_time,SUM(l.debit-l.credit) balance
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN bookings b ON b.id=l.booking_id
    JOIN accounts a ON a.id=l.account_id
    WHERE a.system_key='piutang' AND e.date<=? GROUP BY b.id HAVING balance<>0 ORDER BY b.date,b.start_time`).all(to) as
    { key: string; id: string; date: string; start_time: string; balance: number }[];
}

export async function profitLoss(input: unknown) {
  const { from, to } = periodOf(input);
  const index = await movements(from, to);
  const span = dayCount(from, to);
  const previousTo = shiftDay(from, -1), previousFrom = shiftDay(previousTo, -(span - 1));
  const previousIndex = await movements(previousFrom, previousTo);
  const rows = (await accounts()).filter(account => account.type === "pendapatan" || account.type === "beban")
    .map(account => ({ id: account.id, code: account.code, name: account.name, type: account.type, amount: balanceOf(account, index), previous: balanceOf(account, previousIndex) }))
    .filter(row => row.amount !== 0 || row.previous !== 0);
  const total = (type: AccountType, key: "amount" | "previous") => rows.filter(row => row.type === type).reduce((sum, row) => sum + row[key], 0);
  const income = total("pendapatan", "amount"), expense = total("beban", "amount");
  const previousIncome = total("pendapatan", "previous"), previousExpense = total("beban", "previous");
  return {
    from, to, previous: { from: previousFrom, to: previousTo, income: previousIncome, expense: previousExpense, net: previousIncome - previousExpense },
    income_lines: rows.filter(row => row.type === "pendapatan"), expense_lines: rows.filter(row => row.type === "beban"),
    income, expense, net: income - expense,
  };
}

export async function balanceSheet(input: unknown) {
  const { as_of } = z.object({ as_of: dateSchema }).parse(input);
  const index = await movements(null, as_of);
  const all = await accounts();
  const line = (account: Account) => ({ id: account.id, code: account.code, name: account.name, amount: balanceOf(account, index) });
  const perBooking = await receivableByBooking(as_of);
  const outstanding = perBooking.filter(row => row.balance > 0).reduce((sum, row) => sum + row.balance, 0);
  const advances = perBooking.filter(row => row.balance < 0).reduce((sum, row) => sum - row.balance, 0);
  const assets = all.filter(account => account.type === "aset").map(account => {
    // Saldo piutang yang negatif berarti pelanggan sudah membayar sesi yang belum main:
    // itu kewajiban venue, bukan aset, jadi dipindahkan ke sisi kanan neraca.
    if (account.system_key === "piutang") return { ...line(account), amount: line(account).amount + advances };
    return line(account);
  }).filter(row => row.amount !== 0);
  const liabilities = all.filter(account => account.type === "liabilitas").map(line).filter(row => row.amount !== 0);
  if (advances > 0) liabilities.push({ id: "uang-muka", code: "2-900", name: "Uang Muka Pelanggan", amount: advances });
  const equityAccounts = all.filter(account => account.type === "ekuitas").map(line).filter(row => row.amount !== 0);
  const income = all.filter(account => account.type === "pendapatan").reduce((sum, account) => sum + balanceOf(account, index), 0);
  const expense = all.filter(account => account.type === "beban").reduce((sum, account) => sum + balanceOf(account, index), 0);
  const equity = [...equityAccounts, { id: "laba", code: "3-900", name: "Laba Ditahan & Laba Berjalan", amount: income - expense }].filter(row => row.amount !== 0);
  const totalAssets = assets.reduce((sum, row) => sum + row.amount, 0);
  const totalLiabilities = liabilities.reduce((sum, row) => sum + row.amount, 0);
  const totalEquity = equity.reduce((sum, row) => sum + row.amount, 0);
  const group = (subtype: AccountSubtype) => assets.filter(row => all.find(account => account.id === row.id)?.subtype === subtype);
  return {
    as_of, assets, liabilities, equity,
    asset_groups: [
      { label: "Kas & bank", rows: group("kas_bank") },
      { label: "Piutang", rows: group("piutang") },
      { label: "Persediaan", rows: group("persediaan") },
      { label: "Peralatan & inventaris", rows: group("aset_tetap") },
    ].filter(section => section.rows.length),
    total_assets: totalAssets, total_liabilities: totalLiabilities, total_equity: totalEquity,
    difference: totalAssets - (totalLiabilities + totalEquity), receivable: outstanding, advances,
  };
}

const ledgerRowLimit = 5000;
export async function generalLedger(input: unknown) {
  const { from, to } = periodOf(input);
  const { account_id } = z.object({ account_id: idSchema }).parse(input);
  const account = await getAccount(account_id);
  const before = await db.prepare(`SELECT COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit FROM journal_lines l
    JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=? AND e.date<?`).get(account_id, from) as { debit: number; credit: number };
  const rows = await db.prepare(`SELECT e.id entry_id,e.number,e.date,e.memo,e.source,l.debit,l.credit,l.memo line_memo,
      (SELECT group_concat(DISTINCT a2.name) FROM journal_lines l2 JOIN accounts a2 ON a2.id=l2.account_id WHERE l2.entry_id=e.id AND l2.account_id<>l.account_id) counter
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE l.account_id=? AND e.date BETWEEN ? AND ? ORDER BY e.date,e.number,l.position LIMIT ?`).all(account_id, from, to, ledgerRowLimit + 1) as
    { entry_id: string; number: string; date: string; memo: string; source: EntrySource; debit: number; credit: number; line_memo: string; counter: string | null }[];
  // Total periode dihitung dari seluruh mutasi, bukan dari baris yang ditampilkan, agar saldo akhir
  // tetap benar walau rinciannya dipotong.
  const period = await db.prepare(`SELECT COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit FROM journal_lines l
    JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=? AND e.date BETWEEN ? AND ?`).get(account_id, from, to) as { debit: number; credit: number };
  const truncated = rows.length > ledgerRowLimit;
  let running = signed(account.type, before.debit, before.credit);
  const opening = running;
  const ledger = rows.slice(0, ledgerRowLimit).map(row => {
    running += signed(account.type, row.debit, row.credit);
    return { ...row, counter: row.counter ?? "", balance: running };
  });
  return {
    from, to, account, opening, closing: opening + signed(account.type, period.debit, period.credit), rows: ledger,
    debit: period.debit, credit: period.credit, truncated,
  };
}

/** Buku besar pembantu: rincian piutang per pelanggan, utang per pemasok, dan kas per rekening. */
export async function subsidiaryLedger(input: unknown) {
  const { from, to } = periodOf(input);
  const { kind } = z.object({ kind: z.enum(["piutang", "utang", "kas"]) }).parse(input);
  const openingIndex = await movements(null, shiftDay(from, -1));
  const periodIndex = await movements(from, to);
  if (kind === "kas") {
    const rows = (await accounts()).filter(account => account.is_cash).map(account => {
      const period = periodIndex.get(account.id);
      return {
        key: account.id, name: account.name, subtitle: account.description,
        opening: balanceOf(account, openingIndex), debit: period?.debit ?? 0, credit: period?.credit ?? 0,
        balance: balanceOf(account, openingIndex) + (period?.debit ?? 0) - (period?.credit ?? 0), detail: [] as { label: string; amount: number }[],
      };
    });
    return { kind, from, to, rows, total: rows.reduce((sum, row) => sum + row.balance, 0) };
  }
  if (kind === "piutang") {
    const before = new Map((await receivableByCustomer(shiftDay(from, -1))).map(row => [row.key, row.balance]));
    const now = await receivableByCustomer(to);
    const period = await db.prepare(`SELECT COALESCE(b.customer_id,b.phone) \`key\`,SUM(l.debit) debit,SUM(l.credit) credit
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN bookings b ON b.id=l.booking_id JOIN accounts a ON a.id=l.account_id
      WHERE a.system_key='piutang' AND e.date BETWEEN ? AND ? GROUP BY \`key\``).all(from, to) as { key: string; debit: number; credit: number }[];
    const moves = new Map(period.map(row => [row.key, row]));
    // Rincian diambil dari jurnal yang sama dengan saldonya, jadi jumlah rincian selalu sama dengan
    // saldo akhir: termasuk uang muka sesi mendatang dan dana booking batal yang belum dikembalikan.
    const open = await receivableByBooking(to);
    const rows = now.map(row => ({
      key: row.key, name: row.customer, subtitle: row.phone,
      opening: before.get(row.key) ?? 0, debit: moves.get(row.key)?.debit ?? 0, credit: moves.get(row.key)?.credit ?? 0, balance: row.balance,
      detail: open.filter(booking => booking.key === row.key)
        .map(booking => ({ label: `${booking.date} · ${booking.start_time}${booking.balance < 0 ? " · uang muka" : ""}`, amount: booking.balance })),
    })).filter(row => row.balance !== 0 || row.debit !== 0 || row.credit !== 0)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    return { kind, from, to, rows, total: rows.reduce((sum, row) => sum + row.balance, 0) };
  }
  const payableRows = await db.prepare(`SELECT l.partner_id \`key\`,COALESCE(p.name,'Tanpa pemasok') name,COALESCE(p.phone,'') phone,e.date,l.debit,l.credit
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id LEFT JOIN partners p ON p.id=l.partner_id
    WHERE a.subtype='utang' AND COALESCE(a.system_key,'')<>'utang_pajak' AND e.date<=?`).all(to) as { key: string | null; name: string; phone: string; date: string; debit: number; credit: number }[];
  const grouped = new Map<string, { key: string; name: string; subtitle: string; opening: number; debit: number; credit: number; balance: number; detail: { label: string; amount: number }[] }>();
  for (const row of payableRows) {
    const key = row.key ?? "tanpa-pemasok";
    const current = grouped.get(key) ?? { key, name: row.name, subtitle: row.phone, opening: 0, debit: 0, credit: 0, balance: 0, detail: [] };
    const amount = row.credit - row.debit;
    current.balance += amount;
    if (row.date < from) current.opening += amount;
    else { current.debit += row.debit; current.credit += row.credit }
    grouped.set(key, current);
  }
  const unpaid = await db.prepare(`SELECT r.partner_id \`key\`,r.number,r.date,r.amount,r.due_date FROM finance_records r
    WHERE r.kind='pengeluaran' AND r.settle='tempo' AND r.settled_at IS NULL AND r.date<=?`).all(to) as
    { key: string | null; number: string; date: string; amount: number; due_date: string | null }[];
  for (const row of unpaid) {
    const current = grouped.get(row.key ?? "tanpa-pemasok");
    if (current) current.detail.push({ label: `${row.number} · jatuh tempo ${row.due_date || row.date}`, amount: row.amount });
  }
  const rows = [...grouped.values()].filter(row => row.balance !== 0 || row.debit !== 0 || row.credit !== 0).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return { kind, from, to, rows, total: rows.reduce((sum, row) => sum + row.balance, 0) };
}

export async function overview(input: unknown) {
  const { from, to } = z.object({ from: optionalDate, to: optionalDate }).transform(value => {
    const today = localClock().date;
    return { from: value.from || today.slice(0, 7) + "-01", to: value.to || today };
  }).parse(input ?? {});
  const report = await profitLoss({ from, to });
  const sheet = await balanceSheet({ as_of: to });
  const all = await accounts();
  const index = await movements(null, to);
  const cash = all.filter(account => account.is_cash).map(account => ({ id: account.id, name: account.name, balance: balanceOf(account, index) }));
  const series = await Promise.all(Array.from({ length: 6 }, async (_, offset) => {
    const start = shiftMonth(to, offset - 5);
    const end = offset === 5 ? to : monthEnd(start);
    const period = await movements(start, end);
    const sum = (type: AccountType) => all.filter(account => account.type === type).reduce((value, account) => value + balanceOf(account, period), 0);
    return { month: start.slice(0, 7), income: sum("pendapatan"), expense: sum("beban") };
  }));
  // Utang pajak bukan tagihan pemasok, jadi ditampilkan terpisah.
  const payable = all.filter(account => account.subtype === "utang" && account.system_key !== "utang_pajak").reduce((sum, account) => sum + balanceOf(account, index), 0);
  const taxPayable = all.filter(account => account.system_key === "utang_pajak").reduce((sum, account) => sum + balanceOf(account, index), 0);
  const due = await db.prepare(`SELECT r.id,r.number,r.kind,r.date,r.amount,r.due_date,COALESCE(p.name,'') partner_name,a.name account_name
    FROM finance_records r JOIN accounts a ON a.id=r.account_id LEFT JOIN partners p ON p.id=r.partner_id
    WHERE r.settle='tempo' AND r.settled_at IS NULL ORDER BY COALESCE(r.due_date,r.date),r.number LIMIT 8`).all() as Record<string, unknown>[];
  return {
    ...localClock(), from, to,
    income: report.income, expense: report.expense, net: report.net, previous: report.previous,
    cash, cash_total: cash.reduce((sum, row) => sum + row.balance, 0),
    receivable: sheet.receivable, advances: sheet.advances, payable, tax_payable: taxPayable,
    expense_lines: [...report.expense_lines].sort((a, b) => b.amount - a.amount).slice(0, 6),
    income_lines: [...report.income_lines].sort((a, b) => b.amount - a.amount).slice(0, 6),
    series, due, entries: (await journal({ from, to, limit: 8 })).entries,
  };
}

// --- Daftar jurnal ---------------------------------------------------------

export async function journal(input: unknown) {
  const query = z.object({ from: optionalDate, to: optionalDate, account_id: idSchema.optional(), source: z.string().trim().max(20).optional(), q: z.string().trim().max(60).default(""), limit: z.coerce.number().int().min(1).max(10000).default(200) }).parse(input ?? {});
  const from = query.from || "0000-01-01", to = query.to || "9999-12-31";
  const account = query.account_id ?? null, source = query.source || null, term = query.q.toLowerCase();
  const where = `FROM journal_entries e WHERE e.date BETWEEN ? AND ? AND (? IS NULL OR EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id=e.id AND l.account_id=?))
      AND (? IS NULL OR e.source=?) AND (?='' OR lower(e.memo) LIKE CONCAT('%',?,'%') OR lower(e.number) LIKE CONCAT('%',?,'%'))`;
  const params = [from, to, account, account, source, source, term, term, term];
  const rows = await db.prepare(`SELECT e.id,e.number,e.date,e.memo,e.source,e.ref_id,e.created_by,e.created_at ${where}
    ORDER BY e.date DESC,e.number DESC LIMIT ?`).all(...params, query.limit) as Omit<JournalEntry, "lines">[];
  const { total } = await db.prepare(`SELECT count(*) total ${where}`).get(...params) as { total: number };
  const entries: JournalEntry[] = [];
  for (const entry of rows) entries.push({ ...entry, lines: await entryLines(entry.id) });
  return { entries, total };
}
async function entryLines(entryId: string) {
  return await db.prepare(`SELECT l.id,l.account_id,a.code account_code,a.name account_name,l.debit,l.credit,l.memo,l.partner_id,p.name partner_name,l.booking_id
    FROM journal_lines l JOIN accounts a ON a.id=l.account_id LEFT JOIN partners p ON p.id=l.partner_id
    WHERE l.entry_id=? ORDER BY l.position`).all(entryId) as JournalLine[];
}

export const journalSchema = z.object({
  date: dateSchema, memo: z.string().trim().min(3, "Isi keterangan jurnal.").max(200),
  lines: z.array(z.object({
    account_id: idSchema, debit: z.number().int().min(0).max(maxAmount).default(0), credit: z.number().int().min(0).max(maxAmount).default(0),
    memo: z.string().trim().max(120).default(""), partner_id: idSchema.nullish(),
  })).min(2, "Jurnal membutuhkan minimal dua baris.").max(20, "Maksimal 20 baris per jurnal."),
});
export async function saveJournal(input: unknown, actor: string, id?: string) {
  const data = journalSchema.parse(input);
  return await transaction(async () => {
    await ensureOpen(data.date);
    for (const line of data.lines) if (line.partner_id) check(await db.prepare("SELECT 1 FROM partners WHERE id=?").get(line.partner_id), 404, "Pemasok atau pihak pada jurnal tidak ditemukan.");
    if (id) {
      const existing = await db.prepare("SELECT id,source,date FROM journal_entries WHERE id=?").get(id) as { id: string; source: EntrySource; date: string } | undefined;
      check(existing, 404, "Jurnal tidak ditemukan.");
      check(existing.source === "manual", 409, "Jurnal ini dibuat otomatis dari data operasional dan tidak dapat diubah di sini.");
      await ensureOpen(existing.date);
      await db.prepare("UPDATE journal_entries SET date=?,memo=? WHERE id=?").run(data.date, data.memo, id);
      await db.prepare("DELETE FROM journal_lines WHERE entry_id=?").run(id);
      const lines = data.lines.filter(line => line.debit > 0 || line.credit > 0);
      check(lines.length >= 2, 400, "Jurnal membutuhkan minimal dua baris.");
      check(lines.every(line => (line.debit > 0) !== (line.credit > 0)), 400, "Setiap baris hanya boleh diisi debit saja atau kredit saja.");
      check(lines.reduce((sum, line) => sum + line.debit, 0) === lines.reduce((sum, line) => sum + line.credit, 0), 400, "Jurnal belum seimbang: total debit harus sama dengan total kredit.");
      for (const line of lines) await getAccount(line.account_id);
      for (const [position, line] of lines.entries())
        await db.prepare("INSERT INTO journal_lines (id,entry_id,account_id,debit,credit,memo,partner_id,booking_id,position) VALUES (?,?,?,?,?,?,?,NULL,?)")
          .run(randomUUID(), id, line.account_id, line.debit, line.credit, line.memo, line.partner_id ?? null, position);
      await audit(actor, "journal.update", id, { date: data.date, memo: data.memo, total: lines.reduce((sum, line) => sum + line.debit, 0), lines: lines.length });
    } else {
      for (const line of data.lines) await getAccount(line.account_id);
      id = await putEntry({ date: data.date, memo: data.memo, source: "manual", actor, lines: data.lines });
      await audit(actor, "journal.create", id, { date: data.date, memo: data.memo, total: data.lines.reduce((sum, line) => sum + line.debit, 0) });
    }
    const entry = await db.prepare("SELECT id,number,date,memo,source,ref_id,created_by,created_at FROM journal_entries WHERE id=?").get(id) as Omit<JournalEntry, "lines">;
    return { ...entry, lines: await entryLines(id!) };
  });
}
export async function removeJournal(id: string, actor: string) {
  await transaction(async () => {
    const entry = await db.prepare("SELECT id,number,source,date,memo FROM journal_entries WHERE id=?").get(id) as { id: string; number: string; source: EntrySource; date: string; memo: string } | undefined;
    check(entry, 404, "Jurnal tidak ditemukan.");
    check(entry.source === "manual", 409, "Jurnal otomatis tidak dapat dihapus. Ubah datanya di menu asalnya.");
    const total = (await db.prepare("SELECT COALESCE(SUM(debit),0) total FROM journal_lines WHERE entry_id=?").get(id) as { total: number }).total;
    await ensureOpen(entry.date);
    await db.prepare("DELETE FROM journal_entries WHERE id=?").run(id);
    await audit(actor, "journal.delete", id, { number: entry.number, date: entry.date, memo: entry.memo, total });
  });
}

// --- Catatan pengeluaran & pemasukan --------------------------------------

const recordColumns = `r.id,r.number,r.kind,r.date,r.account_id,a.code account_code,a.name account_name,r.amount,r.settle,
  r.cash_account_id,c.name cash_account_name,r.partner_id,p.name partner_name,r.description,r.due_date,r.settled_at,
  r.entry_id,e.number entry_number,r.photo_id,r.created_by,r.created_at`;
const recordFrom = `FROM finance_records r JOIN accounts a ON a.id=r.account_id LEFT JOIN accounts c ON c.id=r.cash_account_id
  LEFT JOIN partners p ON p.id=r.partner_id LEFT JOIN journal_entries e ON e.id=r.entry_id`;
async function getRecord(id: string) {
  const record = await db.prepare(`SELECT ${recordColumns} ${recordFrom} WHERE r.id=?`).get(id) as FinanceRecord | undefined;
  check(record, 404, "Catatan tidak ditemukan.");
  return record;
}
export async function records(input: unknown) {
  const query = z.object({ from: optionalDate, to: optionalDate, kind: z.enum(["pengeluaran", "pemasukan"]).optional(), status: z.enum(["semua", "belum"]).default("semua"), account_id: idSchema.optional(), partner_id: idSchema.optional(), q: z.string().trim().max(60).default("") }).parse(input ?? {});
  const kind = query.kind ?? null, account = query.account_id ?? null, partner = query.partner_id ?? null, term = query.q.toLowerCase();
  const where = `${recordFrom}
    WHERE r.date BETWEEN ? AND ? AND (? IS NULL OR r.kind=?) AND (? IS NULL OR r.account_id=?) AND (? IS NULL OR r.partner_id=?)
      AND (?='' OR lower(r.description) LIKE CONCAT('%',?,'%') OR lower(r.number) LIKE CONCAT('%',?,'%') OR lower(COALESCE(p.name,'')) LIKE CONCAT('%',?,'%'))
      AND (?=0 OR (r.settle='tempo' AND r.settled_at IS NULL))`;
  const params = [query.from || "0000-01-01", query.to || "9999-12-31", kind, kind, account, account, partner, partner, term, term, term, term, query.status === "belum" ? 1 : 0];
  const rows = await db.prepare(`SELECT ${recordColumns} ${where} ORDER BY r.date DESC,r.number DESC LIMIT 500`).all(...params) as FinanceRecord[];
  // Total dihitung dari seluruh catatan yang cocok, bukan hanya 500 baris yang ditampilkan.
  const totals = await db.prepare(`SELECT count(*) count,
      COALESCE(SUM(CASE WHEN r.kind='pengeluaran' THEN r.amount END),0) expense,
      COALESCE(SUM(CASE WHEN r.kind='pemasukan' THEN r.amount END),0) income,
      COALESCE(SUM(CASE WHEN r.settle='tempo' AND r.settled_at IS NULL THEN r.amount END),0) unsettled ${where}`).get(...params) as
    { count: number; expense: number; income: number; unsettled: number };
  return { records: rows, ...totals };
}

export const recordSchema = z.object({
  kind: z.enum(["pengeluaran", "pemasukan"]),
  date: dateSchema,
  account_id: idSchema,
  amount: amountSchema,
  settle: z.enum(["tunai", "tempo"]),
  cash_account_id: idSchema.nullish(),
  partner_id: idSchema.nullish(),
  description: z.string().trim().min(3, "Isi keterangan singkat, misalnya \"Token listrik Agustus\".").max(200),
  due_date: optionalDate,
});
/** Akun yang boleh dipakai sebagai kategori: kas dan akun buku pembantu dikelola otomatis. */
async function categoryFor(kind: "pengeluaran" | "pemasukan", accountId: string) {
  const account = await getAccount(accountId);
  check(account.active, 409, "Akun ini sedang nonaktif.");
  check(!account.is_cash, 400, "Akun kas atau bank dipilih pada kolom sumber dana, bukan sebagai kategori.");
  check(!["piutang", "piutang_lain", "utang"].includes(account.system_key ?? ""), 400, "Akun piutang dan utang terisi otomatis. Pilih kategori lain.");
  const allowed = kind === "pengeluaran" ? ["beban", "aset", "liabilitas"] : ["pendapatan", "aset", "liabilitas"];
  check(allowed.includes(account.type), 400, kind === "pengeluaran" ? "Kategori pengeluaran harus berupa biaya, aset, atau kewajiban." : "Kategori pemasukan harus berupa pendapatan, aset, atau kewajiban.");
  return account;
}
async function cashFor(id: unknown) {
  const account = await getAccount(String(id));
  check(account.is_cash, 400, "Sumber dana harus akun kas atau bank.");
  check(account.active, 409, "Akun kas ini sedang nonaktif.");
  return account;
}
async function postRecord(record: { id: string; kind: "pengeluaran" | "pemasukan"; date: string; account_id: string; amount: number; settle: "tunai" | "tempo"; cash_account_id: string | null; partner_id: string | null; description: string; number: string }, actor: string) {
  const counter = record.settle === "tunai"
    ? { account_id: record.cash_account_id!, partner_id: null }
    : { account_id: (await systemAccount(record.kind === "pengeluaran" ? "utang" : "piutang_lain")).id, partner_id: record.partner_id };
  const category = { account_id: record.account_id, memo: record.description, partner_id: record.settle === "tunai" ? record.partner_id : null };
  const lines: LineInput[] = record.kind === "pengeluaran"
    ? [{ ...category, debit: record.amount }, { ...counter, credit: record.amount }]
    : [{ ...counter, debit: record.amount }, { ...category, credit: record.amount }];
  const entryId = await putEntry({ date: record.date, memo: `${record.number} · ${record.description}`, source: "catatan", ref_id: record.id, actor, lines });
  await db.prepare("UPDATE finance_records SET entry_id=? WHERE id=?").run(entryId, record.id);
}
export async function saveRecord(input: unknown, actor: string, id?: string) {
  const data = recordSchema.parse(input);
  return await transaction(async () => {
    await ensureOpen(data.date);
    await categoryFor(data.kind, data.account_id);
    const cash = data.settle === "tunai" ? await cashFor(data.cash_account_id) : null;
    check(data.settle === "tunai" || data.partner_id, 400, data.kind === "pengeluaran" ? "Pilih pemasok agar utangnya tercatat di buku besar pembantu." : "Pilih pihak yang akan membayar agar tagihannya tercatat.");
    if (data.partner_id) check(await db.prepare("SELECT 1 FROM partners WHERE id=?").get(data.partner_id), 404, "Pemasok tidak ditemukan.");
    check(!data.due_date || data.due_date >= data.date, 400, "Jatuh tempo tidak boleh sebelum tanggal transaksi.");
    let number: string;
    if (id) {
      const existing = await getRecord(id);
      check(!existing.settled_at, 409, "Batalkan status lunas terlebih dahulu sebelum mengubah catatan ini.");
      await ensureOpen(existing.date);
      check(existing.kind === data.kind, 400, "Jenis catatan tidak dapat diubah. Hapus lalu buat catatan baru.");
      number = existing.number;
      await db.prepare("UPDATE finance_records SET date=?,account_id=?,amount=?,settle=?,cash_account_id=?,partner_id=?,description=?,due_date=? WHERE id=?")
        .run(data.date, data.account_id, data.amount, data.settle, cash?.id ?? null, data.partner_id ?? null, data.description, data.due_date || null, id);
      await audit(actor, "finance.record.update", id, { number, before: { date: existing.date, amount: existing.amount, account: existing.account_name, description: existing.description }, after: { date: data.date, amount: data.amount, account_id: data.account_id, description: data.description } });
    } else {
      id = randomUUID();
      number = await nextNumber("finance_records", data.kind === "pengeluaran" ? "BY" : "PM", data.date.slice(0, 4));
      await db.prepare("INSERT INTO finance_records (id,number,kind,date,account_id,amount,settle,cash_account_id,partner_id,description,due_date,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, number, data.kind, data.date, data.account_id, data.amount, data.settle, cash?.id ?? null, data.partner_id ?? null, data.description, data.due_date || null, actor, new Date().toISOString());
      await audit(actor, "finance.record.create", id, { number, kind: data.kind, date: data.date, amount: data.amount, settle: data.settle, description: data.description });
    }
    await postRecord({ id: id!, number, kind: data.kind, date: data.date, account_id: data.account_id, amount: data.amount, settle: data.settle, cash_account_id: cash?.id ?? null, partner_id: data.partner_id ?? null, description: data.description }, actor);
    return await getRecord(id!);
  });
}
export async function removeRecord(id: string, actor: string) {
  await transaction(async () => {
    const record = await getRecord(id);
    await ensureOpen(record.date);
    if (record.settled_at) await ensureOpen(record.settled_at);
    await db.prepare("DELETE FROM finance_records WHERE id=?").run(id);
    await dropEntry("catatan", id);
    await dropEntry("pelunasan", id);
    await audit(actor, "finance.record.delete", id, { number: record.number, kind: record.kind, date: record.date, amount: record.amount, description: record.description });
  });
}
export const settleSchema = z.object({ date: dateSchema, cash_account_id: idSchema, note: z.string().trim().max(120).default("") });
/** Tandai tagihan tempo sudah dibayar (atau diterima) dan catat perpindahan kasnya. */
export async function settleRecord(id: string, input: unknown, actor: string) {
  const data = settleSchema.parse(input);
  return await transaction(async () => {
    await ensureOpen(data.date);
    const record = await getRecord(id);
    check(record.settle === "tempo", 409, "Catatan ini sudah dibayar tunai saat dibuat.");
    check(!record.settled_at, 409, "Catatan ini sudah ditandai lunas.");
    check(data.date >= record.date, 400, "Tanggal pelunasan tidak boleh sebelum tanggal transaksinya.");
    const cash = await cashFor(data.cash_account_id);
    const open = { account_id: (await systemAccount(record.kind === "pengeluaran" ? "utang" : "piutang_lain")).id, partner_id: record.partner_id, memo: record.partner_name ?? "" };
    const entryId = await putEntry({
      date: data.date, source: "pelunasan", ref_id: id, actor,
      memo: `Pelunasan ${record.number}${data.note ? ` · ${data.note}` : ""}`,
      lines: record.kind === "pengeluaran"
        ? [{ ...open, debit: record.amount }, { account_id: cash.id, credit: record.amount, memo: data.note }]
        : [{ account_id: cash.id, debit: record.amount, memo: data.note }, { ...open, credit: record.amount }],
    });
    await db.prepare("UPDATE finance_records SET settled_at=?,settled_entry_id=? WHERE id=?").run(data.date, entryId, id);
    await audit(actor, "finance.record.settle", id, { number: record.number, amount: record.amount, date: data.date, cash_account: cash.name });
    return await getRecord(id);
  });
}
export async function unsettleRecord(id: string, actor: string) {
  return await transaction(async () => {
    const record = await getRecord(id);
    check(record.settled_at, 409, "Catatan ini belum ditandai lunas.");
    await ensureOpen(record.settled_at);
    await db.prepare("UPDATE finance_records SET settled_at=NULL,settled_entry_id=NULL WHERE id=?").run(id);
    await dropEntry("pelunasan", id);
    await audit(actor, "finance.record.unsettle", id, { number: record.number, amount: record.amount, settled_at: record.settled_at });
    return await getRecord(id);
  });
}
/** Bukti pengeluaran: satu foto per catatan, tersimpan di database agar ikut tercadang. */
export async function setReceipt(id: string, contentType: string | undefined, body: unknown, actor: string) {
  const type = checkImage(contentType, body);
  return await transaction(async () => {
    await getRecord(id);
    await db.prepare("UPDATE finance_records SET photo_id=?,photo_mime=?,photo_data=? WHERE id=?").run(randomUUID(), type, body as Buffer, id);
    await audit(actor, "finance.receipt.set", id);
    return await getRecord(id);
  });
}
export async function removeReceipt(id: string, actor: string) {
  return await transaction(async () => {
    await getRecord(id);
    await db.prepare("UPDATE finance_records SET photo_id=NULL,photo_mime=NULL,photo_data=NULL WHERE id=?").run(id);
    await audit(actor, "finance.receipt.delete", id);
    return await getRecord(id);
  });
}
export async function receiptFile(id: string) {
  return await db.prepare("SELECT photo_mime mime,photo_data data FROM finance_records WHERE id=? AND photo_id IS NOT NULL").get(id) as { mime: string; data: Uint8Array } | undefined;
}

// --- Transfer kas dan modal pemilik ---------------------------------------

export const transferSchema = z.object({ date: dateSchema, from_account_id: idSchema, to_account_id: idSchema, amount: amountSchema, memo: z.string().trim().max(200).default("") });
export async function createTransfer(input: unknown, actor: string) {
  const data = transferSchema.parse(input);
  return await transaction(async () => {
    await ensureOpen(data.date);
    check(data.from_account_id !== data.to_account_id, 400, "Pilih dua akun yang berbeda.");
    const from = await cashFor(data.from_account_id), to = await cashFor(data.to_account_id);
    const id = await putEntry({
      date: data.date, source: "transfer", actor,
      memo: data.memo || `Pindah dana ${from.name} ke ${to.name}`,
      lines: [{ account_id: to.id, debit: data.amount }, { account_id: from.id, credit: data.amount }],
    });
    await audit(actor, "finance.transfer", id, { date: data.date, from: from.name, to: to.name, amount: data.amount });
    return { id };
  });
}
export const equitySchema = z.object({ date: dateSchema, direction: z.enum(["setor", "ambil"]), cash_account_id: idSchema, amount: amountSchema, memo: z.string().trim().max(200).default("") });
export async function createEquity(input: unknown, actor: string) {
  const data = equitySchema.parse(input);
  return await transaction(async () => {
    await ensureOpen(data.date);
    const cash = await cashFor(data.cash_account_id);
    const equity = await systemAccount(data.direction === "setor" ? "modal" : "prive");
    const id = await putEntry({
      date: data.date, source: "modal", actor,
      memo: data.memo || (data.direction === "setor" ? "Setoran modal pemilik" : "Pengambilan pemilik"),
      lines: data.direction === "setor"
        ? [{ account_id: cash.id, debit: data.amount }, { account_id: equity.id, credit: data.amount }]
        : [{ account_id: equity.id, debit: data.amount }, { account_id: cash.id, credit: data.amount }],
    });
    await audit(actor, "finance.equity", id, { date: data.date, direction: data.direction, cash_account: cash.name, amount: data.amount });
    return { id };
  });
}

// --- Pengaturan, akun, dan mitra ------------------------------------------

export async function setup() {
  return { accounts: await accounts(), partners: await partners(), settings: await settings(), ...localClock() };
}
const methodKeys = ["cash", "transfer", "qris", "va", "ewallet", "card"];
export const settingsSchema = z.object({
  cash_accounts: z.record(z.string().max(20), idSchema),
  default_cash_account: idSchema,
  locked_until: optionalDate,
  /** Tidak dikirim berarti pengaturan pajak yang tersimpan dipertahankan. */
  tax: z.object({
    enabled: z.boolean(),
    label: z.string().trim().min(2, "Nama pajak minimal 2 karakter, misalnya PB1 atau PPN.").max(20),
    rate: z.number().min(0).max(100, "Tarif pajak maksimal 100%."),
    inclusive: z.boolean(),
  }).refine(value => !value.enabled || value.rate > 0, "Isi tarif pajak, misalnya 10.").optional(),
  gateway_fees: z.record(z.string().max(20), z.object({ percent: z.number().min(0).max(20, "Persen potongan gateway terlalu besar."), flat: z.number().int().min(0).max(100000) })).optional(),
});
export async function saveSettings(input: unknown, actor: string) {
  const data = settingsSchema.parse(input);
  return await transaction(async () => {
    await cashFor(data.default_cash_account);
    const cashAccounts: Record<string, string> = {};
    for (const method of methodKeys) {
      const id = data.cash_accounts[method];
      if (id) { await cashFor(id); cashAccounts[method] = id }
    }
    const current = await settings();
    const fees: Record<string, GatewayFee> = {};
    // Tunai tidak dipotong apa pun, jadi hanya metode online yang disimpan.
    for (const method of methodKeys.filter(key => key !== "cash")) {
      const fee = (data.gateway_fees ?? current.gateway_fees)[method];
      if (fee && (fee.percent > 0 || fee.flat > 0)) fees[method] = { percent: Math.round(fee.percent * 100) / 100, flat: fee.flat };
    }
    const tax = data.tax ? { ...data.tax, rate: Math.round(data.tax.rate * 100) / 100 } : current.tax;
    const next = { cash_accounts: cashAccounts, default_cash_account: data.default_cash_account, locked_until: data.locked_until, tax, gateway_fees: fees, updated_at: new Date().toISOString() };
    await saveSetting("finance", next);
    await audit(actor, "finance.settings", "finance", { before: { locked_until: current.locked_until, tax: current.tax }, after: { locked_until: next.locked_until, tax: next.tax } });
    return await settings();
  });
}
export const accountSchema = z.object({
  code: z.string().trim().regex(/^[0-9][-0-9.]{1,11}$/, "Kode akun berisi angka dan tanda hubung, misalnya 5-150."),
  name: z.string().trim().min(3, "Nama akun minimal 3 karakter.").max(60),
  type: z.enum(["aset", "liabilitas", "ekuitas", "pendapatan", "beban"]),
  subtype: z.enum(["kas_bank", "piutang", "persediaan", "aset_tetap", "utang", "modal", "pendapatan", "beban"]),
  description: z.string().trim().max(200).default(""),
  active: z.boolean().default(true),
});
const subtypesFor: Record<AccountType, AccountSubtype[]> = {
  aset: ["kas_bank", "piutang", "persediaan", "aset_tetap"], liabilitas: ["utang"], ekuitas: ["modal"], pendapatan: ["pendapatan"], beban: ["beban"],
};
export async function saveAccount(input: unknown, actor: string, id?: string) {
  const data = accountSchema.parse(input);
  return await transaction(async () => {
    check(subtypesFor[data.type].includes(data.subtype), 400, "Kelompok akun tidak cocok dengan jenisnya.");
    const existing = id ? await getAccount(id) : undefined;
    check(!await db.prepare("SELECT 1 FROM accounts WHERE code=? AND id<>COALESCE(?,'')").get(data.code, id ?? null), 409, "Kode akun sudah dipakai.");
    check(!await db.prepare("SELECT 1 FROM accounts WHERE name=? AND id<>COALESCE(?,'')").get(data.name, id ?? null), 409, "Nama akun sudah dipakai.");
    const isCash = data.subtype === "kas_bank" ? 1 : 0;
    if (existing) {
      // Jenis akun bawaan dikunci supaya jurnal otomatis tidak salah tempat.
      const sameKind = existing.type === data.type && existing.subtype === data.subtype;
      check(sameKind || !existing.system_key, 409, "Jenis akun bawaan tidak dapat diubah. Buat akun baru bila perlu.");
      check(sameKind || !await db.prepare("SELECT 1 FROM journal_lines WHERE account_id=?").get(id!), 409, "Akun ini sudah dipakai di jurnal, jadi jenisnya tidak dapat diubah lagi.");
      check(data.active || !existing.system_key, 409, "Akun bawaan tidak dapat dinonaktifkan.");
      await db.prepare("UPDATE accounts SET code=?,name=?,type=?,subtype=?,is_cash=?,description=?,active=? WHERE id=?")
        .run(data.code, data.name, data.type, data.subtype, isCash, data.description, Number(data.active), id!);
      await audit(actor, "finance.account.update", id!);
    } else {
      id = randomUUID();
      const position = (await db.prepare("SELECT COALESCE(MAX(position),0) value FROM accounts").get() as { value: number }).value + 1;
      await db.prepare("INSERT INTO accounts (id,code,name,type,subtype,is_cash,system_key,description,active,position,created_at) VALUES (?,?,?,?,?,?,NULL,?,?,?,?)")
        .run(id, data.code, data.name, data.type, data.subtype, isCash, data.description, Number(data.active), position, new Date().toISOString());
      await audit(actor, "finance.account.create", id);
    }
    return await getAccount(id!);
  });
}
export async function removeAccount(id: string, actor: string) {
  await transaction(async () => {
    const account = await getAccount(id);
    check(!account.system_key, 409, "Akun bawaan tidak dapat dihapus. Nonaktifkan saja bila tidak dipakai.");
    check(!await db.prepare("SELECT 1 FROM journal_lines WHERE account_id=?").get(id), 409, "Akun ini sudah dipakai di jurnal. Nonaktifkan saja agar riwayatnya tetap utuh.");
    check(!await db.prepare("SELECT 1 FROM finance_records WHERE account_id=? OR cash_account_id=?").get(id, id), 409, "Akun ini masih dipakai catatan keuangan.");
    await db.prepare("DELETE FROM accounts WHERE id=?").run(id);
    await audit(actor, "finance.account.delete", id);
  });
}
export const partnerSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(60),
  kind: z.enum(["pemasok", "pelanggan", "karyawan", "lainnya"]).default("pemasok"),
  phone: z.string().trim().max(20).default(""),
  note: z.string().trim().max(200).default(""),
  active: z.boolean().default(true),
});
export async function savePartner(input: unknown, actor: string, id?: string) {
  const data = partnerSchema.parse(input);
  return await transaction(async () => {
    if (id) check(await db.prepare("SELECT 1 FROM partners WHERE id=?").get(id), 404, "Data pemasok tidak ditemukan.");
    check(!await db.prepare("SELECT 1 FROM partners WHERE name=? AND id<>COALESCE(?,'')").get(data.name, id ?? null), 409, "Nama ini sudah ada di daftar.");
    if (id) {
      await db.prepare("UPDATE partners SET name=?,kind=?,phone=?,note=?,active=? WHERE id=?").run(data.name, data.kind, data.phone, data.note, Number(data.active), id);
      await audit(actor, "finance.partner.update", id);
    } else {
      id = randomUUID();
      await db.prepare("INSERT INTO partners (id,name,kind,phone,note,active,created_at) VALUES (?,?,?,?,?,?,?)").run(id, data.name, data.kind, data.phone, data.note, Number(data.active), new Date().toISOString());
      await audit(actor, "finance.partner.create", id);
    }
    return await db.prepare("SELECT id,name,kind,phone,note,active,created_at FROM partners WHERE id=?").get(id) as Partner;
  });
}
export async function removePartner(id: string, actor: string) {
  await transaction(async () => {
    check(await db.prepare("SELECT 1 FROM partners WHERE id=?").get(id), 404, "Data pemasok tidak ditemukan.");
    check(!await db.prepare("SELECT 1 FROM journal_lines WHERE partner_id=?").get(id), 409, "Nama ini sudah dipakai di jurnal. Nonaktifkan saja agar riwayatnya tetap utuh.");
    check(!await db.prepare("SELECT 1 FROM finance_records WHERE partner_id=?").get(id), 409, "Nama ini masih dipakai catatan keuangan.");
    await db.prepare("DELETE FROM partners WHERE id=?").run(id);
    await audit(actor, "finance.partner.delete", id);
  });
}
