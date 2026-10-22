import { z } from "zod";
import { audit, db, getUsers, readSetting, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { localClock } from "./clock.js";
import { accounts, balanceOf, dropEntry, movements, putEntry, settings, systemAccount, type LineInput } from "./finance.js";
import { runDepreciation } from "./assets.js";

/**
 * Tutup buku tahunan. Jurnal penutup bertanggal 31 Desember (sumber `tutup_buku`) memindahkan saldo semua
 * akun pendapatan dan beban tahun itu ke Laba Ditahan, lalu pembukuan dikunci sampai tanggal itu.
 * Laporan laba rugi mengabaikan jurnal ini, jadi laba tahun yang sudah ditutup tetap terbaca utuh;
 * neraca memakainya sehingga ekuitas terpisah antara Laba Ditahan dan Laba Tahun Berjalan.
 */
async function yearProfit(year: number) {
  const index = await movements(`${year}-01-01`, `${year}-12-31`, false);
  const rows = (await accounts()).filter(account => account.type === "pendapatan" || account.type === "beban")
    .map(account => ({ account, amount: balanceOf(account, index) })).filter(row => row.amount !== 0);
  const income = rows.filter(row => row.account.type === "pendapatan").reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter(row => row.account.type === "beban").reduce((sum, row) => sum + row.amount, 0);
  return { rows, income, expense, net: income - expense };
}
async function firstYear() {
  const row = await db.prepare("SELECT MIN(date) first FROM journal_entries WHERE source<>'tutup_buku'").get() as { first: string | null };
  return row.first ? Number(row.first.slice(0, 4)) : null;
}

export async function closingOverview() {
  const closings = await db.prepare("SELECT year,net_income,closed_by,closed_at FROM fiscal_closings ORDER BY year DESC").all() as { year: number; net_income: number; closed_by: string | null; closed_at: string }[];
  const users = await getUsers();
  const current = Number(localClock().date.slice(0, 4));
  const start = await firstYear();
  const closed = new Set(closings.map(row => Number(row.year)));
  const open: { year: number; income: number; expense: number; net: number; can_close: boolean; reason: string }[] = [];
  if (start !== null) for (let year = start; year < current; year++) {
    if (closed.has(year)) continue;
    const profit = await yearProfit(year);
    const blocked = open.length > 0;
    open.push({ year, income: profit.income, expense: profit.expense, net: profit.net, can_close: !blocked, reason: blocked ? `Tutup buku ${open[0].year} terlebih dahulu.` : "" });
  }
  const latest = closings[0] ? Number(closings[0].year) : null;
  return {
    closings: await Promise.all(closings.map(async row => {
      const now = await yearProfit(Number(row.year));
      const entry = await db.prepare("SELECT number FROM journal_entries WHERE source='tutup_buku' AND ref_id=?").get(String(row.year)) as { number: string } | undefined;
      return {
        year: Number(row.year), net_income: Number(row.net_income), closed_at: row.closed_at, entry_number: entry?.number ?? "",
        closed_by_name: users.find(user => user.id === row.closed_by)?.name ?? "",
        // Kunci sempat dibuka dan ada jurnal yang berubah: jurnal penutupnya perlu diperbarui.
        stale: now.net !== Number(row.net_income), current_net: now.net, can_undo: Number(row.year) === latest,
      };
    })),
    open, locked_until: (await settings()).locked_until, year: current,
  };
}

const yearSchema = z.object({ year: z.number().int().min(2000).max(2100) });

/** Tutup (atau perbarui jurnal penutup) satu tahun buku. */
export async function closeYear(input: unknown, actor: string) {
  const { year } = yearSchema.parse(input);
  const current = Number(localClock().date.slice(0, 4));
  check(year < current, 400, `Tahun ${year} belum selesai. Tutup buku bisa dilakukan mulai 1 Januari ${year + 1}.`);
  // Penyusutan setahun penuh dicatat dulu agar laba yang ditutup sudah lengkap.
  await runDepreciation({ through: `${year}-12` }, actor);
  return await transaction(async () => {
    const start = await firstYear();
    for (let earlier = start ?? year; earlier < year; earlier++)
      check(await db.prepare("SELECT 1 FROM fiscal_closings WHERE year=?").get(earlier), 409, `Tutup buku ${earlier} terlebih dahulu.`);
    const refresh = !!await db.prepare("SELECT 1 FROM fiscal_closings WHERE year=?").get(year);
    const profit = await yearProfit(year);
    const retained = (await systemAccount("laba_ditahan")).id;
    const memo = `Tutup buku ${year}`;
    // Pendapatan (saldo normal kredit) didebit, beban (saldo normal debit) dikredit, selisihnya ke Laba Ditahan.
    const lines: LineInput[] = profit.rows.map(({ account, amount }) => {
      const debitSide = account.type === "pendapatan" ? amount > 0 : amount < 0;
      return debitSide ? { account_id: account.id, debit: Math.abs(amount), memo } : { account_id: account.id, credit: Math.abs(amount), memo };
    });
    if (profit.net > 0) lines.push({ account_id: retained, credit: profit.net, memo: `Laba bersih ${year}` });
    if (profit.net < 0) lines.push({ account_id: retained, debit: -profit.net, memo: `Rugi bersih ${year}` });
    if (lines.length >= 2) await putEntry({ date: `${year}-12-31`, source: "tutup_buku", ref_id: String(year), memo, lines, actor, closing: true });
    else await dropEntry("tutup_buku", String(year));
    const stamp = new Date().toISOString();
    if (refresh) await db.prepare("UPDATE fiscal_closings SET net_income=?,closed_by=?,closed_at=? WHERE year=?").run(profit.net, actor, stamp, year);
    else await db.prepare("INSERT INTO fiscal_closings (year,net_income,closed_by,closed_at) VALUES (?,?,?,?)").run(year, profit.net, actor, stamp);
    // Kunci pembukuan sampai akhir tahun yang ditutup, kecuali kuncinya sudah lebih jauh.
    const stored = await readSetting<Record<string, unknown>>("finance") ?? {};
    const locked = typeof stored.locked_until === "string" ? stored.locked_until : "";
    if (locked < `${year}-12-31`) await saveSetting("finance", { ...stored, locked_until: `${year}-12-31`, updated_at: stamp });
    await audit(actor, refresh ? "finance.closing.refresh" : "finance.closing", String(year), { net: profit.net, locked_until: locked < `${year}-12-31` ? `${year}-12-31` : locked });
    return await closingOverview();
  });
}

/** Batalkan tutup buku tahun terakhir. Kunci pembukuan tidak diubah; buka sendiri bila perlu koreksi. */
export async function undoClosing(input: unknown, actor: string) {
  const { year } = yearSchema.parse(input);
  return await transaction(async () => {
    const latest = await db.prepare("SELECT MAX(year) year FROM fiscal_closings").get() as { year: number | null };
    check(latest.year !== null && Number(latest.year) === year, 409, latest.year === null ? "Belum ada tahun yang ditutup." : `Hanya tutup buku terakhir (${latest.year}) yang bisa dibatalkan.`);
    await dropEntry("tutup_buku", String(year));
    await db.prepare("DELETE FROM fiscal_closings WHERE year=?").run(year);
    await audit(actor, "finance.closing.undo", String(year));
    return await closingOverview();
  });
}
