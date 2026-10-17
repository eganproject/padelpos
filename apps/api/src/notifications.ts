import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { audit, db, isDuplicate, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { publicUrl } from "./config.js";
import { localClock } from "./clock.js";
import { getInfo } from "./content.js";

/**
 * Notifikasi email lewat SMTP (Gmail, Zoho, Mailgun, SendGrid, atau server email sendiri).
 *
 * Email tidak dikirim langsung saat booking berubah. Pesannya ditulis ke `email_outbox` di dalam
 * transaksi yang sama, lalu proses latar (`startMailer`) mengirimnya dan mengulang bila SMTP
 * sedang gagal. Dengan begitu booking tidak pernah gagal hanya karena server email lambat, dan
 * email tidak terkirim untuk perubahan yang akhirnya dibatalkan. Kolom `key` unik menjamin satu
 * peristiwa hanya menghasilkan satu email, walau webhook Midtrans datang berkali-kali.
 *
 * Seperti Midtrans, pengaturan SMTP dapat diisi dari panel admin atau dari environment; environment
 * selalu menang. Password SMTP tidak pernah dikirim kembali ke browser.
 */
export type EmailEvent = "confirmed" | "reschedule" | "cancelled" | "reminder" | "staff_new";
export interface EmailSettings {
  enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string;
  from_name: string; from_email: string; staff_recipients: string[]; reminder_hours: number;
  events: Record<EmailEvent, boolean>; updated_at: string | null;
}
const defaultEvents: Record<EmailEvent, boolean> = { confirmed: true, reschedule: true, cancelled: true, reminder: true, staff_new: true };
const defaults: EmailSettings = {
  enabled: false, host: "", port: 587, secure: false, user: "", password: "",
  from_name: "", from_email: "", staff_recipients: [], reminder_hours: 24, events: defaultEvents, updated_at: null,
};
async function stored(): Promise<EmailSettings> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key`='email'").get() as { document: string } | undefined;
  const value = row ? JSON.parse(row.document) as Partial<EmailSettings> : {};
  return { ...defaults, ...value, events: { ...defaultEvents, ...value.events } };
}
export async function emailConfig() {
  const settings = await stored();
  const env = (name: string) => process.env[name]?.trim() || "";
  const fromEnv = !!env("SMTP_HOST");
  return {
    ...settings,
    host: fromEnv ? env("SMTP_HOST") : settings.host,
    port: fromEnv ? Number(env("SMTP_PORT") || 587) : settings.port,
    secure: fromEnv ? env("SMTP_SECURE") === "true" : settings.secure,
    user: fromEnv ? env("SMTP_USER") : settings.user,
    password: fromEnv ? env("SMTP_PASS") : settings.password,
    from_email: (fromEnv && env("MAIL_FROM")) || settings.from_email || (fromEnv ? env("SMTP_USER") : settings.user),
    fromEnv,
  };
}
type EmailConfig = Awaited<ReturnType<typeof emailConfig>>;
export const emailReady = (config: EmailConfig) => config.enabled && !!config.host && !!config.from_email;

// --- Isi email ----------------------------------------------------------------

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const rupiah = (value: number) => "Rp" + value.toLocaleString("id-ID");
const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export function longDate(date: string) {
  const value = new Date(date + "T12:00:00Z");
  return `${days[value.getUTCDay()]}, ${value.getUTCDate()} ${months[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}
export interface Session { court_name: string; date: string; start_time: string; end_time: string; total?: number }
const sessionLine = (session: Session) => `${session.court_name} · ${longDate(session.date)} · ${session.start_time}–${session.end_time}`;
const venueName = async () => (await getInfo()).name || "Venue padel";

interface Message { subject: string; heading: string; intro: string; rows?: [label: string, value: string][]; sessions?: Session[]; link?: { label: string; url: string }; outro?: string }
/** Satu tata letak untuk semua email: teks biasa untuk klien sederhana, HTML untuk yang lain. */
async function render(message: Message) {
  const venue = await getInfo();
  const contact = [venue.whatsapp && `WhatsApp +${venue.whatsapp}`, venue.phone, venue.email].filter(Boolean).join(" · ");
  const text = [
    message.heading, "", message.intro, "",
    ...(message.sessions ?? []).map(session => "• " + sessionLine(session)),
    ...(message.rows ?? []).map(([label, value]) => `${label}: ${value}`),
    ...(message.link ? ["", `${message.link.label}: ${message.link.url}`] : []),
    ...(message.outro ? ["", message.outro] : []),
    "", `— ${await venueName()}`, ...(venue.address ? [venue.address] : []), ...(contact ? [contact] : []),
  ].join("\n");
  const rows = (message.rows ?? []).map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${escape(label)}</td><td style="padding:4px 0;font-weight:600">${escape(value)}</td></tr>`).join("");
  const sessions = (message.sessions ?? []).map(session => `<li style="margin:4px 0">${escape(sessionLine(session))}</li>`).join("");
  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#0f766e">${escape(await venueName())}</p>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${escape(message.heading)}</h1>
<p style="margin:0 0 16px;line-height:1.5">${escape(message.intro)}</p>
${sessions ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.5">${sessions}</ul>` : ""}
${rows ? `<table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">${rows}</table>` : ""}
${message.link ? `<p style="margin:0 0 16px"><a href="${escape(message.link.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">${escape(message.link.label)}</a></p>` : ""}
${message.outro ? `<p style="margin:0;line-height:1.5;color:#374151">${escape(message.outro)}</p>` : ""}
</div>
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#6b7280">${escape([venue.address, contact].filter(Boolean).join(" · "))}</p>
</div></body></html>`;
  return { subject: message.subject, text, html };
}

// --- Antrean ------------------------------------------------------------------

const emailSchema = z.email();
const validEmail = (value: string | null | undefined): value is string => !!value && emailSchema.safeParse(value).success;
/**
 * Masukkan email ke antrean. Aman dipanggil di dalam transaksi yang sedang berjalan.
 * Email dengan `key` yang sudah pernah dibuat diabaikan.
 */
async function enqueue(key: string, kind: string, recipient: string, message: Message, refId: string | null) {
  if (!validEmail(recipient)) return false;
  const { subject, text, html } = await render(message);
  try {
    await db.prepare(`INSERT INTO email_outbox (id,\`key\`,kind,recipient,subject,text,html,ref_id,next_attempt_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,UNIX_TIMESTAMP(),?)`).run(randomUUID(), key, kind, recipient.toLowerCase(), subject, text, html, refId, new Date().toISOString());
    return true;
  } catch (error) {
    // MySQL hanya membatalkan pernyataan yang gagal, transaksi pemanggil tetap berjalan.
    if (isDuplicate(error)) return false;
    throw error;
  }
}
/** Hanya peristiwa yang dinyalakan admin yang masuk antrean; pengaturan dibaca sekali per panggilan. */
async function wants(event: EmailEvent) {
  const config = await emailConfig();
  return emailReady(config) && config.events[event] ? config : null;
}
const staffTargets = (config: EmailConfig) => config.staff_recipients.filter(validEmail);

