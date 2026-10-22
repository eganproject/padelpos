import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, getMenus, getRoles, getUsers, isDuplicate, readSetting, saveSetting } from "./store.js";
import { check } from "./errors.js";
import type { AccessRole } from "./types.js";

/**
 * Notifikasi staf di panel admin: ikon lonceng di bilah atas dengan daftar peristiwa terbaru.
 *
 * Setiap peristiwa dicatat sekali di `staff_notifications` (kunci unik mencegah ganda, mis. webhook
 * Midtrans yang datang berkali-kali). Siapa yang melihatnya dihitung saat dibaca: role pengguna harus
 * menyalakan jenis peristiwanya di Pengaturan > Notifikasi > Staf dan punya akses ke menu yang
 * terkait, agar tautannya tidak berujung "tidak punya akses". Staf yang melakukan aksinya sendiri
 * (mis. kasir yang membatalkan booking) tidak menerima notifikasinya.
 */
export const staffEvents = ["booking_new", "payment_in", "cancelled", "reschedule", "rental_unreturned", "member"] as const;
export type StaffEvent = typeof staffEvents[number];
export type StaffTone = "info" | "success" | "warning" | "danger";

/** Menu yang wajib dimiliki role agar bisa menerima peristiwa itu (cukup salah satu). */
export const eventMenus: Record<StaffEvent, string[]> = {
  booking_new: ["bookings"],
  payment_in: ["bookings", "members", "finance"],
  cancelled: ["bookings"],
  reschedule: ["bookings"],
  rental_unreturned: ["bookings", "addons"],
  member: ["members"],
};

/** Notifikasi lebih tua dari ini dihapus oleh proses latar; daftar di lonceng hanya membaca 30 hari terakhir. */
const keepDays = 90, windowDays = 30;
const since = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

interface Settings { roles: Record<string, StaffEvent[]>; updated_at: string | null }
const settingsKey = "staff_alerts";

/** Hak akses menu aktif per role. */
async function access() {
  const active = new Set((await getMenus()).filter(menu => menu.active).map(menu => menu.id));
  return (role: AccessRole) => staffEvents.filter(event => eventMenus[event].some(id => active.has(id) && role.menuIds.includes(id)));
}

/** Peristiwa yang diterima role: pilihan tersimpan, atau semua yang bisa diaksesnya bila belum pernah diatur. */
async function eventsFor(role: AccessRole | undefined) {
  if (!role) return [];
  const allowed = (await access())(role);
  const saved = (await readSetting<Settings>(settingsKey))?.roles?.[role.id];
  return saved ? allowed.filter(event => saved.includes(event)) : allowed;
}

