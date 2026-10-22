import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, transaction } from "./store.js";
import { check } from "./errors.js";
import { localClock } from "./clock.js";
import {
  accounts, amountSchema, dateSchema, dropEntry, ensureOpen, getAccount, idSchema, monthEnd, partners,
  putEntry, removeRecord, saveRecord, settings, systemAccount, type LineInput,
} from "./finance.js";

/**
 * Daftar aset tetap dan penyusutan garis lurus per bulan.
 *
 * Nilai yang disusutkan (harga perolehan − nilai sisa) dibagi rata ke `life_months` bulan sejak bulan
 * perolehan; sisa pembulatan masuk bulan terakhir sehingga totalnya pas. Penyusutan dibukukan per bulan
 * dalam satu jurnal (sumber `penyusutan`, ref = YYYY-MM): Dr Beban Penyusutan, Cr Akumulasi Penyusutan.
 * Bulan dalam periode yang dikunci dilewati dan dicatat lagi bila kuncinya dibuka.
 */
export interface FixedAsset {
  id: string; number: string; name: string; category: string; acquired_on: string; cost: number; salvage: number; life_months: number;
  depreciate_from: string; asset_account_id: string; accumulated_account_id: string; expense_account_id: string;
  status: "aktif" | "dilepas"; disposed_on: string | null; disposal_amount: number | null; disposal_cash_account_id: string | null;
  note: string; record_id: string | null; created_at: string; updated_at: string;
}
const columns = "id,number,name,category,acquired_on,cost,salvage,life_months,depreciate_from,asset_account_id,accumulated_account_id,expense_account_id,status,disposed_on,disposal_amount,disposal_cash_account_id,note,record_id,created_at,updated_at";
const month = (date: string) => date.slice(0, 7);
const addMonths = (period: string, count: number) => { const value = new Date(period + "-01T00:00:00Z"); value.setUTCMonth(value.getUTCMonth() + count); return value.toISOString().slice(0, 7) };
const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
const monthName = (period: string) => new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(period + "-01T00:00:00Z"));

/** Penyusutan bulan ke-`index` (0 = bulan perolehan). */
function amountFor(asset: Pick<FixedAsset, "cost" | "salvage" | "life_months">, index: number) {
  if (index < 0 || index >= asset.life_months) return 0;
  const base = Math.floor((asset.cost - asset.salvage) / asset.life_months);
  return index === asset.life_months - 1 ? asset.cost - asset.salvage - base * (asset.life_months - 1) : base;
}
/** Bulan-bulan yang seharusnya disusutkan sampai `through`. */
function periodsFor(asset: FixedAsset, through: string) {
  const start = month(asset.acquired_on), last = addMonths(start, asset.life_months - 1);
  let end = through < last ? through : last;
  if (asset.disposed_on && month(asset.disposed_on) < end) end = month(asset.disposed_on);
  const periods: string[] = [];
  for (let period = asset.depreciate_from > start ? asset.depreciate_from : start; period <= end; period = addMonths(period, 1)) periods.push(period);
  return periods;
}

async function getAsset(id: string) {
  const asset = await db.prepare(`SELECT ${columns} FROM fixed_assets WHERE id=?`).get(id) as FixedAsset | undefined;
  check(asset, 404, "Aset tidak ditemukan.");
  return { ...asset, cost: Number(asset.cost), salvage: Number(asset.salvage), disposal_amount: asset.disposal_amount === null ? null : Number(asset.disposal_amount) };
}

/** Tulis ulang jurnal penyusutan satu bulan dari tabel `asset_depreciations`. */
async function syncPeriod(period: string, actor: string | null) {
  const rows = await db.prepare(`SELECT d.amount,f.number,f.name,f.expense_account_id,f.accumulated_account_id FROM asset_depreciations d JOIN fixed_assets f ON f.id=d.asset_id
    WHERE d.period=? AND d.amount>0 ORDER BY f.number`).all(period) as { amount: number; number: string; name: string; expense_account_id: string; accumulated_account_id: string }[];
  if (!rows.length) return await dropEntry("penyusutan", period);
  const lines: LineInput[] = rows.flatMap(row => [
    { account_id: row.expense_account_id, debit: Number(row.amount), memo: `${row.number} · ${row.name}` },
    { account_id: row.accumulated_account_id, credit: Number(row.amount), memo: `${row.number} · ${row.name}` },
  ]);
  await putEntry({ date: monthEnd(period + "-01"), source: "penyusutan", ref_id: period, actor, memo: `Penyusutan aset tetap ${monthName(period)}`, lines });
}