/** Email pelanggan untuk satu booking: isian staf, email pesanan online, lalu email akun Google. */
export async function customerEmail(bookingId: string) {
  const row = await db.prepare(`SELECT b.email booking_email,o.email order_email,a.email account_email FROM bookings b
    LEFT JOIN orders o ON o.id=b.order_id LEFT JOIN customer_accounts a ON a.id=b.account_id WHERE b.id=?`).get(bookingId) as
    { booking_email: string; order_email: string | null; account_email: string | null } | undefined;
  return [row?.booking_email, row?.order_email, row?.account_email].find(validEmail) ?? "";
}
const orderLink = (orderId: string | null) => orderId ? { label: "Lihat pesanan", url: `${publicUrl}/pesanan/${orderId}` } : undefined;

/** Pembayaran online diterima dan sesi terkonfirmasi. */
export async function notifyOrderPaid(input: { key: string; order_id: string | null; code: string; customer: string; email: string; amount: number; total: number; paid: number; sessions: Session[]; cancelled: boolean }) {
  const config = await wants("confirmed");
  const staff = await emailConfig();
  const remaining = Math.max(0, input.total - input.paid);
  if (config) await enqueue(`paid:${input.key}`, "confirmed", input.email, {
    subject: input.cancelled ? `Pembayaran pesanan ${input.code} perlu dikembalikan` : `Booking ${input.code} terkonfirmasi`,
    heading: input.cancelled ? "Pembayaran diterima, tetapi jadwalnya sudah terlepas" : "Pembayaran diterima, booking Anda terkonfirmasi",
    intro: input.cancelled
      ? `Halo ${input.customer}, pembayaran Anda masuk setelah batas waktu bayar sehingga slotnya sudah dilepas. Venue akan menghubungi Anda untuk pengembalian dana.`
      : `Halo ${input.customer}, terima kasih. Pembayaran Anda sudah kami terima dan jadwal berikut sudah dikunci untuk Anda.`,
    sessions: input.sessions,
    rows: [["Kode pesanan", input.code], ["Dibayar", rupiah(input.amount)], ...(remaining > 0 && !input.cancelled ? [["Sisa dibayar di venue", rupiah(remaining)] as [string, string]] : [])],
    link: orderLink(input.order_id),
    outro: input.cancelled ? undefined : "Mohon datang 10 menit sebelum jam main.",
  }, input.order_id);
  if (emailReady(staff) && staff.events.staff_new) for (const recipient of staffTargets(staff)) await enqueue(`staff-paid:${input.key}:${recipient}`, "staff_new", recipient, {
    subject: `Booking online baru: ${input.customer} (${input.code})`,
    heading: input.cancelled ? "Pembayaran masuk setelah slot dilepas" : "Booking online baru sudah dibayar",
    intro: input.cancelled ? `${input.customer} membayar setelah batas waktu. Booking ditutup sebagai batal dan dananya perlu dikembalikan.` : `${input.customer} memesan dan membayar lewat situs.`,
    sessions: input.sessions,
    rows: [["Kode pesanan", input.code], ["Dibayar", rupiah(input.amount)], ["Total", rupiah(input.total)]],
  }, input.order_id);
}

