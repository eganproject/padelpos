import { z } from "zod";
import { db, getUsers, type Param } from "./store.js";
import { localClock } from "./clock.js";

/**
 * Log Aktivitas: catatan `audit_log` yang bisa disaring per pelaku, jenis aksi, dan tanggal.
 * Pelaku bisa staf (tabel users), akun pelanggan, atau proses otomatis ("sistem", "midtrans").
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD.");
const querySchema = z.object({
  from: date.optional().or(z.literal("")),
  to: date.optional().or(z.literal("")),
  actor: z.string().trim().max(64).optional(),
  action: z.string().trim().max(60).regex(/^[a-z_.-]*$/, "Jenis aksi tidak valid.").optional(),
  q: z.string().trim().max(120).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Awal hari `date` (jam venue) sebagai waktu ISO UTC, sama dengan format `created_at`. */
export function localDayStart(day: string) {
  const guess = Date.parse(day + "T00:00:00Z");
  const local = localClock(new Date(guess));
  const offset = Date.parse(`${local.date}T${local.time}:00Z`) - guess;
  return new Date(guess - offset).toISOString();
}
const nextDay = (day: string) => { const value = new Date(day + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); };

/** Nama tampilan untuk tiap pelaku. */
async function actorNames(ids: string[]) {
  const names = new Map<string, { name: string; kind: "staff" | "customer" | "system" }>();
  names.set("sistem", { name: "Sistem", kind: "system" });
  names.set("midtrans", { name: "Midtrans", kind: "system" });
  names.set("seed", { name: "Data contoh", kind: "system" });
  for (const user of await getUsers()) names.set(user.id, { name: user.name, kind: "staff" });
  const unknown = ids.filter(id => !names.has(id));
  if (unknown.length) {
    const rows = await db.prepare(`SELECT id, name, email FROM customer_accounts WHERE id IN (${unknown.map(() => "?").join(",")})`).all(...unknown) as { id: string; name: string; email: string }[];
    for (const row of rows) names.set(row.id, { name: row.name || row.email, kind: "customer" });
  }
  return names;
}

export async function auditLog(input: unknown) {
  const query = querySchema.parse(input);
  const where: string[] = [], params: Param[] = [];
  if (query.from) { where.push("created_at>=?"); params.push(localDayStart(query.from)); }
  if (query.to) { where.push("created_at<?"); params.push(localDayStart(nextDay(query.to))); }
  if (query.actor) { where.push("actor_id=?"); params.push(query.actor); }
  // "booking" mencakup booking.create, booking.cancel, dan seterusnya.
  if (query.action) { where.push("(action=? OR action LIKE ?)"); params.push(query.action, query.action.replace(/[%_\\]/g, "\\$&") + ".%"); }
  if (query.q) { where.push("(LOWER(target_id) LIKE ? OR LOWER(detail) LIKE ?)"); const like = "%" + query.q.toLowerCase().replace(/[%_\\]/g, "\\$&") + "%"; params.push(like, like); }
  if (query.before) { where.push("id<?"); params.push(query.before); }
  const rows = await db.prepare(`SELECT id, actor_id, action, target_id, detail, created_at FROM audit_log
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`).all(...params, query.limit + 1) as
    { id: number; actor_id: string; action: string; target_id: string; detail: string | null; created_at: string }[];
  const more = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const names = await actorNames([...new Set(page.map(row => row.actor_id))]);
  const entries = page.map(row => {
    const actor = names.get(row.actor_id);
    return {
      id: row.id, action: row.action, target_id: row.target_id, created_at: row.created_at,
      actor_id: row.actor_id, actor_name: actor?.name ?? "Tidak dikenal", actor_kind: actor?.kind ?? "unknown",
      detail: row.detail ? JSON.parse(row.detail) as Record<string, unknown> : null,
    };
  });
  return { entries, next_before: more ? page[page.length - 1].id : null };
}

/** Pilihan saringan: semua staf dan jenis aksi yang pernah tercatat. */
export async function auditFilters() {
  const actions = (await db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]).map(row => row.action);
  const staff = (await getUsers()).map(user => ({ id: user.id, name: user.name }));
  return { actions, staff, today: localClock().date };
}