/**
 * Bukukan penyusutan semua aset sampai bulan `through` (bawaannya bulan lalu, karena bulan berjalan
 * belum selesai). Aman diulang: bulan yang sudah tercatat tidak ditulis lagi.
 */
export async function runDepreciation(input: { through?: string; asset_id?: string } = {}, actor: string | null = null) {
  const through = input.through ?? addMonths(month(localClock().date), -1);
  check(/^\d{4}-\d{2}$/.test(through), 400, "Bulan tidak valid.");
  return await transaction(async () => {
    const locked = (await settings()).locked_until;
    const assets = (await db.prepare(`SELECT ${columns} FROM fixed_assets ${input.asset_id ? "WHERE id=?" : ""}`).all(...(input.asset_id ? [input.asset_id] : [])) as FixedAsset[])
      .map(asset => ({ ...asset, cost: Number(asset.cost), salvage: Number(asset.salvage) }));
    const touched = new Set<string>();
    let posted = 0, skipped = 0;
    for (const asset of assets) {
      const done = new Set((await db.prepare("SELECT period FROM asset_depreciations WHERE asset_id=?").all(asset.id) as { period: string }[]).map(row => row.period));
      for (const period of periodsFor(asset, through)) {
        if (done.has(period)) continue;
        if (locked && monthEnd(period + "-01") <= locked) { skipped++; continue; }
        const amount = amountFor(asset, monthsBetween(month(asset.acquired_on), period));
        await db.prepare("INSERT INTO asset_depreciations (asset_id,period,amount,created_at) VALUES (?,?,?,?)").run(asset.id, period, amount, new Date().toISOString());
        touched.add(period); posted++;
      }
    }
    for (const period of [...touched].sort()) await syncPeriod(period, actor);
    if (posted && actor) await audit(actor, "asset.depreciate", through, { posted, skipped });
    return { through, posted, skipped, periods: [...touched].sort() };
  });
}

