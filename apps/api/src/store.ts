import { mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./config.js";
import type { AccessMenu, AccessRole, User } from "./types.js";

mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "padelix.sqlite"));
db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
export function transaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
const now = new Date().toISOString();
const defaultMenus: AccessMenu[] = [
  ["dashboard", "Overview", "/admin", "LayoutDashboard", "Workspace", 1],
  ["bookings", "Bookings", "/admin/bookings", "CalendarDays", "Workspace", 2],
  ["courts", "Courts", "/admin/courts", "Activity", "Workspace", 3],
  ["users", "Users", "/admin/users", "UsersRound", "Access Control", 4],
  ["roles", "Roles", "/admin/roles", "ShieldCheck", "Access Control", 5],
  ["menus", "Menu Access", "/admin/menus", "MenuSquare", "Access Control", 6],
  ["profile", "My Profile", "/admin/profile", "UserRound", "System", 7],
].map(([id, name, menuPath, icon, group, order]) => ({ id: String(id), name: String(name), path: String(menuPath), icon: String(icon), group: String(group), order: Number(order), active: true, createdAt: now }));
const defaultRoles: AccessRole[] = [
  { id:"admin", name:"Super Admin", slug:"admin", description:"Akses penuh.", menuIds:defaultMenus.map(m=>m.id), isSystem:true, createdAt:now },
  { id:"staff", name:"Operator", slug:"staff", description:"Operasional harian.", menuIds:["dashboard","bookings","courts","profile"], isSystem:true, createdAt:now },
];
type Collection = "users" | "roles" | "menus";
function collection<T>(name: Collection): T[] {
  return (db.prepare(`SELECT document FROM ${name}`).all() as {document:string}[]).map(row => JSON.parse(row.document) as T);
}
function saveCollection(name: Collection, items: {id:string}[]) {
  db.prepare(`DELETE FROM ${name}`).run();
  const insert = db.prepare(`INSERT INTO ${name} (id, document) VALUES (?, ?)`);
  for (const item of items) insert.run(item.id, JSON.stringify(item));
}
db.exec("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
if (!db.prepare("SELECT 1 FROM migrations WHERE version = 1").get()) transaction(() => {
  for (const name of ["users","roles","menus"] as const) db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document)))`);
  db.exec(`
    CREATE UNIQUE INDEX users_email ON users (lower(json_extract(document, '$.email')));
    CREATE UNIQUE INDEX roles_slug ON roles (json_extract(document, '$.slug'));
    CREATE UNIQUE INDEX menus_path ON menus (json_extract(document, '$.path'));
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE courts (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0), opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE bookings (id TEXT PRIMARY KEY, court_id TEXT NOT NULL REFERENCES courts(id), customer TEXT NOT NULL, phone TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, total INTEGER NOT NULL CHECK(total > 0), status TEXT NOT NULL CHECK(status IN ('confirmed','completed','cancelled')), notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, cancel_reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX bookings_schedule ON bookings(court_id,date,start_time,end_time);
    CREATE TABLE maintenance (id TEXT PRIMARY KEY, court_id TEXT NOT NULL REFERENCES courts(id), date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE payments (id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), amount INTEGER NOT NULL CHECK(amount > 0), kind TEXT NOT NULL CHECK(kind IN ('payment','refund')), method TEXT NOT NULL CHECK(method IN ('cash','transfer','qris')), note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX payments_booking ON payments(booking_id);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TRIGGER booking_overlap_insert BEFORE INSERT ON bookings WHEN NEW.status <> 'cancelled' BEGIN
      SELECT RAISE(ABORT, 'schedule_conflict') WHERE EXISTS(SELECT 1 FROM bookings WHERE court_id=NEW.court_id AND date=NEW.date AND status <> 'cancelled' AND start_time < NEW.end_time AND end_time > NEW.start_time);
      SELECT RAISE(ABORT, 'schedule_conflict') WHERE EXISTS(SELECT 1 FROM maintenance WHERE court_id=NEW.court_id AND date=NEW.date AND start_time < NEW.end_time AND end_time > NEW.start_time);
    END;
    CREATE TRIGGER maintenance_overlap BEFORE INSERT ON maintenance BEGIN
      SELECT RAISE(ABORT, 'schedule_conflict') WHERE EXISTS(SELECT 1 FROM bookings WHERE court_id=NEW.court_id AND date=NEW.date AND status <> 'cancelled' AND start_time < NEW.end_time AND end_time > NEW.start_time);
      SELECT RAISE(ABORT, 'schedule_conflict') WHERE EXISTS(SELECT 1 FROM maintenance WHERE court_id=NEW.court_id AND date=NEW.date AND start_time < NEW.end_time AND end_time > NEW.start_time);
    END;
  `);
  for (const [name, defaults] of [["users", []], ["roles", defaultRoles], ["menus", defaultMenus]] as const) {
    const legacy = path.join(dataDir, `${name}.json`);
    const items = existsSync(legacy) ? JSON.parse(readFileSync(legacy,"utf8")) : defaults;
    if (!Array.isArray(items)) throw new Error(`Data migrasi ${name} tidak valid`);
    saveCollection(name, items);
  }
  db.prepare("INSERT INTO migrations VALUES (1, ?)").run(now);
});

const overlapGuard = (self: boolean) => `
  SELECT RAISE(ABORT,'schedule_conflict') WHERE EXISTS(SELECT 1 FROM bookings WHERE ${self ? "id<>NEW.id AND " : ""}court_id=NEW.court_id AND date=NEW.date AND status IN ('pending','confirmed','completed') AND NOT (status='pending' AND hold_expires_at<=unixepoch()) AND start_time<NEW.end_time AND end_time>NEW.start_time);
  SELECT RAISE(ABORT,'schedule_conflict') WHERE EXISTS(SELECT 1 FROM maintenance WHERE court_id=NEW.court_id AND date=NEW.date AND start_time<NEW.end_time AND end_time>NEW.start_time);`;
if (!db.prepare("SELECT 1 FROM migrations WHERE version = 2").get()) {
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;");
  try {
    transaction(() => {
      db.exec(`
        CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL);
        CREATE UNIQUE INDEX customers_phone ON customers (phone);
        CREATE TABLE otp_codes (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL);

        CREATE TABLE bookings_v2 (
          id TEXT PRIMARY KEY,
          court_id TEXT NOT NULL REFERENCES courts(id),
          customer_id TEXT REFERENCES customers(id),
          customer TEXT NOT NULL, phone TEXT NOT NULL,
          date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
          total INTEGER NOT NULL CHECK(total > 0),
          status TEXT NOT NULL CHECK(status IN ('pending','confirmed','completed','cancelled','expired')),
          source TEXT NOT NULL DEFAULT 'staff' CHECK(source IN ('staff','online')),
          hold_expires_at INTEGER,
          notes TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          created_at TEXT NOT NULL,
          cancel_reason TEXT NOT NULL DEFAULT '',
          CHECK ((source='staff' AND created_by IS NOT NULL) OR (source='online' AND customer_id IS NOT NULL)),
          CHECK (status<>'pending' OR hold_expires_at IS NOT NULL)
        );
        INSERT INTO bookings_v2 (id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at,cancel_reason)
          SELECT id,court_id,customer,phone,date,start_time,end_time,total,status,notes,created_by,created_at,cancel_reason FROM bookings;
        DROP TABLE bookings;
        ALTER TABLE bookings_v2 RENAME TO bookings;
        CREATE INDEX bookings_schedule ON bookings (court_id,date,start_time,end_time);
        CREATE INDEX bookings_hold ON bookings (status,hold_expires_at);
        CREATE INDEX bookings_customer ON bookings (customer_id);

        CREATE TABLE payments_v2 (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL REFERENCES bookings(id),
          amount INTEGER NOT NULL CHECK(amount > 0),
          kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
          method TEXT NOT NULL CHECK(method IN ('cash','transfer','qris','va','ewallet','card')),
          source TEXT NOT NULL DEFAULT 'staff' CHECK(source IN ('staff','gateway')),
          gateway_ref TEXT,
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          created_at TEXT NOT NULL,
          CHECK (source='gateway' OR created_by IS NOT NULL)
        );
        INSERT INTO payments_v2 (id,booking_id,amount,kind,method,note,created_by,created_at)
          SELECT id,booking_id,amount,kind,method,note,created_by,created_at FROM payments;
        DROP TABLE payments;
        ALTER TABLE payments_v2 RENAME TO payments;
        CREATE INDEX payments_booking ON payments (booking_id);
        CREATE UNIQUE INDEX payments_gateway_ref ON payments (gateway_ref) WHERE gateway_ref IS NOT NULL;

        DROP TABLE sessions;
        CREATE TABLE sessions (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_type TEXT NOT NULL CHECK(subject_type IN ('staff','customer')), expires_at INTEGER NOT NULL);

        DROP TRIGGER maintenance_overlap;
        CREATE TRIGGER booking_overlap_insert BEFORE INSERT ON bookings WHEN NEW.status IN ('pending','confirmed','completed') BEGIN${overlapGuard(false)}
        END;
        CREATE TRIGGER booking_overlap_confirm BEFORE UPDATE OF status ON bookings WHEN OLD.status='pending' AND NEW.status IN ('confirmed','completed') BEGIN${overlapGuard(true)}
        END;
        CREATE TRIGGER maintenance_overlap BEFORE INSERT ON maintenance BEGIN${overlapGuard(false)}
        END;
      `);
      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length) throw new Error(`Migrasi 2 menyisakan ${violations.length} pelanggaran foreign key.`);
      db.prepare("INSERT INTO migrations VALUES (2, ?)").run(new Date().toISOString());
    });
  } finally {
    db.exec("PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;");
  }
}

/** Satuan kanvas layout: 1 unit = 0,1 meter. Lapangan padel standar 10 x 20 m = 100 x 200 unit. */
export const defaultVenue = { width: 600, height: 400, grid: 10 };
export type VenueLayout = typeof defaultVenue;
if (!db.prepare("SELECT 1 FROM migrations WHERE version = 3").get()) transaction(() => {
  db.exec(`
    ALTER TABLE courts ADD COLUMN layout_x INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE courts ADD COLUMN layout_y INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE courts ADD COLUMN layout_w INTEGER NOT NULL DEFAULT 100;
    ALTER TABLE courts ADD COLUMN layout_h INTEGER NOT NULL DEFAULT 200;
    CREATE TABLE settings (key TEXT PRIMARY KEY, document TEXT NOT NULL CHECK(json_valid(document)));
  `);
  db.prepare("INSERT INTO settings VALUES ('venue', ?)").run(JSON.stringify(defaultVenue));

  // Lapangan yang sudah ada dijajarkan agar langsung terlihat rapi di editor.
  const placed = db.prepare("SELECT id FROM courts ORDER BY name").all() as { id: string }[];
  placed.forEach((court, index) => db.prepare("UPDATE courts SET layout_x=?, layout_y=? WHERE id=?").run(40 + index * 140, 60, court.id));

  const stamp = new Date().toISOString();
  const menus = collection<AccessMenu>("menus");
  if (!menus.some(menu => menu.id === "layout")) {
    // Sisipkan setelah Courts, lalu geser urutan menu administrasi di bawahnya.
    for (const menu of menus) if (menu.order >= 4) menu.order += 1;
    menus.push({ id: "layout", name: "Layout Venue", path: "/admin/layout", icon: "LayoutGrid", group: "Workspace", order: 4, active: true, createdAt: stamp });
    saveCollection("menus", menus);
    const roles = collection<AccessRole>("roles");
    for (const role of roles) if (role.slug === "admin" && !role.menuIds.includes("layout")) role.menuIds.push("layout");
    saveCollection("roles", roles);
  }
  db.prepare("INSERT INTO migrations VALUES (3, ?)").run(stamp);
});

/**
 * Elemen penjelas pada denah: jalan, kantin, tempat duduk, dan sejenisnya.
 * Sifatnya hanya informasi, tidak dapat dipesan, dan tidak memengaruhi jadwal.
 * `kind` sengaja tanpa CHECK agar menambah jenis baru tidak memaksa membangun
 * ulang tabel; daftar jenis yang sah dijaga di lapisan validasi.
 */
if (!db.prepare("SELECT 1 FROM migrations WHERE version = 4").get()) transaction(() => {
  db.exec(`
    CREATE TABLE venue_features (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      x INTEGER NOT NULL, y INTEGER NOT NULL,
      w INTEGER NOT NULL CHECK(w > 0), h INTEGER NOT NULL CHECK(h > 0),
      created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO migrations VALUES (4, ?)").run(new Date().toISOString());
});

