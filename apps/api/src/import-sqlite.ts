import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./config.js";
import { transaction, type Param } from "./store.js";
import { clearTables, closePool, dataTables, ensureDefaultMenus, insertRows, orphanReport, rowCounts, withoutForeignKeys, writableColumns } from "./datatransfer.js";

/**
 * Pindahkan data dari database SQLite lama (`DATA_DIR/padelix.sqlite`) ke MySQL.
 *
 *   npm run import:sqlite -w apps/api                  memakai DATA_DIR/padelix.sqlite
 *   npm run import:sqlite -w apps/api -- D:/lama.sqlite  berkas lain
 *   tambahkan --yes untuk menimpa data yang sudah ada di MySQL
 *
 * Berkas SQLite hanya dibaca, tidak diubah. Seluruh impor berjalan dalam satu transaksi: bila ada
 * yang gagal, MySQL kembali seperti sebelum impor. Sesi login dan kode OTP tidak dipindahkan,
 * jadi staf dan pelanggan perlu masuk ulang.
 */
const args = process.argv.slice(2);
const force = args.includes("--yes");
const source = path.resolve(args.find(arg => !arg.startsWith("--")) ?? path.join(dataDir, "padelix.sqlite"));
const minimumVersion = 16;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!existsSync(source)) fail(`Berkas SQLite tidak ditemukan: ${source}`);
const sqlite = new DatabaseSync(source, { readOnly: true });
try {
  const version = (sqlite.prepare("SELECT COALESCE(MAX(version),0) version FROM migrations").get() as { version: number } | undefined)?.version ?? 0;
  if (version < minimumVersion) fail(`Database SQLite masih versi ${version}. Jalankan dulu Padelix versi SQLite terakhir sekali agar migrasinya lengkap (minimal versi ${minimumVersion}), lalu ulangi impor.`);
  const sourceTables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));

  const existing = await rowCounts(["users", "courts", "bookings"]);
  if (!force && Object.values(existing).some(count => count > 0))
    fail(`Database MySQL sudah berisi data (${Object.entries(existing).map(([table, count]) => `${table}: ${count}`).join(", ")}). Tambahkan --yes untuk menimpanya dengan isi SQLite.`);

  console.log(`Mengimpor ${source} (versi ${version}) ...`);
  const counts: Record<string, number> = {};
  await transaction(() => withoutForeignKeys(async () => {
    // Data bawaan migrasi MySQL (menu, role, bagan akun, denah) diganti isi SQLite.
    await clearTables();
    for (const table of dataTables) {
      if (!sourceTables.has(table)) continue;
      const from = (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(row => row.name);
      const writable = await writableColumns(table);
      const columns = from.filter(column => writable.includes(column));
      // Urutan rowid menjaga urutan menu, role, dan riwayat stok seperti di SQLite.
      const statement = sqlite.prepare(`SELECT ${columns.map(column => `"${column}"`).join(",")} FROM "${table}" ORDER BY rowid`);
      statement.setReturnArrays?.(true);
      let batch: Param[][] = [];
      counts[table] = 0;
      for (const row of statement.iterate() as Iterable<unknown>) {
        const values = (Array.isArray(row) ? row : columns.map(column => (row as Record<string, unknown>)[column])) as Param[];
        batch.push(values.map(value => (value instanceof Uint8Array ? Buffer.from(value) : value)));
        counts[table]++;
        if (batch.length >= 500) { await insertRows(table, columns, batch); batch = []; }
      }
      await insertRows(table, columns, batch);
      console.log(`  ${table.padEnd(20)} ${counts[table]}`);
    }
    const orphans = await orphanReport();
    if (orphans.length) throw new Error(`Data SQLite berisi rujukan yang rusak, impor dibatalkan:\n  ${orphans.join("\n  ")}`);
  }));
  const after = await rowCounts(Object.keys(counts));
  const mismatch = Object.entries(counts).filter(([table, count]) => after[table] !== count);
  // Menu baru (mis. Log Aktivitas) ditambahkan setelah jumlah baris dicocokkan.
  const added = await ensureDefaultMenus();
  if (mismatch.length) fail(`Jumlah baris tidak cocok setelah impor: ${mismatch.map(([table, count]) => `${table} ${count} → ${after[table]}`).join(", ")}`);
  console.log(`Selesai. ${Object.values(counts).reduce((sum, count) => sum + count, 0)} baris dipindahkan${added.length ? `; menu baru untuk admin: ${added.join(", ")}` : ""}.`);
  console.log("Berkas SQLite tidak diubah. Simpan sebagai cadangan sampai Anda yakin data di MySQL lengkap.");
} catch (error) {
  console.error("Impor gagal:", (error as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await closePool();
}