/** Aset beserta akumulasi, nilai buku, dan sisa umurnya per hari ini. */
export async function assetOverview() {
  const rows = await db.prepare(`SELECT ${columns},
      COALESCE((SELECT SUM(amount) FROM asset_depreciations WHERE asset_id=f.id),0) accumulated,
      (SELECT count(*) FROM asset_depreciations WHERE asset_id=f.id) months_done,
      (SELECT MAX(period) FROM asset_depreciations WHERE asset_id=f.id) last_period
    FROM fixed_assets f ORDER BY f.status, f.acquired_on DESC, f.number DESC`).all() as (FixedAsset & { accumulated: number; months_done: number; last_period: string | null })[];
  const today = month(localClock().date), all = await accounts();
  const assets = rows.map(row => {
    const cost = Number(row.cost), salvage = Number(row.salvage), accumulated = Number(row.accumulated);
    // Bulan sebelum `depreciate_from` dianggap sudah disusutkan di luar aplikasi.
    const prior = Array.from({ length: Math.max(0, Math.min(row.life_months, monthsBetween(month(row.acquired_on), row.depreciate_from))) }, (_, index) => amountFor({ cost, salvage, life_months: row.life_months }, index)).reduce((sum, value) => sum + value, 0);
    const end = addMonths(month(row.acquired_on), row.life_months - 1);
    return {
      ...row, cost, salvage, accumulated, prior, months_done: Number(row.months_done),
      monthly: amountFor({ cost, salvage, life_months: row.life_months }, 0),
      book_value: cost - accumulated - prior, ends: end,
      remaining_months: row.status === "aktif" ? Math.max(0, monthsBetween(today, end) + 1) : 0,
      disposal_amount: row.disposal_amount === null ? null : Number(row.disposal_amount),
    };
  });
  const active = assets.filter(asset => asset.status === "aktif");
  return {
    assets,
    summary: {
      count: active.length, cost: active.reduce((sum, asset) => sum + asset.cost, 0),
      accumulated: active.reduce((sum, asset) => sum + asset.accumulated + asset.prior, 0),
      book_value: active.reduce((sum, asset) => sum + asset.book_value, 0),
      monthly: active.filter(asset => asset.remaining_months > 0).reduce((sum, asset) => sum + asset.monthly, 0),
    },
    options: {
      asset_accounts: all.filter(account => account.subtype === "aset_tetap" && account.system_key !== "akumulasi_penyusutan" && account.active),
      accumulated_accounts: all.filter(account => account.subtype === "aset_tetap" && account.active),
      expense_accounts: all.filter(account => account.type === "beban" && account.active),
      cash_accounts: all.filter(account => account.is_cash && account.active),
      partners: (await partners()).filter(partner => partner.active && partner.kind === "pemasok"),
      defaults: {
        asset: (await systemAccount("aset_tetap")).id, accumulated: (await systemAccount("akumulasi_penyusutan")).id, expense: (await systemAccount("beban_penyusutan")).id,
      },
    },
    locked_until: (await settings()).locked_until, ...localClock(),
  };
}

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Bulan tidak valid.");
export const assetSchema = z.object({
  name: z.string().trim().min(3, "Nama aset minimal 3 karakter.").max(120),
  category: z.string().trim().max(60).default(""),
  acquired_on: dateSchema,
  cost: amountSchema,
  salvage: z.number().int().min(0).default(0),
  life_months: z.number().int().min(1, "Umur manfaat minimal 1 bulan.").max(600, "Umur manfaat maksimal 50 tahun."),
  depreciate_from: z.union([periodSchema, z.literal("")]).default(""),
  asset_account_id: idSchema.optional(),
  accumulated_account_id: idSchema.optional(),
  expense_account_id: idSchema.optional(),
  note: z.string().trim().max(300).default(""),
  /** Catat juga pembeliannya sebagai pengeluaran (tunai dari kas/bank, atau utang ke pemasok). */
  purchase: z.object({ settle: z.enum(["tunai", "tempo"]), cash_account_id: idSchema.nullish(), partner_id: idSchema.nullish() }).nullish(),
}).refine(value => value.salvage < value.cost, { message: "Nilai sisa harus lebih kecil dari harga perolehan.", path: ["salvage"] });