/** Booking dipindah ke jadwal lain, oleh staf atau oleh pelanggan sendiri. */
export async function notifyReschedule(input: { booking_id: string; count: number; code: string; customer: string; order_id: string | null; before: Session; after: Session; total: number; paid: number; by_customer: boolean }) {
  const config = await wants("reschedule");
  if (!config) return;
  const rows: [string, string][] = [["Jadwal lama", sessionLine(input.before)], ["Jadwal baru", sessionLine(input.after)], ["Total tagihan", rupiah(input.total)]];
  if (input.total > input.paid) rows.push(["Sisa tagihan", rupiah(input.total - input.paid)]);
  await enqueue(`reschedule:${input.booking_id}:${input.count}`, "reschedule", await customerEmail(input.booking_id), {
    subject: `Jadwal booking ${input.code} berubah`, heading: "Jadwal booking Anda sudah dipindah",
    intro: `Halo ${input.customer}, booking ${input.code} sekarang berada di jadwal baru di bawah ini.`,
    rows, link: orderLink(input.order_id),
    outro: input.total > input.paid ? "Sisa tagihan dapat dibayar di venue sebelum main." : undefined,
  }, input.booking_id);
  if (input.by_customer && config.events.staff_new) for (const recipient of staffTargets(config)) await enqueue(`staff-reschedule:${input.booking_id}:${input.count}:${recipient}`, "staff_new", recipient, {
    subject: `${input.customer} memindah jadwal booking ${input.code}`, heading: "Pelanggan memindah jadwal",
    intro: `${input.customer} memindah jadwal booking ${input.code} dari halaman akunnya.`, rows,
  }, input.booking_id);
}

/** Booking dibatalkan staf. */
export async function notifyCancelled(input: { booking_id: string; code: string; customer: string; order_id: string | null; session: Session; reason: string; paid: number }) {
  if (!await wants("cancelled")) return;
  await enqueue(`cancel:${input.booking_id}`, "cancelled", await customerEmail(input.booking_id), {
    subject: `Booking ${input.code} dibatalkan`, heading: "Booking Anda dibatalkan",
    intro: `Halo ${input.customer}, booking berikut sudah dibatalkan oleh venue.`,
    sessions: [input.session],
    rows: [["Alasan", input.reason], ...(input.paid > 0 ? [["Pembayaran diterima", rupiah(input.paid)] as [string, string]] : [])],
    outro: input.paid > 0 ? "Venue akan menghubungi Anda terkait pengembalian dana sesuai kebijakan pembatalan." : undefined,
  }, input.booking_id);
}

/**
 * Pengingat sebelum main untuk booking aktif yang dimulai dalam `reminder_hours` jam ke depan.
 * Dipanggil berkala oleh proses latar; kunci per booking dan jadwal mencegah pengingat ganda,
 * dan booking yang dipindah mendapat pengingat baru untuk jadwal barunya.
 */
