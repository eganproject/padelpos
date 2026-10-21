import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { databaseUrl } from "./config.js";
import { accountSeed, defaultMenus, defaultRoles, membershipAccounts, menuSeed, schema, schemaV2, schemaV4, schemaV5, schemaV6, schemaV7, schemaV9 } from "./schema.js";
import type { AccessMenu, AccessRole, User } from "./types.js";

/**
 * Lapisan database MySQL.
 *
 * `db.prepare(sql).get/all/run` sengaja meniru bentuk node:sqlite yang dulu dipakai, hanya saja
 * hasilnya Promise. Parameter dikirim lewat `query()` (escaping di sisi klien) sehingga satu
 * permintaan cukup satu perjalanan ke server dan `LIMIT ?` berisi angka tetap valid.
 *
 * Semua penulisan berjalan berurutan seperti di SQLite: `transaction()` mengunci baris tunggal
 * `app_lock` dengan `SELECT ... FOR UPDATE` sebelum mengerjakan apa pun, dan `run()` di luar transaksi
 * otomatis dibungkus transaksi pendek. Pemeriksaan "baca lalu tulis" (bentrok jadwal, stok, nomor
 * jurnal) karenanya tidak bisa saling mendahului antarpermintaan maupun antarproses API.
 */
export type Param = string | number | bigint | boolean | null | undefined | Buffer | Uint8Array;
type Row = any;
export interface RunResult { changes: number; lastInsertRowid: number }
interface Scope { connection: PoolConnection; open: boolean }

const scope = new AsyncLocalStorage<Scope>();
const sessionSetup = [
  "SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
  "SET SESSION time_zone='+00:00'",
  "SET SESSION transaction_isolation='READ-COMMITTED'",
].join(";");

function createPool(): Pool {
  const pool = mysql.createPool({
    uri: databaseUrl,
    // Kolase koneksi hanya untuk literal; perbandingan data mengikuti kolase kolom di schema.ts.
    // (utf8mb4_0900_bin berid 309 dan tidak muat di paket handshake mysql2.)
    charset: "utf8mb4_0900_ai_ci",
    timezone: "Z",
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: true,
    connectionLimit: Number(process.env.DATABASE_POOL_SIZE || 10),
    waitForConnections: true,
    enableKeepAlive: true,
  });
  // Setiap koneksi baru diatur sama: mode ketat tanpa ONLY_FULL_GROUP_BY, jam UTC, dan READ COMMITTED.
  pool.pool.on("connection", connection => { connection.query(sessionSetup, error => { if (error) console.error("Gagal menyiapkan sesi MySQL:", error); }); });
  return pool;
}
export let pool = createPool();

/** Koneksi transaksi yang sedang berjalan di alur async ini, atau pool bila di luar transaksi. */
function executor() {
  const current = scope.getStore();
  return current?.open ? current.connection : pool;
}
const toParams = (params: Param[]) => params.map(value => (value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value === undefined ? null : value));

async function rows(sql: string, params: Param[]): Promise<Row[]> {
  const [result] = await executor().query(sql, toParams(params));
  return result as Row[];
}
async function write(sql: string, params: Param[]): Promise<RunResult> {
  if (!scope.getStore()?.open) return transaction(() => write(sql, params));
  const [result] = await executor().query(sql, toParams(params));
  const header = result as ResultSetHeader;
  return { changes: header.affectedRows, lastInsertRowid: header.insertId };
}

export interface Statement {
  get(...params: Param[]): Promise<Row | undefined>;
  all(...params: Param[]): Promise<Row[]>;
  run(...params: Param[]): Promise<RunResult>;
}
export const db = {
  prepare(sql: string): Statement {
    return {
      get: async (...params) => (await rows(sql, params))[0],
      all: (...params) => rows(sql, params),
      run: (...params) => write(sql, params),
    };
  },
  /** Beberapa pernyataan SQL tanpa parameter, dipisah titik koma. */
  async exec(sql: string) { await executor().query(sql); },
  async close() { await pool.end(); },
};

export const inTransaction = () => !!scope.getStore()?.open;
/**
 * Jalankan `work` dalam satu transaksi. Transaksi bersarang ikut transaksi luarnya.
 * Error di dalam `work` membatalkan seluruh perubahan.
 */
export async function transaction<T>(work: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.open) return work();
  const connection = await pool.getConnection();
  const state: Scope = { connection, open: true };
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM app_lock WHERE id=1 FOR UPDATE");
    const result = await scope.run(state, work);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    // Kerja async yang tidak ditunggu dan masih membawa konteks ini akan kembali memakai pool.
    state.open = false;
    connection.release();
  }
}

/** Error MySQL untuk data unik yang sudah dipakai (mis. nama lapangan kembar). */
export const isDuplicate = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";

