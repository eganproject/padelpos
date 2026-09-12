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
export const getUsers = () => collection<User>("users");
export const getRoles = () => collection<AccessRole>("roles");
export const getMenus = () => collection<AccessMenu>("menus");
export const saveUsers = (items: User[]) => saveCollection("users", items);
export const saveRoles = (items: AccessRole[]) => saveCollection("roles", items);
export const saveMenus = (items: AccessMenu[]) => saveCollection("menus", items);
export function audit(actor: string, action: string, target: string) {
  db.prepare("INSERT INTO audit_log(actor_id,action,target_id,created_at) VALUES (?,?,?,?)").run(actor,action,target,new Date().toISOString());
}

