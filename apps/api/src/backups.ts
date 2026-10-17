import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { z } from "zod";
import type { Connection as CoreConnection } from "mysql2";
import { dataDir } from "./config.js";
import { audit, pool, readSetting, saveSetting, transaction, type Param } from "./store.js";
import { check } from "./errors.js";
import { localClock } from "./clock.js";
import { clearTables, dataTables, ensureDefaultMenus, insertRows, orphanReport, rowCounts, withoutForeignKeys, writableColumns } from "./datatransfer.js";

/**
 * Cadangan data. Satu berkas `.json.gz` berisi seluruh tabel data (termasuk foto) dalam format
 * JSON per baris: satu baris kepala, lalu per tabel satu baris kolom diikuti baris datanya.
 * Dibaca dari satu snapshot transaksi sehingga isinya konsisten walau API sedang dipakai, dan
 * tidak memegang kunci tulis, jadi booking tetap bisa masuk selama backup berjalan.
 *
 * Jadwal bawaan: setiap hari pukul 02.00 waktu venue, menyimpan 14 berkas terakhir di
 * `DATA_DIR/backups`. Pemulihan lewat `npm run restore -w apps/api -- <berkas>`.
 */
export const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, "backups"));
const format = "padelix-backup";
const namePattern = /^padelix-\d{8}-\d{6}(?:-[a-z]+)?\.json\.gz$/;

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  keep: z.number().int().min(1, "Simpan minimal 1 berkas.").max(90, "Maksimal 90 berkas."),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema> & { updated_at: string | null };
const defaults: BackupSettings = { enabled: true, hour: 2, keep: 14, updated_at: null };
export async function backupSettings(): Promise<BackupSettings> {
  return { ...defaults, ...await readSetting<Partial<BackupSettings>>("backup") };
}

interface Status { running: boolean; last_error: string; last_error_at: string | null }
const status: Status = { running: false, last_error: "", last_error_at: null };

const encode = (value: unknown) => (Buffer.isBuffer(value) ? { $b64: value.toString("base64") } : value);
const decode = (value: unknown): Param =>
  (value && typeof value === "object" && "$b64" in value ? Buffer.from(String((value as { $b64: string }).$b64), "base64") : value as Param);

function stampName(kind: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const local = localClock(now);
  return `padelix-${local.date.replace(/-/g, "")}-${local.time.replace(":", "")}${pad(now.getSeconds())}-${kind}.json.gz`;
}

/** Tulis satu berkas backup. Mengembalikan nama berkas dan jumlah baris per tabel. */
export async function createBackup(kind: "manual" | "otomatis" = "manual") {
  check(!status.running, 409, "Backup lain sedang berjalan. Tunggu sebentar lalu muat ulang.");
  status.running = true;
  const connection = await pool.getConnection();
  await mkdir(backupDir, { recursive: true });
  const name = stampName(kind === "manual" ? "manual" : "auto");
  const final = path.join(backupDir, name), temporary = final + ".tmp";
  const counts: Record<string, number> = {};
  try {
    // Snapshot konsisten tanpa mengunci tabel; REPEATABLE READ hanya untuk transaksi baca ini.
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [[{ version }]] = await connection.query("SELECT COALESCE(MAX(version),0) version FROM migrations") as unknown as [[{ version: number }]];
    const gzip = createGzip({ level: 6 });
    const file = createWriteStream(temporary);
    gzip.pipe(file);
    const write = async (value: unknown) => { if (!gzip.write(JSON.stringify(value) + "\n")) await once(gzip, "drain"); };
    await write({ format, version: 1, schema_version: version, created_at: new Date().toISOString(), kind, tables: dataTables });
    for (const table of dataTables) {
      const columns = await writableColumns(table);
      await write({ table, columns });
      counts[table] = 0;
      // Dibaca sebagai stream agar tabel foto yang besar tidak dimuat sekaligus ke memori.
      const order = (columns.includes("seq") ? ["seq"] : columns.includes("id") ? ["id"] : columns).map(column => "`" + column + "`").join(",");
      const core = (connection as unknown as { connection: CoreConnection }).connection;
      const stream = core.query({ sql: `SELECT ${columns.map(column => "`" + column + "`").join(",")} FROM \`${table}\` ORDER BY ${order}`, rowsAsArray: true }).stream();
      for await (const row of stream as AsyncIterable<unknown[]>) { await write(row.map(encode)); counts[table]++; }
    }
    await connection.query("COMMIT");
    gzip.end();
    await once(file, "close");
    await rename(temporary, final);
    status.last_error = ""; status.last_error_at = null;
    await prune();
    return { name, counts };
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    status.last_error = (error as Error).message; status.last_error_at = new Date().toISOString();
    throw error;
  } finally {
    connection.release();
    status.running = false;
  }
}

export async function listBackups() {
  await mkdir(backupDir, { recursive: true });
  const names = (await readdir(backupDir)).filter(name => namePattern.test(name)).sort().reverse();
  const files = [];
  for (const name of names) {
    const info = await stat(path.join(backupDir, name));
    files.push({ name, bytes: info.size, created_at: info.mtime.toISOString(), kind: name.includes("-manual") ? "manual" : "otomatis" });
  }
  return files;
}
/** Hapus berkas lama di luar jumlah yang disimpan. Backup manual ikut dihitung. */
async function prune() {
  const { keep } = await backupSettings();
  for (const file of (await listBackups()).slice(keep)) await unlink(path.join(backupDir, file.name)).catch(() => undefined);
}
export function backupPath(name: string) {
  check(namePattern.test(name), 404, "Berkas backup tidak ditemukan.");
  return path.join(backupDir, name);
}
export async function removeBackup(name: string, actor: string) {
  const file = backupPath(name);
  await unlink(file).catch(() => check(false, 404, "Berkas backup tidak ditemukan."));
  await audit(actor, "backup.delete", name);
}