type Collection = "users" | "roles" | "menus";
async function collection<T>(name: Collection): Promise<T[]> {
  return (await db.prepare(`SELECT document FROM ${name} ORDER BY seq`).all() as { document: string }[]).map(row => JSON.parse(row.document) as T);
}
async function saveCollection(name: Collection, items: { id: string }[]) {
  await transaction(async () => {
    await db.prepare(`DELETE FROM ${name}`).run();
    for (const item of items) await db.prepare(`INSERT INTO ${name} (id, document) VALUES (?, ?)`).run(item.id, JSON.stringify(item));
  });
}

/** Satuan kanvas layout: 1 unit = 0,1 meter. Lapangan padel standar 10 x 20 m = 100 x 200 unit. */
export const defaultVenue = { width: 600, height: 400, grid: 10 };
export type VenueLayout = typeof defaultVenue;

/**
 * Migrasi skema. Versi 1 membuat seluruh tabel sekaligus beserta data bawaannya (menu, role,
 * denah, bagan akun). Perubahan skema berikutnya ditambahkan sebagai versi baru di `migrations`.
 */
const migrations: { version: number; up: () => Promise<void> }[] = [
  {
    version: 1, async up() {
      const stamp = new Date().toISOString();
      for (const statement of schema) await db.exec(statement);
      for (const menu of defaultMenus(stamp)) await db.prepare("INSERT INTO menus (id, document) VALUES (?, ?)").run(menu.id, JSON.stringify(menu));
      for (const role of defaultRoles(stamp)) await db.prepare("INSERT INTO roles (id, document) VALUES (?, ?)").run(role.id, JSON.stringify(role));
      await db.prepare("INSERT INTO settings (`key`, document) VALUES ('venue', ?)").run(JSON.stringify(defaultVenue));
      await db.prepare("INSERT INTO floors (id, name, position, width, height, created_at) VALUES (?, 'Lantai 1', 0, ?, ?, ?)").run(randomUUID(), defaultVenue.width, defaultVenue.height, stamp);
      let position = 0;
      for (const [code, name, type, subtype, isCash, key, description] of accountSeed)
        await db.prepare("INSERT INTO accounts (id,code,name,type,subtype,is_cash,system_key,description,active,position,created_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)")
          .run(randomUUID(), code, name, type, subtype, isCash, key, description, position++, stamp);
      const accountId = async (key: string) => (await db.prepare("SELECT id FROM accounts WHERE system_key=?").get(key) as { id: string }).id;
      const kas = await accountId("kas"), bank = await accountId("bank");
      // Pembayaran online masuk ke rekening bank; tunai masuk ke laci kasir. Dapat diubah di panel.
      await db.prepare("INSERT INTO settings (`key`, document) VALUES ('finance', ?)").run(JSON.stringify({
        cash_accounts: { cash: kas, transfer: bank, qris: bank, va: bank, ewallet: bank, card: bank },
        default_cash_account: kas, locked_until: "", updated_at: stamp,
      }));
    },
  },
  {
    version: 2, async up() {
      for (const statement of schemaV2) await db.exec(statement);
      // Menu lama bernama "Notifikasi Email"; namanya diganti hanya bila admin belum mengubahnya.
      const row = await db.prepare("SELECT document FROM menus WHERE id='notifications'").get() as { document: string } | undefined;
      const menu = row ? JSON.parse(row.document) as { name: string; icon: string } : null;
      if (menu && menu.name === "Notifikasi Email") await db.prepare("UPDATE menus SET document=? WHERE id='notifications'").run(JSON.stringify({ ...menu, name: "Notifikasi", icon: "BellRing" }));
    },
  },
  {
    // Menu "Nota & Cetak" untuk database yang sudah berjalan; instalasi baru mendapatkannya dari versi 1.
    // Hanya Super Admin yang langsung bisa membukanya; role lain ditambahkan lewat Role & Akses.
    version: 3, async up() {
      if (await db.prepare("SELECT 1 FROM menus WHERE id='receipts' OR JSON_UNQUOTE(JSON_EXTRACT(document,'$.path'))='/admin/nota'").get()) return;
      const menu = defaultMenus(new Date().toISOString()).find(item => item.id === "receipts")!;
      await db.prepare("INSERT INTO menus (id, document) VALUES (?, ?)").run(menu.id, JSON.stringify(menu));
      const row = await db.prepare("SELECT document FROM roles WHERE id='admin'").get() as { document: string } | undefined;
      const role = row ? JSON.parse(row.document) as AccessRole : null;
      if (role && !role.menuIds.includes(menu.id)) await db.prepare("UPDATE roles SET document=? WHERE id='admin'").run(JSON.stringify({ ...role, menuIds: [...role.menuIds, menu.id] }));
    },
  },
  {
    version: 4, async up() {
      for (const statement of schemaV4) await db.exec(statement);
      // Sumber jurnal baru `keanggotaan`: CHECK lama dicari menurut isinya karena namanya dibuat MySQL.
      const checks = await db.prepare(`SELECT c.CONSTRAINT_NAME name FROM information_schema.CHECK_CONSTRAINTS c
        JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME
        WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME='journal_entries' AND c.CHECK_CLAUSE LIKE '%pembayaran%'`).all() as { name: string }[];
      for (const row of checks) await db.exec(`ALTER TABLE journal_entries DROP CHECK \`${row.name.replace(/`/g, "``")}\``);
      await db.exec("ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source CHECK (source IN ('manual','catatan','pelunasan','transfer','modal','booking','pembayaran','keanggotaan'))");
      const stamp = new Date().toISOString();
      let position = Number((await db.prepare("SELECT COALESCE(MAX(position),0) n FROM accounts").get() as { n: number }).n);
      for (const [codes, name, type, subtype, key, description] of membershipAccounts) {
        if (await db.prepare("SELECT 1 FROM accounts WHERE system_key=?").get(key)) continue;
        // Kode dan nama boleh sudah dipakai akun buatan admin; pilih yang masih kosong.
        let code = "";
        for (const candidate of codes) if (!await db.prepare("SELECT 1 FROM accounts WHERE code=?").get(candidate)) { code = candidate; break; }
        code ||= `${codes[0]}-${randomUUID().slice(0, 3)}`;
        const label = await db.prepare("SELECT 1 FROM accounts WHERE name=?").get(name) ? `${name} (sistem)` : name;
        await db.prepare("INSERT INTO accounts (id,code,name,type,subtype,is_cash,system_key,description,active,position,created_at) VALUES (?,?,?,?,?,0,?,?,1,?,?)")
          .run(randomUUID(), code, label, type, subtype, key, description, ++position, stamp);
      }
      // Menu Member: database baru sudah mendapatkannya dari versi 1, database lama ditambahkan di sini.
      const seed = menuSeed.find(([menuId]) => menuId === "members")!;
      if (!await db.prepare("SELECT 1 FROM menus WHERE id='members' OR path_key=?").get(seed[2])) {
        const [menuId, name, path, icon, group, order] = seed;
        await db.prepare("INSERT INTO menus (id, document) VALUES (?, ?)").run(menuId, JSON.stringify({ id: menuId, name, path, icon, group, order, active: true, createdAt: stamp }));
        const admin = await db.prepare("SELECT document FROM roles WHERE id='admin'").get() as { document: string } | undefined;
        const role = admin ? JSON.parse(admin.document) as AccessRole : null;
        if (role && !role.menuIds.includes(menuId)) await db.prepare("UPDATE roles SET document=? WHERE id='admin'").run(JSON.stringify({ ...role, menuIds: [...role.menuIds, menuId] }));
      }
    },
  },
  {
    version: 5, async up() {
      for (const statement of schemaV5) await db.exec(statement);
      // Sumber jurnal baru `kasir` untuk transaksi langsung di kasir.
      const checks = await db.prepare(`SELECT c.CONSTRAINT_NAME name FROM information_schema.CHECK_CONSTRAINTS c
        JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME
        WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME='journal_entries' AND c.CHECK_CLAUSE LIKE '%pembayaran%'`).all() as { name: string }[];
      for (const row of checks) await db.exec(`ALTER TABLE journal_entries DROP CHECK \`${row.name.replace(/`/g, "``")}\``);
      await db.exec("ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source CHECK (source IN ('manual','catatan','pelunasan','transfer','modal','booking','pembayaran','keanggotaan','kasir'))");
    },
  },
  {
    version: 6, async up() {
      for (const statement of schemaV6) await db.exec(statement);
    },
  },
  {
    version: 7, async up() {
      for (const statement of schemaV7) await db.exec(statement);
      // Status `pending`/`expired` dan metode `midtrans` untuk transaksi kasir yang dibayar lewat Midtrans.
      const checks = await db.prepare(`SELECT c.CONSTRAINT_NAME name, c.CHECK_CLAUSE clause FROM information_schema.CHECK_CONSTRAINTS c
        JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME
        WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME='counter_sales' AND (c.CHECK_CLAUSE LIKE '%void%' OR c.CHECK_CLAUSE LIKE '%qris%')`).all() as { name: string }[];
      for (const row of checks) await db.exec(`ALTER TABLE counter_sales DROP CHECK \`${row.name.replace(/`/g, "``")}\``);
      await db.exec("ALTER TABLE counter_sales ADD CONSTRAINT counter_sales_status CHECK (status IN ('pending','paid','void','expired'))");
      await db.exec("ALTER TABLE counter_sales ADD CONSTRAINT counter_sales_method CHECK (method IN ('cash','transfer','qris','va','ewallet','card','midtrans'))");
    },
  },
  {
    // Pengaturan > Brand: tabel berkas logo dan favicon, serta menunya untuk database yang sudah berjalan.
    // Nomor 8 dipakai biaya admin Midtrans; urutan penerapan keduanya tidak saling bergantung.
    version: 9, async up() {
      for (const statement of schemaV9) await db.exec(statement);
      const seed = menuSeed.find(([menuId]) => menuId === "brand")!;
      if (await db.prepare("SELECT 1 FROM menus WHERE id='brand' OR path_key=?").get(seed[2])) return;
      const [menuId, name, path, icon, group, order] = seed;
      await db.prepare("INSERT INTO menus (id, document) VALUES (?, ?)").run(menuId, JSON.stringify({ id: menuId, name, path, icon, group, order, active: true, createdAt: new Date().toISOString() }));
      const row = await db.prepare("SELECT document FROM roles WHERE id='admin'").get() as { document: string } | undefined;
      const role = row ? JSON.parse(row.document) as AccessRole : null;
      if (role && !role.menuIds.includes(menuId)) await db.prepare("UPDATE roles SET document=? WHERE id='admin'").run(JSON.stringify({ ...role, menuIds: [...role.menuIds, menuId] }));
    },
  },
];