/**
 * Nama menu bawaan diseragamkan ke Bahasa Indonesia agar sidebar tidak campur bahasa.
 * Nama yang sudah diubah admin tidak disentuh. Grup diganti untuk semua menu, termasuk
 * menu kustom, supaya menu kustom tidak terpisah dari grup asalnya.
 */
if (!db.prepare("SELECT 1 FROM migrations WHERE version = 5").get()) transaction(() => {
  const renames: Record<string, [from: string, to: string]> = {
    dashboard: ["Overview", "Ringkasan"], bookings: ["Bookings", "Booking"], courts: ["Courts", "Lapangan"],
    layout: ["Layout Venue", "Denah Venue"], users: ["Users", "Pengguna"], roles: ["Roles", "Role & Akses"],
    menus: ["Menu Access", "Menu Navigasi"], profile: ["My Profile", "Profil Saya"],
  };
  const groups: Record<string, string> = { "Workspace": "Operasional", "Access Control": "Hak Akses", "System": "Akun" };
  const menus = collection<AccessMenu>("menus");
  for (const menu of menus) {
    const rename = renames[menu.id];
    if (rename && menu.name === rename[0]) menu.name = rename[1];
    if (groups[menu.group]) menu.group = groups[menu.group];
  }
  saveCollection("menus", menus);
  db.prepare("INSERT INTO migrations VALUES (5, ?)").run(new Date().toISOString());
});

