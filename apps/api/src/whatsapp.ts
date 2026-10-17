import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, isDuplicate, readSetting, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { getInfo } from "./content.js";
import type { NotifyEvent } from "./notify-events.js";
import { defaultEvents, eventsSchema } from "./notify-events.js";

/**
 * Notifikasi WhatsApp lewat penyedia pihak ketiga. Polanya sama dengan email: pesan ditulis ke
 * `whatsapp_outbox` di dalam transaksi yang memicunya, lalu proses latar mengirimnya dan mengulang
 * bila penyedia sedang gagal.
 *
 * Penyedia yang didukung:
 * - `simulasi`: tidak menghubungi siapa pun. Pesan langsung ditandai terkirim sehingga admin bisa
 *   melihat isi setiap pesan di panel sebelum berlangganan penyedia sungguhan.
 * - `fonnte` (fonnte.com) dan `wablas` (wablas.com): penyedia lokal berbasis nomor WhatsApp biasa.
 * - `cloud`: WhatsApp Cloud API resmi dari Meta. Pesan teks bebas hanya sampai bila pelanggan
 *   mengirim pesan ke nomor bisnis dalam 24 jam terakhir; di luar itu Meta mewajibkan template.
 *
 * Token boleh diisi dari panel atau environment (WHATSAPP_PROVIDER, WHATSAPP_TOKEN,
 * WHATSAPP_BASE_URL, WHATSAPP_PHONE_NUMBER_ID); environment selalu menang. Token tidak pernah
 * dikirim kembali ke browser.
 */
export const providers = ["simulasi", "fonnte", "wablas", "cloud"] as const;
export type Provider = typeof providers[number];
export interface WhatsAppSettings {
  enabled: boolean; provider: Provider; token: string; base_url: string; phone_number_id: string;
  staff_numbers: string[]; reminder_hours: number; events: Record<NotifyEvent, boolean>; updated_at: string | null;
}
const defaults: WhatsAppSettings = {
  enabled: false, provider: "simulasi", token: "", base_url: "", phone_number_id: "",
  staff_numbers: [], reminder_hours: 24, events: defaultEvents, updated_at: null,
};
async function stored(): Promise<WhatsAppSettings> {
  const value = await readSetting<Partial<WhatsAppSettings>>("whatsapp") ?? {};
  return { ...defaults, ...value, events: { ...defaultEvents, ...value.events } };
}
export async function whatsappConfig() {
  const settings = await stored();
  const env = (name: string) => process.env[name]?.trim() || "";
  const envProvider = env("WHATSAPP_PROVIDER") as Provider;
  const fromEnv = providers.includes(envProvider);
  return {
    ...settings,
    provider: fromEnv ? envProvider : settings.provider,
    token: fromEnv ? env("WHATSAPP_TOKEN") : settings.token,
    base_url: (fromEnv ? env("WHATSAPP_BASE_URL") : settings.base_url).replace(/\/+$/, ""),
    phone_number_id: fromEnv ? env("WHATSAPP_PHONE_NUMBER_ID") : settings.phone_number_id,
    fromEnv,
  };
}
export type WhatsAppConfig = Awaited<ReturnType<typeof whatsappConfig>>;
/** Hal yang masih kurang agar penyedia dapat dipakai; kosong bila lengkap. */
function missing(config: Pick<WhatsAppConfig, "provider" | "token" | "base_url" | "phone_number_id">) {
  if (config.provider === "simulasi") return "";
  if (!config.token) return "Isi token API dari penyedia WhatsApp.";
  if (config.provider === "wablas" && !config.base_url) return "Isi alamat server Wablas, mis. https://jkt.wablas.com.";
  if (config.provider === "cloud" && !config.phone_number_id) return "Isi Phone number ID dari WhatsApp Manager.";
  return "";
}
export const whatsappReady = (config: WhatsAppConfig) => config.enabled && !missing(config);

/** 0812…, +62 812…, dan 62812… menjadi 62812…; nomor yang tidak masuk akal ditolak. */
export function waNumber(value: string | null | undefined) {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  const normalized = digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("62") ? digits : digits.startsWith("8") ? "62" + digits : digits;
  return /^628\d{7,12}$/.test(normalized) ? normalized : "";
}

// --- Antrean ------------------------------------------------------------------

