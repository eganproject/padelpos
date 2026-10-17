import { db, getMenus, getRoles, pool, saveMenus, saveRoles, type Param } from "./store.js";
import { menuSeed, tableOrder } from "./schema.js";

/**
 * Alat bersama untuk memindahkan data massal: pemulihan backup dan impor dari SQLite lama.
 * Kolom disalin menurut irisan kolom sumber dan tujuan, jadi data dari versi lama yang belum
 * punya kolom baru tetap masuk dan kolom baru memakai nilai bawaannya.
 */

/** Tabel yang tidak disalin: sesi login dan kode OTP sengaja tidak ikut dipulihkan. */
export const skippedTables = new Set(["sessions", "otp_codes", "migrations", "app_lock"]);
export const dataTables = tableOrder.filter(table => !skippedTables.has(table));

/** Kolom yang bisa diisi (tanpa kolom turunan seperti email_key). */
export async function writableColumns(table: string) {
  // Hanya kolom turunan (VIRTUAL/STORED GENERATED) yang dilewati. Kolom dengan nilai bawaan berupa
  // ekspresi, mis. TEXT DEFAULT (''), juga bertanda DEFAULT_GENERATED di EXTRA tetapi tetap berisi data.
  const rows = await db.prepare(`SELECT COLUMN_NAME name, EXTRA extra FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`).all(table) as { name: string; extra: string }[];
  return rows.filter(row => !/\b(?:VIRTUAL|STORED) GENERATED\b/i.test(row.extra)).map(row => row.name);
}

const quote = (name: string) => "`" + name.replace(/`/g, "``") + "`";
const sizeOf = (value: unknown) => (Buffer.isBuffer(value) ? value.length : typeof value === "string" ? value.length * 2 : 8);

/**
 * Masukkan baris secara bertahap. Satu pernyataan dibatasi sekitar 4 MB agar aman terhadap
 * `max_allowed_packet` bawaan MySQL, walau tabel foto berisi berkas besar.
 */
export async function insertRows(table: string, columns: string[], rows: Param[][]) {
  if (!rows.length) return;
  const head = `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES `;
  const one = `(${columns.map(() => "?").join(",")})`;
  let batch: Param[][] = [], bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await db.prepare(head + batch.map(() => one).join(",")).run(...batch.flat());
    batch = []; bytes = 0;
  };
  for (const row of rows) {
    const size = row.reduce<number>((sum, value) => sum + sizeOf(value), 0);
    if (batch.length && (bytes + size > 4_000_000 || batch.length >= 500)) await flush();
    batch.push(row); bytes += size;
  }
  await flush();
}

/** Kosongkan semua tabel data, termasuk data bawaan migrasi, sebelum diisi ulang. */
export async function clearTables() {
  for (const table of [...dataTables].reverse()) await db.prepare(`DELETE FROM ${quote(table)}`).run();
  // Sesi dan kode OTP lama tidak berlaku lagi untuk data yang baru dimuat; semua orang masuk ulang.
  await db.prepare("DELETE FROM sessions").run();
  await db.prepare("DELETE FROM otp_codes").run();
}
/** Pemeriksaan foreign key dimatikan selama impor, karena beberapa tabel saling merujuk. */
export async function withoutForeignKeys<T>(work: () => Promise<T>) {
  await db.exec("SET FOREIGN_KEY_CHECKS=0");
  try { return await work(); } finally { await db.exec("SET FOREIGN_KEY_CHECKS=1"); }
}

/**
 * Baris yang merujuk data yang tidak ada. Dipanggil setelah impor dengan foreign key dimatikan,
 * agar data rusak tidak diam-diam ikut masuk.
 */
export async function orphanReport() {
  const constraints = await db.prepare(`SELECT k.TABLE_NAME tbl, k.COLUMN_NAME col, k.REFERENCED_TABLE_NAME ref, k.REFERENCED_COLUMN_NAME ref_col
    FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`).all() as { tbl: string; col: string; ref: string; ref_col: string }[];
  const problems: string[] = [];
  for (const fk of constraints) {
    const row = await db.prepare(`SELECT count(*) n FROM ${quote(fk.tbl)} t WHERE t.${quote(fk.col)} IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${quote(fk.ref)} r WHERE r.${quote(fk.ref_col)}=t.${quote(fk.col)})`).get() as { n: number };
    if (row.n) problems.push(`${fk.tbl}.${fk.col} → ${fk.ref}: ${row.n} baris`);
  }
  return problems;
}

/**
 * Menu bawaan yang belum ada (mis. data lama dari sebelum menu itu dibuat) ditambahkan,
 * dan role admin mendapat aksesnya. Menu yang sudah ada tidak diubah.
 */
export async function ensureDefaultMenus() {
  const menus = await getMenus();
  const stamp = new Date().toISOString();
  const added: string[] = [];
  for (const [id, name, path, icon, group, order] of menuSeed) {
    if (menus.some(menu => menu.id === id || menu.path === path)) continue;
    menus.push({ id, name, path, icon, group, order, active: true, createdAt: stamp });
    added.push(id);
  }
  if (!added.length) return added;
  await saveMenus(menus);
  const roles = await getRoles();
  for (const role of roles) if (role.slug === "admin") for (const id of added) if (!role.menuIds.includes(id)) role.menuIds.push(id);
  await saveRoles(roles);
  return added;
}

export async function rowCounts(tables = dataTables) {
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table] = (await db.prepare(`SELECT count(*) n FROM ${quote(table)}`).get() as { n: number }).n;
  return counts;
}

export const closePool = () => pool.end();