export async function backupOverview() {
  const settings = await backupSettings();
  const files = await listBackups();
  return { settings, files, directory: backupDir, running: status.running, last_error: status.last_error, last_error_at: status.last_error_at, today: localClock().date };
}
export async function saveBackupSettings(input: unknown, actor: string) {
  const data = backupSettingsSchema.parse(input);
  await transaction(async () => {
    await saveSetting("backup", { ...data, updated_at: new Date().toISOString() });
    await audit(actor, "backup.settings", "backup", data);
  });
  await prune();
  return backupOverview();
}

/** Sudah ada backup hari ini (menurut jam venue)? Dipakai penjadwal agar tidak dobel. */
async function doneToday() {
  const today = localClock().date.replace(/-/g, "");
  return (await listBackups()).some(file => file.name.startsWith(`padelix-${today}-`) && file.kind === "otomatis");
}
/**
 * Penjadwal: diperiksa setiap 10 menit. Bila beberapa proses API memakai database yang sama,
 * GET_LOCK memastikan hanya satu yang menulis backup.
 */
export function startBackups(intervalMs = 10 * 60 * 1000) {
  const tick = async () => {
    const settings = await backupSettings();
    if (!settings.enabled || status.running) return;
    if (Number(localClock().time.slice(0, 2)) < settings.hour || await doneToday()) return;
    const connection = await pool.getConnection();
    try {
      const [[lock]] = await connection.query("SELECT GET_LOCK('padelix_backup', 0) acquired") as unknown as [[{ acquired: number }]];
      if (lock.acquired !== 1) return;
      try {
        if (!await doneToday()) {
          const result = await createBackup("otomatis");
          console.log(`Backup otomatis tersimpan: ${result.name}`);
        }
      } finally { await connection.query("SELECT RELEASE_LOCK('padelix_backup')"); }
    } finally { connection.release(); }
  };
  const run = () => { tick().catch(error => console.error("Backup otomatis gagal:", (error as Error).message)); };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  setTimeout(run, 15000).unref();
  return () => clearInterval(timer);
}

// --- Pemulihan -----------------------------------------------------------------

interface Header { format: string; version: number; schema_version: number; created_at: string; tables: string[] }
async function* readLines(file: string) {
  const info = await stat(file).catch(() => undefined);
  check(info?.isFile(), 404, `Berkas backup tidak ditemukan: ${path.basename(file)}`);
  // .pipe() tidak meneruskan error baca berkas ke gunzip, jadi diteruskan sendiri agar pemulihan gagal dengan rapi.
  const source = createReadStream(file), gunzip = createGunzip();
  source.on("error", error => gunzip.destroy(error));
  const lines = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  for await (const line of lines) if (line) yield JSON.parse(line) as unknown;
}

/**
 * Pulihkan database dari berkas backup: seluruh isi tabel data diganti isi berkas. Berjalan dalam
 * satu transaksi, jadi bila gagal di tengah jalan database kembali seperti sebelum pemulihan.
 */
export async function restoreBackup(file: string) {
  const lines = readLines(file);
  const first = await lines.next();
  const header = first.value as Header | undefined;
  check(header?.format === format, 400, "Berkas ini bukan backup Padelix.");
  const known = new Set(dataTables);
  const counts: Record<string, number> = {};
  await transaction(() => withoutForeignKeys(async () => {
    await clearTables();
    let table = "", columns: string[] = [], target: string[] = [], pick: number[] = [], rows: Param[][] = [], bytes = 0;
    const flush = async () => { if (table && rows.length) await insertRows(table, target, rows); rows = []; bytes = 0; };
    for await (const line of lines) {
      if (!Array.isArray(line)) {
        await flush();
        const section = line as { table: string; columns: string[] };
        table = known.has(section.table) ? section.table : "";
        columns = section.columns;
        const writable = table ? await writableColumns(table) : [];
        target = columns.filter(column => writable.includes(column));
        pick = target.map(column => columns.indexOf(column));
        if (table) counts[table] = 0;
        continue;
      }
      if (!table) continue;
      const row = pick.map(index => decode(line[index]));
      rows.push(row);
      counts[table]++;
      bytes += row.reduce((sum: number, value) => sum + (Buffer.isBuffer(value) ? value.length : String(value ?? "").length), 0);
      if (rows.length >= 500 || bytes > 8_000_000) await flush();
    }
    await flush();
    const orphans = await orphanReport();
    check(!orphans.length, 409, `Backup berisi rujukan yang rusak: ${orphans.join("; ")}`);
  }));
  const after = await rowCounts(Object.keys(counts));
  for (const [name, count] of Object.entries(counts)) check(after[name] === count, 500, `Jumlah baris ${name} tidak cocok setelah pemulihan.`);
  // Backup dari versi lama mungkin belum punya menu terbaru; ditambahkan untuk role admin.
  await ensureDefaultMenus();
  return { header, counts };
}