async function ensureDatabase() {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    if (!(typeof error === "object" && error && "code" in error && error.code === "ER_BAD_DB_ERROR")) throw error;
    // Database belum ada: buat bila pengguna MySQL punya haknya, lalu sambung ulang.
    const url = new URL(databaseUrl);
    const name = decodeURIComponent(url.pathname.slice(1));
    url.pathname = "/";
    const admin = await mysql.createConnection({ uri: url.toString() });
    try { await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name.replace(/`/g, "``")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`); }
    finally { await admin.end(); }
    await pool.end();
    pool = createPool();
  }
}

export async function migrate() {
  await ensureDatabase();
  await db.exec("CREATE TABLE IF NOT EXISTS migrations (version INT PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)");
  // GET_LOCK menjaga dua proses API yang menyala bersamaan agar tidak menjalankan migrasi yang sama.
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('padelix_migrate', 60) acquired") as unknown as [[{ acquired: number }]];
    if (lock.acquired !== 1) throw new Error("Tidak bisa mengunci migrasi database. Pastikan tidak ada proses lain yang macet.");
    const done = new Set((await connection.query("SELECT version FROM migrations") as unknown as [{ version: number }[]])[0].map(row => row.version));
    for (const migration of migrations) {
      if (done.has(migration.version)) continue;
      // DDL MySQL langsung tersimpan (tidak bisa di-rollback), jadi tabel dibuat dulu lalu versinya dicatat.
      await scope.run({ connection, open: true }, migration.up);
      await connection.query("INSERT INTO migrations VALUES (?, ?)", [migration.version, new Date().toISOString()]);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('padelix_migrate')").catch(() => undefined);
    connection.release();
  }
}
await migrate();

