import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, isDuplicate } from "./store.js";

/**
 * Kotak masuk di akun pelanggan. Setiap notifikasi yang dikirim lewat email atau WhatsApp juga
 * dicatat di sini untuk booking yang terhubung ke akun, jadi pelanggan tetap punya riwayat
 * tagihan, kwitansi, dan perubahan jadwal walau email-nya masuk spam atau WhatsApp belum diatur.
 */
export interface InboxItem {
  id: string; kind: string; title: string; body: string; link: string; tone: string; read: boolean; created_at: string;
}
/** Disimpan bersama `kind` sebagai "kind:tone" agar tidak perlu kolom tambahan. */
const split = (kind: string) => { const [event, tone = "info"] = kind.split(":"); return { event, tone }; };

/** Catat satu notifikasi. Aman di dalam transaksi; kunci yang sudah ada diabaikan. */
export async function notifyInbox(key: string, accountId: string, event: string, message: { title: string; body: string; link: string; tone: string }, refId: string | null) {
  try {
    await db.prepare("INSERT INTO customer_notifications (id,`key`,account_id,kind,title,body,link,ref_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), key, accountId, `${event}:${message.tone}`, message.title.slice(0, 255), message.body.slice(0, 2000), message.link.slice(0, 512), refId, new Date().toISOString());
    return true;
  } catch (error) {
    if (isDuplicate(error)) return false;
    throw error;
  }
}

export const unreadCount = async (accountId: string) =>
  Number((await db.prepare("SELECT count(*) n FROM customer_notifications WHERE account_id=? AND read_at IS NULL").get(accountId) as { n: number }).n);

export async function inbox(accountId: string, input: unknown) {
  const { limit, before } = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().max(32).optional(),
  }).parse(input ?? {});
  const rows = await db.prepare(`SELECT id,kind,title,body,link,read_at,created_at FROM customer_notifications
    WHERE account_id=? AND (? IS NULL OR created_at<?) ORDER BY created_at DESC,id LIMIT ?`).all(accountId, before ?? null, before ?? null, limit + 1) as
    { id: string; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string }[];
  const items: InboxItem[] = rows.slice(0, limit).map(row => {
    const { event, tone } = split(row.kind);
    return { id: row.id, kind: event, tone, title: row.title, body: row.body, link: row.link, read: !!row.read_at, created_at: row.created_at };
  });
  return { items, unread: await unreadCount(accountId), more: rows.length > limit };
}

/** Tandai sudah dibaca: beberapa id tertentu, atau semuanya bila `ids` tidak dikirim. */
export async function markRead(accountId: string, input: unknown) {
  const { ids } = z.object({ ids: z.array(z.string().max(64)).max(100).optional() }).parse(input ?? {});
  const stamp = new Date().toISOString();
  if (ids && !ids.length) return { unread: await unreadCount(accountId) };
  if (ids) await db.prepare(`UPDATE customer_notifications SET read_at=? WHERE account_id=? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).run(stamp, accountId, ...ids);
  else await db.prepare("UPDATE customer_notifications SET read_at=? WHERE account_id=? AND read_at IS NULL").run(stamp, accountId);
  return { unread: await unreadCount(accountId) };
}

/** Pilihan kanal di halaman profil pelanggan. */
export const preferenceSchema = z.object({ email: z.boolean(), whatsapp: z.boolean() });
export async function savePreferences(accountId: string, input: unknown) {
  const data = preferenceSchema.parse(input);
  await db.prepare("UPDATE customer_accounts SET notify_email=?,notify_whatsapp=? WHERE id=?").run(data.email ? 1 : 0, data.whatsapp ? 1 : 0, accountId);
  return data;
}