export async function queueReminders(now = new Date()) {
  const config = await wants("reminder");
  if (!config || config.reminder_hours <= 0) return 0;
  const clock = localClock(now), later = localClock(new Date(now.getTime() + config.reminder_hours * 3600000));
  const rows = await db.prepare(`SELECT b.id,b.customer,b.date,b.start_time,b.end_time,b.total,b.order_id,c.name court_name,
      COALESCE((SELECT SUM(CASE kind WHEN 'payment' THEN amount ELSE -amount END) FROM payments WHERE booking_id=b.id),0) paid
    FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE b.status='confirmed' AND b.date BETWEEN ? AND ? AND CONCAT(b.date,' ',b.start_time) > ? AND CONCAT(b.date,' ',b.start_time) <= ?`)
    .all(clock.date, later.date, `${clock.date} ${clock.time}`, `${later.date} ${later.time}`) as
    { id: string; customer: string; date: string; start_time: string; end_time: string; total: number; order_id: string | null; court_name: string; paid: number }[];
  let queued = 0;
  for (const row of rows) {
    const code = row.id.slice(0, 8).toUpperCase();
    const rows: [string, string][] = [["Kode booking", code]];
    if (row.total > row.paid) rows.push(["Sisa tagihan", rupiah(row.total - row.paid)]);
    if (await enqueue(`reminder:${row.id}:${row.date}T${row.start_time}`, "reminder", await customerEmail(row.id), {
      subject: `Pengingat: main padel ${row.date === clock.date ? "hari ini" : longDate(row.date)} pukul ${row.start_time}`,
      heading: "Sampai jumpa di lapangan",
      intro: `Halo ${row.customer}, ini pengingat untuk jadwal main Anda.`,
      sessions: [row], rows, link: orderLink(row.order_id),
      outro: "Mohon datang 10 menit sebelum jam main.",
    }, row.id)) queued++;
  }
  return queued;
}

// --- Pengiriman ---------------------------------------------------------------

let cached: { signature: string; transport: Transporter } | null = null;
function transport(config: EmailConfig) {
  const signature = JSON.stringify([config.host, config.port, config.secure, config.user, config.password]);
  if (cached?.signature !== signature) {
    cached?.transport.close();
    cached = { signature, transport: nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    }) };
  }
  return cached.transport;
}
const fromHeader = async (config: EmailConfig) => ({ name: config.from_name || await venueName(), address: config.from_email });

/** Batas percobaan; jeda antarpercobaan 1, 4, 16, lalu 64 menit. */
const maxAttempts = 5;
let delivering = false;
/** Kirim email yang sudah jatuh tempo. Dipanggil berkala; satu putaran mengirim paling banyak `batch` email. */
export async function deliverDue(batch = 20) {
  if (delivering) return { sent: 0, failed: 0 };
  const config = await emailConfig();
  if (!emailReady(config)) return { sent: 0, failed: 0 };
  delivering = true;
  let sent = 0, failed = 0;
  try {
    const due = await db.prepare("SELECT id,recipient,subject,text,html,attempts FROM email_outbox WHERE status='pending' AND next_attempt_at<=UNIX_TIMESTAMP() ORDER BY next_attempt_at LIMIT ?").all(batch) as
      { id: string; recipient: string; subject: string; text: string; html: string; attempts: number }[];
    for (const mail of due) {
      // Klaim dulu agar proses API lain yang memakai database yang sama tidak mengirim email ini juga.
      const claimed = await db.prepare("UPDATE email_outbox SET next_attempt_at=UNIX_TIMESTAMP()+300 WHERE id=? AND status='pending' AND next_attempt_at<=UNIX_TIMESTAMP()").run(mail.id);
      if (!claimed.changes) continue;
      try {
        await transport(config).sendMail({ from: await fromHeader(config), to: mail.recipient, replyTo: (await getInfo()).email || undefined, subject: mail.subject, text: mail.text, html: mail.html });
        await db.prepare("UPDATE email_outbox SET status='sent',attempts=attempts+1,sent_at=?,last_error='' WHERE id=?").run(new Date().toISOString(), mail.id);
        sent++;
      } catch (error) {
        const attempts = mail.attempts + 1;
        await db.prepare("UPDATE email_outbox SET status=?,attempts=?,next_attempt_at=UNIX_TIMESTAMP()+?,last_error=? WHERE id=?")
          .run(attempts >= maxAttempts ? "failed" : "pending", attempts, 60 * 4 ** (attempts - 1), String((error as Error).message).slice(0, 300), mail.id);
        failed++;
      }
    }
  } finally {
    delivering = false;
  }
  return { sent, failed };
}

/** Proses latar: pengingat dan pengiriman setiap 30 detik. Tidak dijalankan saat tes. */
export function startMailer(intervalMs = 30000) {
  const tick = async () => {
    try { await queueReminders(); } catch (error) { console.error("Gagal menyiapkan pengingat email:", (error as Error).message); }
    await deliverDue().catch(error => console.error("Gagal mengirim email:", (error as Error).message));
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 5000).unref();
  return () => clearInterval(timer);
}