export async function saveAsset(input: unknown, actor: string, id?: string) {
  const data = assetSchema.parse(input);
  const from = data.depreciate_from || month(data.acquired_on);
  check(from >= month(data.acquired_on), 400, "Mulai penyusutan tidak boleh sebelum bulan perolehan.");
  return await transaction(async () => {
    const defaults = (await assetOverview()).options.defaults;
    const assetAccount = await getAccount(data.asset_account_id ?? defaults.asset);
    const accumulated = await getAccount(data.accumulated_account_id ?? defaults.accumulated);
    const expense = await getAccount(data.expense_account_id ?? defaults.expense);
    check(assetAccount.subtype === "aset_tetap" && accumulated.subtype === "aset_tetap", 400, "Pilih akun berjenis aset tetap.");
    check(assetAccount.id !== accumulated.id, 400, "Akun aset dan akun akumulasi penyusutan harus berbeda.");
    check(expense.type === "beban", 400, "Akun beban penyusutan harus berupa akun beban.");
    const stamp = new Date().toISOString();
    if (id) {
      const before = await getAsset(id);
      const started = !!await db.prepare("SELECT 1 FROM asset_depreciations WHERE asset_id=? LIMIT 1").get(id);
      const money = before.cost !== data.cost || before.salvage !== data.salvage || before.life_months !== data.life_months || before.acquired_on !== data.acquired_on || before.depreciate_from !== from
        || before.asset_account_id !== assetAccount.id || before.accumulated_account_id !== accumulated.id || before.expense_account_id !== expense.id;
      check(!started || !money, 409, "Aset ini sudah disusutkan. Hanya nama, kategori, dan catatan yang bisa diubah; untuk koreksi nilai, lepaskan aset lalu daftarkan ulang.");
      check(!before.record_id || before.cost === data.cost && before.acquired_on === data.acquired_on && before.asset_account_id === assetAccount.id, 409, `Harga dan tanggal beli mengikuti catatan pembeliannya. Ubah catatan itu di Kas & Transaksi.`);
      await db.prepare("UPDATE fixed_assets SET name=?,category=?,acquired_on=?,cost=?,salvage=?,life_months=?,depreciate_from=?,asset_account_id=?,accumulated_account_id=?,expense_account_id=?,note=?,updated_at=? WHERE id=?")
        .run(data.name, data.category, data.acquired_on, data.cost, data.salvage, data.life_months, from, assetAccount.id, accumulated.id, expense.id, data.note, stamp, id);
      await audit(actor, "asset.update", id, { number: before.number, name: data.name });
    } else {
      id = randomUUID();
      let recordId: string | null = null;
      if (data.purchase) {
        const record = await saveRecord({ kind: "pengeluaran", date: data.acquired_on, account_id: assetAccount.id, amount: data.cost, settle: data.purchase.settle,
          cash_account_id: data.purchase.cash_account_id ?? null, partner_id: data.purchase.partner_id ?? null, description: `Pembelian aset ${data.name}`.slice(0, 200) }, actor);
        recordId = record.id;
      }
      const year = data.acquired_on.slice(0, 4);
      const taken = await db.prepare("SELECT number FROM fixed_assets WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`AT-${year}-%`) as { number: string } | undefined;
      const assetNumber = `AT-${year}-${String(taken ? Number(taken.number.slice(-5)) + 1 : 1).padStart(5, "0")}`;
      await db.prepare(`INSERT INTO fixed_assets (id,number,name,category,acquired_on,cost,salvage,life_months,depreciate_from,asset_account_id,accumulated_account_id,expense_account_id,status,note,record_id,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'aktif',?,?,?,?,?)`).run(id, assetNumber, data.name, data.category, data.acquired_on, data.cost, data.salvage, data.life_months, from, assetAccount.id, accumulated.id, expense.id, data.note, recordId, actor, stamp, stamp);
      await audit(actor, "asset.create", id, { number: assetNumber, name: data.name, cost: data.cost, life_months: data.life_months });
    }
    await runDepreciation({ asset_id: id }, actor);
    return (await assetOverview()).assets.find(asset => asset.id === id)!;
  });
}

/** Hapus aset yang salah input. Penyusutan di periode terbuka ikut dihapus; di periode terkunci, lepaskan saja asetnya. */
export async function removeAsset(id: string, actor: string) {
  await transaction(async () => {
    const asset = await getAsset(id);
    check(asset.status === "aktif", 409, "Batalkan pelepasan aset terlebih dahulu.");
    const periods = (await db.prepare("SELECT period FROM asset_depreciations WHERE asset_id=?").all(id) as { period: string }[]).map(row => row.period);
    await db.prepare("DELETE FROM fixed_assets WHERE id=?").run(id);
    for (const period of periods) await syncPeriod(period, actor);
    if (asset.record_id) await removeRecord(asset.record_id, actor);
    await audit(actor, "asset.delete", id, { number: asset.number, name: asset.name });
  });
}

export const disposeSchema = z.object({ date: dateSchema, amount: z.number().int().min(0).max(999_999_999_999), cash_account_id: idSchema.nullish(), note: z.string().trim().max(200).default("") });
/**
 * Lepas aset (dijual, rusak, hilang). Penyusutan dicatat sampai bulan pelepasan, lalu:
 *   Dr Kas (harga jual) + Dr Akumulasi Penyusutan = Cr Aset (harga perolehan) ± Laba (Rugi) Pelepasan Aset.
 */
export async function disposeAsset(id: string, input: unknown, actor: string) {
  const data = disposeSchema.parse(input);
  return await transaction(async () => {
    const asset = await getAsset(id);
    check(asset.status === "aktif", 409, "Aset ini sudah dilepas.");
    check(data.date >= asset.acquired_on, 400, "Tanggal pelepasan tidak boleh sebelum tanggal perolehan.");
    await ensureOpen(data.date);
    check(!data.amount || data.cash_account_id, 400, "Pilih akun kas/bank penerima hasil penjualan.");
    if (data.cash_account_id) check((await getAccount(data.cash_account_id)).is_cash, 400, "Hasil penjualan harus masuk ke akun kas atau bank.");
    // Penyusutan setelah bulan pelepasan (bila tanggalnya mundur) dihapus.
    const later = (await db.prepare("SELECT period FROM asset_depreciations WHERE asset_id=? AND period>?").all(id, month(data.date)) as { period: string }[]).map(row => row.period);
    await db.prepare("DELETE FROM asset_depreciations WHERE asset_id=? AND period>?").run(id, month(data.date));
    for (const period of later) await syncPeriod(period, actor);
    await db.prepare("UPDATE fixed_assets SET status='dilepas',disposed_on=?,disposal_amount=?,disposal_cash_account_id=?,updated_at=? WHERE id=?")
      .run(data.date, data.amount, data.cash_account_id ?? null, new Date().toISOString(), id);
    await runDepreciation({ through: month(data.date), asset_id: id }, actor);
    const overview = (await assetOverview()).assets.find(row => row.id === id)!;
    const accumulated = overview.accumulated + overview.prior, book = asset.cost - accumulated, gain = data.amount - book;
    const memo = `Pelepasan ${asset.number} · ${asset.name}${data.note ? ` · ${data.note}` : ""}`;
    const result = (await systemAccount("laba_pelepasan_aset")).id;
    await putEntry({
      date: data.date, source: "aset", ref_id: id, actor, memo,
      lines: [
        ...(data.amount ? [{ account_id: data.cash_account_id!, debit: data.amount, memo }] : []),
        { account_id: asset.accumulated_account_id, debit: accumulated, memo },
        { account_id: asset.asset_account_id, credit: asset.cost, memo },
        gain > 0 ? { account_id: result, credit: gain, memo } : { account_id: result, debit: -gain, memo },
      ],
    });
    await audit(actor, "asset.dispose", id, { number: asset.number, amount: data.amount, book_value: book });
    return { ...overview, gain };
  });
}

export async function undoDisposal(id: string, actor: string) {
  return await transaction(async () => {
    const asset = await getAsset(id);
    check(asset.status === "dilepas", 409, "Aset ini masih aktif.");
    await dropEntry("aset", id);
    await db.prepare("UPDATE fixed_assets SET status='aktif',disposed_on=NULL,disposal_amount=NULL,disposal_cash_account_id=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    await runDepreciation({ asset_id: id }, actor);
    await audit(actor, "asset.dispose_undo", id, { number: asset.number });
    return (await assetOverview()).assets.find(row => row.id === id)!;
  });
}

/** Jadwal penyusutan satu aset, untuk rincian di panel. */
export async function assetSchedule(id: string) {
  const asset = await getAsset(id);
  const posted = new Map((await db.prepare("SELECT period,amount FROM asset_depreciations WHERE asset_id=?").all(id) as { period: string; amount: number }[]).map(row => [row.period, Number(row.amount)]));
  const start = month(asset.acquired_on);
  let book = asset.cost;
  const rows = Array.from({ length: asset.life_months }, (_, index) => {
    const period = addMonths(start, index), amount = amountFor(asset, index);
    book -= amount;
    const state = period < asset.depreciate_from ? "sebelum" : posted.has(period) ? "tercatat" : asset.disposed_on && period > month(asset.disposed_on) ? "dilepas" : "terjadwal";
    return { period, amount, book_value: book, state };
  });
  return { asset, rows };
}