export const getUsers = () => collection<User>("users");
export const getRoles = () => collection<AccessRole>("roles");
export const getMenus = () => collection<AccessMenu>("menus");
export const saveUsers = (items: User[]) => saveCollection("users", items);
export const saveRoles = (items: AccessRole[]) => saveCollection("roles", items);
export const saveMenus = (items: AccessMenu[]) => saveCollection("menus", items);

/** Simpan dokumen pengaturan (`settings`), menimpa isi lama bila kuncinya sudah ada. */
export async function saveSetting(key: string, document: unknown) {
  await db.prepare("INSERT INTO settings (`key`, document) VALUES (?, ?) AS fresh ON DUPLICATE KEY UPDATE document = fresh.document").run(key, JSON.stringify(document));
}
/** Isi dokumen pengaturan, atau undefined bila belum pernah disimpan. */
export async function readSetting<T = Record<string, unknown>>(key: string): Promise<T | undefined> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key` = ?").get(key) as { document: string } | undefined;
  return row ? JSON.parse(row.document) as T : undefined;
}

/**
 * Catat aksi staf. `detail` menyimpan nilai sebelum dan sesudah untuk aksi yang menyangkut uang
 * (potongan harga, refund, denda, jurnal), agar selisih kas bisa ditelusuri dari Log Aktivitas.
 */
export async function audit(actor: string, action: string, target: string, detail?: Record<string, unknown>) {
  await db.prepare("INSERT INTO audit_log (actor_id,action,target_id,detail,created_at) VALUES (?,?,?,?,?)")
    .run(actor, action, target, detail ? JSON.stringify(detail) : null, new Date().toISOString());
}