// --- Panel admin --------------------------------------------------------------

const recipientList = z.array(z.email("Ada email penerima staf yang tidak valid.")).max(5, "Maksimal 5 email penerima staf.");
export const emailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(200).default(""),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: z.string().trim().max(200).default(""),
  /** Kosong berarti password yang tersimpan dipertahankan. */
  password: z.string().max(200).default(""),
  clear_password: z.boolean().default(false),
  from_name: z.string().trim().max(80).default(""),
  from_email: z.union([z.email("Email pengirim tidak valid."), z.literal("")]).default(""),
  staff_recipients: recipientList.default([]),
  reminder_hours: z.number().int().min(0).max(72, "Pengingat paling awal 72 jam sebelum main.").default(24),
  events: z.object({ confirmed: z.boolean(), reschedule: z.boolean(), cancelled: z.boolean(), reminder: z.boolean(), staff_new: z.boolean() }).default(defaultEvents),
});
export async function saveEmailSettings(input: unknown, actor: string) {
  const data = emailSettingsSchema.parse(input);
  return await transaction(async () => {
    const current = await stored();
    const password = data.clear_password ? "" : (data.password || current.password);
    const next: EmailSettings = {
      enabled: data.enabled, host: data.host, port: data.port, secure: data.secure, user: data.user, password,
      from_name: data.from_name, from_email: data.from_email, staff_recipients: [...new Set(data.staff_recipients.map(value => value.toLowerCase()))],
      reminder_hours: data.reminder_hours, events: data.events, updated_at: new Date().toISOString(),
    };
    await saveSetting("email", next);
    const config = await emailConfig();
    check(!next.enabled || (config.host && config.from_email), 409, "Isi server SMTP dan email pengirim sebelum mengaktifkan notifikasi.");
    await audit(actor, "email.settings", "email");
    return await adminEmail();
  });
}
export async function adminEmail() {
  const config = await emailConfig();
  return {
    enabled: config.enabled, host: config.host, port: config.port, secure: config.secure, user: config.user,
    from_name: config.from_name, from_email: config.from_email, staff_recipients: config.staff_recipients,
    reminder_hours: config.reminder_hours, events: config.events, updated_at: config.updated_at,
    password_set: !!config.password, source: config.fromEnv ? "env" : "panel", ready: emailReady(config),
  };
}
/** Riwayat antrean untuk panel admin, tanpa isi email. */
export async function outbox(limit = 50) {
  const rows = await db.prepare("SELECT id,kind,recipient,subject,status,attempts,last_error,created_at,sent_at FROM email_outbox ORDER BY created_at DESC LIMIT ?").all(limit);
  const counts = await db.prepare("SELECT status,count(*) n FROM email_outbox GROUP BY status").all() as { status: string; n: number }[];
  return { items: rows, counts: Object.fromEntries(counts.map(row => [row.status, row.n])) as Record<string, number> };
}
/** Kirim ulang email yang gagal; langsung dicoba saat itu juga agar admin melihat hasilnya. */
export async function retryEmail(id: string, actor: string) {
  const result = await db.prepare("UPDATE email_outbox SET status='pending',attempts=0,next_attempt_at=UNIX_TIMESTAMP(),last_error='' WHERE id=? AND status='failed'").run(id);
  check(result.changes, 404, "Email gagal itu tidak ditemukan atau sudah dikirim ulang.");
  await audit(actor, "email.retry", id);
  await deliverDue();
}
/** Kirim satu email uji langsung (tanpa antrean) agar admin tahu pengaturannya benar saat itu juga. */
export async function sendTestEmail(input: unknown, actor: string) {
  const { to } = z.object({ to: z.email("Isi email tujuan yang valid.") }).parse(input);
  const config = await emailConfig();
  check(config.host && config.from_email, 409, "Isi server SMTP dan email pengirim terlebih dahulu.");
  const mail = await render({ subject: `Email uji dari ${await venueName()}`, heading: "Pengaturan email berhasil", intro: "Email ini dikirim dari panel admin untuk memastikan server SMTP dapat dipakai mengirim notifikasi booking." });
  try {
    await transport(config).sendMail({ from: await fromHeader(config), to, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (error) {
    check(false, 502, `Server SMTP menolak: ${(error as Error).message}`);
  }
  await audit(actor, "email.test", to);
  return { ok: true, message: `Email uji terkirim ke ${to}.` };
}