/** Masukkan pesan ke antrean. Aman di dalam transaksi; kunci yang sudah ada diabaikan. */
export async function enqueueWhatsApp(key: string, kind: string, phone: string, text: string, refId: string | null) {
  const recipient = waNumber(phone);
  if (!recipient) return false;
  try {
    await db.prepare(`INSERT INTO whatsapp_outbox (id,\`key\`,kind,recipient,text,ref_id,next_attempt_at,created_at)
      VALUES (?,?,?,?,?,?,UNIX_TIMESTAMP(),?)`).run(randomUUID(), key, kind, recipient, text, refId, new Date().toISOString());
    return true;
  } catch (error) {
    if (isDuplicate(error)) return false;
    throw error;
  }
}
export const staffNumbers = (config: WhatsAppConfig) => config.staff_numbers.map(waNumber).filter(Boolean);

// --- Pengiriman ---------------------------------------------------------------

const timeout = () => AbortSignal.timeout(20000);
async function reply(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { raw: text.slice(0, 200) }; }
}
const reason = (body: Record<string, unknown>, status: number) =>
  String(body.reason ?? body.message ?? (body.error as { message?: string } | undefined)?.message ?? body.raw ?? `HTTP ${status}`).slice(0, 300);

/** Kirim satu pesan teks. Melempar galat bila penyedia menolak. */
export async function sendWhatsApp(config: WhatsAppConfig, to: string, text: string) {
  const target = waNumber(to);
  if (!target) throw new Error("Nomor WhatsApp tujuan tidak valid.");
  if (config.provider === "simulasi") return;
  if (config.provider === "fonnte") {
    const response = await fetch(config.base_url ? `${config.base_url}/send` : "https://api.fonnte.com/send", {
      method: "POST", headers: { Authorization: config.token }, body: new URLSearchParams({ target, message: text, countryCode: "62" }), signal: timeout(),
    });
    const body = await reply(response);
    if (!response.ok || body.status === false) throw new Error(reason(body, response.status));
    return;
  }
  if (config.provider === "wablas") {
    const response = await fetch(`${config.base_url}/api/send-message`, {
      method: "POST", headers: { Authorization: config.token, "Content-Type": "application/json" }, body: JSON.stringify({ phone: target, message: text }), signal: timeout(),
    });
    const body = await reply(response);
    if (!response.ok || body.status === false) throw new Error(reason(body, response.status));
    return;
  }
  const response = await fetch(`${config.base_url || "https://graph.facebook.com/v21.0"}/${encodeURIComponent(config.phone_number_id)}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: target, type: "text", text: { preview_url: true, body: text } }), signal: timeout(),
  });
  const body = await reply(response);
  if (!response.ok) throw new Error(reason(body, response.status));
}

/** Batas percobaan; jeda antarpercobaan 1, 4, 16, lalu 64 menit. Sama dengan email. */
const maxAttempts = 5;
let delivering = false;
export async function deliverDueWhatsApp(batch = 20) {
  if (delivering) return { sent: 0, failed: 0 };
  const config = await whatsappConfig();
  if (!whatsappReady(config)) return { sent: 0, failed: 0 };
  delivering = true;
  let sent = 0, failed = 0;
  try {
    const due = await db.prepare("SELECT id,recipient,text,attempts FROM whatsapp_outbox WHERE status='pending' AND next_attempt_at<=UNIX_TIMESTAMP() ORDER BY next_attempt_at LIMIT ?").all(batch) as
      { id: string; recipient: string; text: string; attempts: number }[];
    for (const message of due) {
      const claimed = await db.prepare("UPDATE whatsapp_outbox SET next_attempt_at=UNIX_TIMESTAMP()+300 WHERE id=? AND status='pending' AND next_attempt_at<=UNIX_TIMESTAMP()").run(message.id);
      if (!claimed.changes) continue;
      try {
        await sendWhatsApp(config, message.recipient, message.text);
        await db.prepare("UPDATE whatsapp_outbox SET status='sent',provider=?,attempts=attempts+1,sent_at=?,last_error='' WHERE id=?").run(config.provider, new Date().toISOString(), message.id);
        sent++;
      } catch (error) {
        const attempts = message.attempts + 1;
        await db.prepare("UPDATE whatsapp_outbox SET status=?,provider=?,attempts=?,next_attempt_at=UNIX_TIMESTAMP()+?,last_error=? WHERE id=?")
          .run(attempts >= maxAttempts ? "failed" : "pending", config.provider, attempts, 60 * 4 ** (attempts - 1), String((error as Error).message).slice(0, 300), message.id);
        failed++;
      }
    }
  } finally {
    delivering = false;
  }
  return { sent, failed };
}

// --- Panel admin --------------------------------------------------------------

export const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(providers).default("simulasi"),
  /** Kosong berarti token yang tersimpan dipertahankan. */
  token: z.string().trim().max(500).default(""),
  clear_token: z.boolean().default(false),
  base_url: z.string().trim().max(200).refine(value => !value || /^https?:\/\/[^\s]+$/.test(value), "Alamat server harus diawali https://.").default(""),
  phone_number_id: z.string().trim().max(40).regex(/^\d*$/, "Phone number ID hanya berisi angka.").default(""),
  staff_numbers: z.array(z.string().trim().max(24).refine(value => !!waNumber(value), "Ada nomor WhatsApp staf yang tidak valid.")).max(5, "Maksimal 5 nomor staf.").default([]),
  reminder_hours: z.number().int().min(0).max(72, "Pengingat paling awal 72 jam sebelum main.").default(24),
  events: eventsSchema,
});
export async function saveWhatsAppSettings(input: unknown, actor: string) {
  const data = whatsappSettingsSchema.parse(input);
  return await transaction(async () => {
    const current = await stored();
    const next: WhatsAppSettings = {
      enabled: data.enabled, provider: data.provider, token: data.clear_token ? "" : (data.token || current.token),
      base_url: data.base_url.replace(/\/+$/, ""), phone_number_id: data.phone_number_id,
      staff_numbers: [...new Set(data.staff_numbers.map(waNumber))], reminder_hours: data.reminder_hours,
      events: { ...defaultEvents, ...data.events }, updated_at: new Date().toISOString(),
    };
    await saveSetting("whatsapp", next);
    const config = await whatsappConfig();
    const problem = missing(config);
    check(!next.enabled || !problem, 409, problem || "Pengaturan WhatsApp belum lengkap.");
    await audit(actor, "whatsapp.settings", "whatsapp", { provider: next.provider, enabled: next.enabled });
    return await adminWhatsApp();
  });
}
export async function adminWhatsApp() {
  const config = await whatsappConfig();
  return {
    enabled: config.enabled, provider: config.provider, base_url: config.base_url, phone_number_id: config.phone_number_id,
    staff_numbers: config.staff_numbers, reminder_hours: config.reminder_hours, events: config.events, updated_at: config.updated_at,
    token_set: !!config.token, source: config.fromEnv ? "env" : "panel", ready: whatsappReady(config), problem: missing(config),
  };
}
/** Riwayat antrean. Isi pesan ikut dikirim agar admin bisa memeriksa kalimatnya, terutama saat simulasi. */
export async function whatsappOutbox(limit = 50) {
  const items = await db.prepare("SELECT id,kind,recipient,text,provider,status,attempts,last_error,created_at,sent_at FROM whatsapp_outbox ORDER BY created_at DESC LIMIT ?").all(limit);
  const counts = await db.prepare("SELECT status,count(*) n FROM whatsapp_outbox GROUP BY status").all() as { status: string; n: number }[];
  return { items, counts: Object.fromEntries(counts.map(row => [row.status, row.n])) as Record<string, number> };
}
export async function retryWhatsApp(id: string, actor: string) {
  const result = await db.prepare("UPDATE whatsapp_outbox SET status='pending',attempts=0,next_attempt_at=UNIX_TIMESTAMP(),last_error='' WHERE id=? AND status='failed'").run(id);
  check(result.changes, 404, "Pesan gagal itu tidak ditemukan atau sudah dikirim ulang.");
  await audit(actor, "whatsapp.retry", id);
  await deliverDueWhatsApp();
}
/** Pesan uji langsung (tanpa antrean) agar admin tahu token dan nomornya benar saat itu juga. */
export async function sendTestWhatsApp(input: unknown, actor: string) {
  const { to } = z.object({ to: z.string().trim().max(24).refine(value => !!waNumber(value), "Isi nomor WhatsApp tujuan yang valid, mis. 0812 3456 7890.") }).parse(input);
  const config = await whatsappConfig();
  const problem = missing(config);
  check(!problem, 409, problem);
  const venue = (await getInfo()).name || "Venue padel";
  try {
    await sendWhatsApp(config, to, `*Pesan uji dari ${venue}*\n\nPengaturan WhatsApp berhasil. Notifikasi booking akan dikirim lewat nomor ini.`);
  } catch (error) {
    check(false, 502, `Penyedia WhatsApp menolak: ${(error as Error).message}`);
  }
  await audit(actor, "whatsapp.test", waNumber(to));
  return {
    ok: true,
    message: config.provider === "simulasi"
      ? `Mode simulasi: pesan untuk ${waNumber(to)} tidak benar-benar dikirim. Pilih penyedia untuk mengirim sungguhan.`
      : `Pesan uji terkirim ke ${waNumber(to)}.`,
  };
}