/**
 * Informasi untuk pelanggan: deskripsi dan foto lapangan, serta tarif khusus
 * (jam sibuk, akhir pekan). Profil venue, kebijakan, dan FAQ cukup berupa dokumen
 * di tabel settings. Menu "Info Venue" disisipkan tepat setelah Denah Venue.
 */
if (!db.prepare("SELECT 1 FROM migrations WHERE version = 6").get()) transaction(() => {
  db.exec(`
    ALTER TABLE courts ADD COLUMN description TEXT NOT NULL DEFAULT '';
    ALTER TABLE courts ADD COLUMN environment TEXT NOT NULL DEFAULT '' CHECK(environment IN ('','indoor','outdoor'));
    ALTER TABLE courts ADD COLUMN surface TEXT NOT NULL DEFAULT '';
    CREATE TABLE court_photos (
      id TEXT PRIMARY KEY,
      court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
      mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
      data BLOB NOT NULL,
      bytes INTEGER NOT NULL CHECK(bytes > 0),
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX court_photos_court ON court_photos (court_id, position);
    CREATE TABLE price_rules (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      days TEXT NOT NULL CHECK(json_valid(days)),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      hourly_rate INTEGER NOT NULL CHECK(hourly_rate > 0),
      created_at TEXT NOT NULL
    );
    CREATE TABLE price_rule_courts (
      rule_id TEXT NOT NULL REFERENCES price_rules(id) ON DELETE CASCADE,
      court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
      PRIMARY KEY (rule_id, court_id)
    );
  `);
  const menus = collection<AccessMenu>("menus");
  if (!menus.some(menu => menu.id === "info" || menu.path === "/admin/info")) {
    const anchor = menus.find(menu => menu.id === "layout") ?? menus.find(menu => menu.id === "courts");
    const order = (anchor?.order ?? 0) + 1;
    for (const menu of menus) if (menu.order >= order) menu.order += 1;
    menus.push({ id: "info", name: "Info Venue", path: "/admin/info", icon: "Store", group: anchor?.group ?? "Operasional", order, active: true, createdAt: new Date().toISOString() });
    saveCollection("menus", menus);
    const roles = collection<AccessRole>("roles");
    for (const role of roles) if (role.slug === "admin" && !role.menuIds.includes("info")) role.menuIds.push("info");
    saveCollection("roles", roles);
  }
  db.prepare("INSERT INTO migrations VALUES (6, ?)").run(new Date().toISOString());
});
export const getUsers = () => collection<User>("users");
export const getRoles = () => collection<AccessRole>("roles");
export const getMenus = () => collection<AccessMenu>("menus");
export const saveUsers = (items: User[]) => saveCollection("users", items);
export const saveRoles = (items: AccessRole[]) => saveCollection("roles", items);
export const saveMenus = (items: AccessMenu[]) => saveCollection("menus", items);
export function audit(actor: string, action: string, target: string) {
  db.prepare("INSERT INTO audit_log(actor_id,action,target_id,created_at) VALUES (?,?,?,?)").run(actor,action,target,new Date().toISOString());
}