/** Catat satu notifikasi staf. Aman di dalam transaksi; kunci yang sudah ada diabaikan. */
export async function notifyStaffInbox(key: string, event: StaffEvent, message: { title: string; body: string; link?: string; tone?: StaffTone }, refId: string | null, actorId: string | null = null) {
  try {
    await db.prepare("INSERT INTO staff_notifications (id,`key`,event,title,body,link,tone,ref_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), key.slice(0, 191), event, message.title.slice(0, 255), message.body.slice(0, 2000), (message.link ?? "").slice(0, 512), message.tone ?? "info", refId, actorId, new Date().toISOString());
    return true;
  } catch (error) {
    if (isDuplicate(error)) return false;
    throw error;
  }
}

async function viewer(userId: string) {
  const user = (await getUsers()).find(item => item.id === userId);
  const role = user ? (await getRoles()).find(item => item.slug === user.role) : undefined;
  return { events: await eventsFor(role) };
}
/** Penyaring bersama: jenis yang diterima, 30 hari terakhir, dan bukan aksi pengguna itu sendiri. */
const visible = (events: StaffEvent[]) => `n.event IN (${events.map(() => "?").join(",")}) AND n.created_at>=? AND (n.actor_id IS NULL OR n.actor_id<>?)`;

export async function staffUnread(userId: string) {
  const { events } = await viewer(userId);
  if (!events.length) return 0;
  const row = await db.prepare(`SELECT count(*) n FROM staff_notifications n LEFT JOIN staff_notification_reads r ON r.notification_id=n.id AND r.user_id=?
    WHERE ${visible(events)} AND r.user_id IS NULL`).get(userId, ...events, since(windowDays), userId) as { n: number };
  return Number(row.n);
}

export interface StaffItem { id: string; event: StaffEvent; title: string; body: string; link: string; tone: StaffTone; read: boolean; created_at: string }
export async function staffInbox(userId: string, input: unknown) {
  const { limit, before, unread } = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().max(32).optional(),
    unread: z.enum(["1", "0"]).optional(),
  }).parse(input ?? {});
  const { events } = await viewer(userId);
  if (!events.length) return { items: [] as StaffItem[], unread: 0, more: false, events };
  const rows = await db.prepare(`SELECT n.id,n.event,n.title,n.body,n.link,n.tone,n.created_at,r.read_at FROM staff_notifications n
      LEFT JOIN staff_notification_reads r ON r.notification_id=n.id AND r.user_id=?
    WHERE ${visible(events)} AND (? IS NULL OR n.created_at<?) AND (?=0 OR r.user_id IS NULL)
    ORDER BY n.created_at DESC,n.id LIMIT ?`).all(userId, ...events, since(windowDays), userId, before ?? null, before ?? null, unread === "1" ? 1 : 0, limit + 1) as
    { id: string; event: StaffEvent; title: string; body: string; link: string; tone: StaffTone; created_at: string; read_at: string | null }[];
  const items: StaffItem[] = rows.slice(0, limit).map(row => ({ id: row.id, event: row.event, title: row.title, body: row.body, link: row.link, tone: row.tone, read: !!row.read_at, created_at: row.created_at }));
  return { items, unread: await staffUnread(userId), more: rows.length > limit, events };
}

/** Tandai sudah dibaca: beberapa id tertentu, atau semua yang terlihat bila `ids` tidak dikirim. */
export async function markStaffRead(userId: string, input: unknown) {
  const { ids } = z.object({ ids: z.array(z.string().max(64)).max(100).optional() }).parse(input ?? {});
  const { events } = await viewer(userId);
  const stamp = new Date().toISOString();
  if (events.length && (!ids || ids.length)) {
    await db.prepare(`INSERT IGNORE INTO staff_notification_reads (user_id,notification_id,read_at)
      SELECT ?,n.id,? FROM staff_notifications n WHERE ${visible(events)}${ids ? ` AND n.id IN (${ids.map(() => "?").join(",")})` : ""}`)
      .run(userId, stamp, ...events, since(windowDays), userId, ...(ids ?? []));
  }
  return { unread: await staffUnread(userId) };
}

/** Hapus notifikasi lama (status dibacanya ikut terhapus). Dipanggil proses latar. */
export async function pruneStaffNotifications() {
  return (await db.prepare("DELETE FROM staff_notifications WHERE created_at<?").run(since(keepDays))).changes;
}

// --- Pengaturan per role --------------------------------------------------------

export async function staffAlertSettings() {
  const saved = await readSetting<Settings>(settingsKey);
  const allowedOf = await access();
  const roles = await getRoles();
  return {
    roles: roles.map(role => {
      const allowed = allowedOf(role);
      const configured = saved?.roles?.[role.id];
      return { id: role.id, name: role.name, slug: role.slug, allowed, events: configured ? allowed.filter(event => configured.includes(event)) : allowed, custom: !!configured };
    }),
    event_menus: eventMenus,
    updated_at: saved?.updated_at ?? null,
  };
}

const eventSchema = z.enum(staffEvents);
export async function saveStaffAlertSettings(input: unknown, actor: string) {
  const data = z.object({ roles: z.record(z.string().max(64), z.array(eventSchema).max(staffEvents.length)) }).parse(input);
  const known = new Set((await getRoles()).map(role => role.id));
  for (const id of Object.keys(data.roles)) check(known.has(id), 400, "Role tidak ditemukan.");
  const saved = await readSetting<Settings>(settingsKey);
  const roles = { ...(saved?.roles ?? {}) };
  for (const [id, events] of Object.entries(data.roles)) roles[id] = [...new Set(events)];
  await saveSetting(settingsKey, { roles, updated_at: new Date().toISOString() } satisfies Settings);
  await audit(actor, "staff_alerts.update", settingsKey, { roles: data.roles });
  return await staffAlertSettings();
}
