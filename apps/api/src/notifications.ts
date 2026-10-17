import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { audit, db, isDuplicate, readSetting, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { publicUrl } from "./config.js";
import { localClock } from "./clock.js";
import { getInfo } from "./content.js";
import { defaultEvents, eventsSchema, type NotifyEvent } from "./notify-events.js";
import { deliverDueWhatsApp, enqueueWhatsApp, staffNumbers, waNumber, whatsappConfig, whatsappReady } from "./whatsapp.js";
import { notifyInbox } from "./inbox.js";

export type { NotifyEvent } from "./notify-events.js";
/** Nama lama, dipertahankan untuk pemanggil yang sudah ada. */
export type EmailEvent = NotifyEvent;

/**
 * Notifikasi untuk pelanggan dan staf lewat tiga kanal:
 * - email lewat SMTP (Gmail, Zoho, Mailgun, SendGrid, atau server email sendiri),
 * - WhatsApp lewat penyedia pihak ketiga (lihat whatsapp.ts),
 * - kotak masuk di akun pelanggan (lihat inbox.ts), untuk booking yang terhubung ke akun.
 *
 * Pesan tidak dikirim langsung saat booking berubah. Setiap kanal menulis ke antreannya sendiri di
 * dalam transaksi yang sama, lalu proses latar (`startMailer`) mengirimnya dan mengulang bila
 * penyedia sedang gagal. Dengan begitu booking tidak pernah gagal hanya karena server email lambat,
 * dan pesan tidak terkirim untuk perubahan yang akhirnya dibatalkan. Kolom `key` unik menjamin satu
 * peristiwa hanya menghasilkan satu pesan per kanal, walau webhook Midtrans datang berkali-kali.
 *
 * Seperti Midtrans, pengaturan SMTP dapat diisi dari panel admin atau dari environment; environment
 * selalu menang. Password SMTP tidak pernah dikirim kembali ke browser.
 */
export interface EmailSettings {
  enabled: boolean; host: string; port: number; secure: boolean; user: string; password: string;
  from_name: string; from_email: string; staff_recipients: string[]; reminder_hours: number;
  events: Record<NotifyEvent, boolean>; updated_at: string | null;
}
const defaults: EmailSettings = {
  enabled: false, host: "", port: 587, secure: false, user: "", password: "",
  from_name: "", from_email: "", staff_recipients: [], reminder_hours: 24, events: defaultEvents, updated_at: null,
};
async function stored(): Promise<EmailSettings> {
  const value = await readSetting<Partial<EmailSettings>>("email") ?? {};
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

// --- Isi pesan ----------------------------------------------------------------

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export const rupiah = (value: number) => "Rp" + value.toLocaleString("id-ID");
const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export function longDate(date: string) {
  const value = new Date(date + "T12:00:00Z");
  return `${days[value.getUTCDay()]}, ${value.getUTCDate()} ${months[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}
/** Jam batas bayar dalam zona venue, mis. "Senin, 19 Oktober 2026 pukul 14:35". */
export function deadline(unixSeconds: number) {
  const clock = localClock(new Date(unixSeconds * 1000));
  return `${longDate(clock.date)} pukul ${clock.time}`;
}
export interface Session { court_name: string; date: string; start_time: string; end_time: string; total?: number }
const sessionLine = (session: Session) => `${session.court_name} · ${longDate(session.date)} · ${session.start_time}–${session.end_time}`;
const venueName = async () => (await getInfo()).name || "Venue padel";

type Tone = "info" | "success" | "warning" | "danger";
interface Message {
  subject: string; heading: string; intro: string; rows?: [label: string, value: string][]; sessions?: Session[];
  link?: { label: string; url: string }; outro?: string;
  /** Warna aksen email dan ikon di kotak masuk. */
  tone?: Tone;
  /** Judul pendek untuk kotak masuk dan baris pertama WhatsApp; bawaannya `subject`. */
  title?: string;
}
const toneColor: Record<Tone, string> = { info: "#0f766e", success: "#15803d", warning: "#b45309", danger: "#b91c1c" };

/** Satu tata letak untuk semua email: teks biasa untuk klien sederhana, HTML untuk yang lain. */
async function render(message: Message) {
  const venue = await getInfo();
  const contact = [venue.whatsapp && `WhatsApp +${venue.whatsapp}`, venue.phone, venue.email].filter(Boolean).join(" · ");
  const accent = toneColor[message.tone ?? "info"];
  const text = [
    message.heading, "", message.intro, "",
    ...(message.sessions ?? []).map(session => "• " + sessionLine(session)),
    ...(message.rows ?? []).map(([label, value]) => `${label}: ${value}`),
    ...(message.link ? ["", `${message.link.label}: ${message.link.url}`] : []),
    ...(message.outro ? ["", message.outro] : []),
    "", `— ${await venueName()}`, ...(venue.address ? [venue.address] : []), ...(contact ? [contact] : []),
  ].join("\n");
  const rows = (message.rows ?? []).map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top">${escape(label)}</td><td style="padding:6px 0;font-weight:600;text-align:right">${escape(value)}</td></tr>`).join("");
  const sessions = (message.sessions ?? []).map(session => `<tr><td style="padding:10px 12px;border-top:1px solid #e5e7eb"><b style="display:block">${escape(session.court_name)}</b><span style="color:#4b5563">${escape(longDate(session.date))} · ${escape(session.start_time)}–${escape(session.end_time)}</span></td></tr>`).join("");
  const html = `<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#111827">
<span style="display:none;max-height:0;overflow:hidden">${escape(message.intro)}</span>
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#0f766e">${escape(await venueName())}</p>
<div style="background:#ffffff;border:1px solid #e5e7eb;border-top:4px solid ${accent};border-radius:8px;padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escape(message.heading)}</h1>
<p style="margin:0 0 16px;line-height:1.5">${escape(message.intro)}</p>
${sessions ? `<table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-top:0;border-radius:6px;font-size:14px;margin:0 0 16px">${sessions}</table>` : ""}
${rows ? `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${rows}</table>` : ""}
${message.link ? `<p style="margin:0 0 16px"><a href="${escape(message.link.url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">${escape(message.link.label)}</a></p>` : ""}
${message.outro ? `<p style="margin:0;line-height:1.5;color:#374151">${escape(message.outro)}</p>` : ""}
</div>
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#6b7280">${escape([venue.address, contact].filter(Boolean).join(" · "))}</p>
</div></body></html>`;
  return { subject: message.subject, text, html };
}

/** Versi WhatsApp: teks pendek dengan *tebal* bawaan WhatsApp, tanpa HTML. */
async function renderWhatsApp(message: Message) {
  return [
    `*${message.heading}*`, "", message.intro,
    ...(message.sessions?.length ? ["", ...message.sessions.map(session => `• ${sessionLine(session)}`)] : []),
    ...(message.rows?.length ? ["", ...message.rows.map(([label, value]) => `${label}: *${value}*`)] : []),
    ...(message.link ? ["", `${message.link.label}:`, message.link.url] : []),
    ...(message.outro ? ["", message.outro] : []),
    "", `_${await venueName()}_`,
  ].join("\n");
}

/** Versi kotak masuk: satu paragraf ringkas dan tautan relatif ke situs ini. */
function renderInbox(message: Message) {
  const sessions = (message.sessions ?? []).map(sessionLine);
  const amount = message.rows?.find(([label]) => /^(Tagihan|Dibayar|Dikembalikan|Sisa)/.test(label));
  const body = [message.intro, ...sessions, ...(amount ? [`${amount[0]}: ${amount[1]}`] : [])].join("\n");
  const url = message.link?.url ?? "";
  const link = url.startsWith(publicUrl) ? url.slice(publicUrl.length) || "/" : url;
  return { title: message.title ?? message.heading, body, link };
}

// --- Antrean ------------------------------------------------------------------

const emailSchema = z.email();
const validEmail = (value: string | null | undefined): value is string => !!value && emailSchema.safeParse(value).success;
async function enqueueEmail(key: string, kind: string, recipient: string, message: Message, refId: string | null) {
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

export type Channel = "email" | "whatsapp" | "inbox";
/** Penerima satu pesan. Kanal yang alamatnya kosong dilewati. */
export interface Target { email?: string | null; phone?: string | null; account_id?: string | null }

/**
 * Kirim satu peristiwa ke semua kanal yang aktif untuknya. Aman dipanggil di dalam transaksi.
 * Pelanggan yang mematikan email atau WhatsApp di akunnya tidak dikirimi lewat kanal itu,
 * tetapi tetap menerima catatannya di kotak masuk akun.
 */
async function dispatch(key: string, event: NotifyEvent, target: Target, message: Message, refId: string | null, only?: Channel[]) {
  const use = (channel: Channel) => !only || only.includes(channel);
  const prefs = target.account_id
    ? await db.prepare("SELECT notify_email,notify_whatsapp FROM customer_accounts WHERE id=?").get(target.account_id) as { notify_email: number; notify_whatsapp: number } | undefined
    : undefined;
  let queued = 0;
  if (use("email") && target.email && prefs?.notify_email !== 0) {
    const config = await emailConfig();
    if (emailReady(config) && config.events[event] && await enqueueEmail(key, event, target.email, message, refId)) queued++;
  }
  if (use("whatsapp") && target.phone && prefs?.notify_whatsapp !== 0) {
    const config = await whatsappConfig();
    if (whatsappReady(config) && config.events[event] && await enqueueWhatsApp(key, event, target.phone, await renderWhatsApp(message), refId)) queued++;
  }
  if (use("inbox") && prefs && target.account_id && event !== "staff_new") {
    if (await notifyInbox(key, target.account_id, event, { ...renderInbox(message), tone: message.tone ?? "info" }, refId)) queued++;
  }
  return queued;
}

/** Pemberitahuan untuk staf lewat email dan WhatsApp staf yang terdaftar di panel. */
async function notifyStaff(key: string, message: Message, refId: string | null) {
  const email = await emailConfig();
  if (emailReady(email) && email.events.staff_new)
    for (const recipient of email.staff_recipients.filter(validEmail)) await enqueueEmail(`${key}:${recipient}`, "staff_new", recipient, message, refId);
  const wa = await whatsappConfig();
  if (whatsappReady(wa) && wa.events.staff_new) {
    const text = await renderWhatsApp(message);
    for (const number of staffNumbers(wa)) await enqueueWhatsApp(`${key}:${number}`, "staff_new", number, text, refId);
  }
}

/** Alamat pelanggan untuk satu booking: isian staf, data pesanan online, lalu akun Google. */
export async function contactOf(bookingId: string): Promise<Target> {
  const row = await db.prepare(`SELECT b.email booking_email,o.email order_email,a.email account_email,b.phone booking_phone,o.phone order_phone,a.phone account_phone,b.account_id
    FROM bookings b LEFT JOIN orders o ON o.id=b.order_id LEFT JOIN customer_accounts a ON a.id=b.account_id WHERE b.id=?`).get(bookingId) as
    { booking_email: string | null; order_email: string | null; account_email: string | null; booking_phone: string | null; order_phone: string | null; account_phone: string | null; account_id: string | null } | undefined;
  if (!row) return {};
  return {
    email: [row.booking_email, row.order_email, row.account_email].find(validEmail) ?? "",
    phone: [row.booking_phone, row.order_phone, row.account_phone].map(waNumber).find(Boolean) ?? "",
    account_id: row.account_id,
  };
}
/** Email pelanggan untuk satu booking (dipertahankan untuk pemanggil lama). */
export const customerEmail = async (bookingId: string) => (await contactOf(bookingId)).email ?? "";
const orderLink = (orderId: string | null, label = "Lihat pesanan") => orderId ? { label, url: `${publicUrl}/pesanan/${orderId}` } : undefined;

// --- Peristiwa ----------------------------------------------------------------

/** Tagihan baru: pesanan online menunggu dibayar, atau link pembayaran dari kasir. */
export async function notifyBill(input: {
  key: string; booking_id: string; order_id: string | null; code: string; customer: string; email?: string; amount: number; total: number;
  expires_at: number; sessions: Session[]; pay_url: string; from_staff: boolean;
}) {
  const target = await contactOf(input.booking_id);
  const rows: [string, string][] = [["Kode pesanan", input.code], ["Tagihan", rupiah(input.amount)]];
  if (input.total > input.amount) rows.push(["Total pesanan", rupiah(input.total)]);
  rows.push(["Bayar sebelum", deadline(input.expires_at)]);
  return await dispatch(`bill:${input.key}`, "bill", { ...target, email: input.email || target.email }, {
    subject: input.from_staff ? `Tagihan ${input.code}: ${rupiah(input.amount)}` : `Selesaikan pembayaran pesanan ${input.code}`,
    title: input.from_staff ? "Tagihan baru dari venue" : "Menunggu pembayaran",
    heading: input.from_staff ? "Ada tagihan untuk booking Anda" : "Satu langkah lagi: selesaikan pembayaran",
    intro: input.from_staff
      ? `Halo ${input.customer}, venue mengirim tagihan untuk booking berikut. Anda bisa membayar lewat QRIS, transfer bank, atau e-wallet.`
      : `Halo ${input.customer}, jadwal berikut kami tahan untuk Anda sampai batas waktu bayar. Setelah itu slotnya dilepas untuk pemesan lain.`,
    sessions: input.sessions, rows, tone: "warning",
    link: { label: "Bayar sekarang", url: input.pay_url },
    outro: "Abaikan pesan ini bila Anda sudah membayar.",
  }, input.order_id ?? input.booking_id);
}

/** Pengingat sebelum batas bayar habis untuk pesanan online yang belum dibayar. */
export async function queuePaymentDue(holdMinutes: number) {
  // Setengah waktu tahan, paling lama 15 menit sebelum habis; minimal 2 menit agar masih sempat bayar.
  const window = Math.min(15, holdMinutes / 2) * 60;
  const rows = await db.prepare(`SELECT o.id order_id,o.code,o.customer,o.email,MIN(b.id) booking_id,MIN(b.hold_expires_at) expires_at,i.amount
    FROM orders o JOIN bookings b ON b.order_id=o.id
    JOIN payment_intents i ON i.order_ref=o.id AND i.status='pending' AND i.kind='booking'
    WHERE b.status='pending' AND b.hold_expires_at-UNIX_TIMESTAMP() BETWEEN 120 AND ?
    GROUP BY o.id,o.code,o.customer,o.email,i.amount`).all(window) as
    { order_id: string; code: string; customer: string; email: string; booking_id: string; expires_at: number; amount: number }[];
  let queued = 0;
  for (const row of rows) {
    const target = await contactOf(row.booking_id);
    const left = Math.max(1, Math.round((Number(row.expires_at) - Date.now() / 1000) / 60));
    queued += await dispatch(`due:${row.order_id}`, "payment_due", { ...target, email: row.email || target.email }, {
      subject: `Sisa ${left} menit untuk membayar pesanan ${row.code}`,
      title: "Batas bayar hampir habis",
      heading: `Sisa sekitar ${left} menit untuk membayar`,
      intro: `Halo ${row.customer}, pesanan ${row.code} belum dibayar. Bila belum lunas sampai batas waktu, jadwalnya dilepas untuk pemesan lain.`,
      rows: [["Tagihan", rupiah(row.amount)], ["Bayar sebelum", deadline(Number(row.expires_at))]], tone: "warning",
      link: orderLink(row.order_id, "Bayar sekarang"),
    }, row.order_id);
  }
  return queued;
}

/** Waktu bayar habis dan slot dilepas. Satu pesan per pesanan. */
export async function notifyExpired(orderId: string) {
  const order = await db.prepare("SELECT id,code,customer,email FROM orders WHERE id=?").get(orderId) as { id: string; code: string; customer: string; email: string } | undefined;
  if (!order) return 0;
  const sessions = await db.prepare(`SELECT b.id,b.date,b.start_time,b.end_time,c.name court_name FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE b.order_id=? ORDER BY b.date,b.start_time`).all(orderId) as (Session & { id: string })[];
  if (!sessions.length) return 0;
  const target = await contactOf(sessions[0].id);
  return await dispatch(`expired:${orderId}`, "expired", { ...target, email: order.email || target.email }, {
    subject: `Waktu bayar pesanan ${order.code} habis`,
    title: "Waktu pembayaran habis",
    heading: "Waktu pembayaran sudah habis",
    intro: `Halo ${order.customer}, pesanan ${order.code} belum dibayar sampai batas waktu, jadi jadwal berikut sudah dilepas. Bila jamnya masih kosong, Anda bisa memesannya lagi.`,
    sessions, tone: "danger",
    link: { label: "Pesan lagi", url: `${publicUrl}/ketersediaan?tanggal=${sessions[0].date}` },
    outro: "Bila Anda sudah membayar tetapi menerima pesan ini, hubungi venue dengan menyebut kode pesanan.",
  }, orderId);
}

/** Pembayaran online diterima dan sesi terkonfirmasi. */
export async function notifyOrderPaid(input: { key: string; booking_id?: string; order_id: string | null; code: string; customer: string; email: string; amount: number; total: number; paid: number; sessions: Session[]; cancelled: boolean }) {
  const remaining = Math.max(0, input.total - input.paid);
  const target = input.booking_id ? await contactOf(input.booking_id) : {};
  await dispatch(`paid:${input.key}`, "confirmed", { ...target, email: input.email || target.email }, {
    subject: input.cancelled ? `Pembayaran pesanan ${input.code} perlu dikembalikan` : `Booking ${input.code} terkonfirmasi`,
    title: input.cancelled ? "Pembayaran perlu dikembalikan" : "Booking terkonfirmasi",
    heading: input.cancelled ? "Pembayaran diterima, tetapi jadwalnya sudah terlepas" : "Pembayaran diterima, booking Anda terkonfirmasi",
    intro: input.cancelled
      ? `Halo ${input.customer}, pembayaran Anda masuk setelah batas waktu bayar sehingga slotnya sudah dilepas. Venue akan menghubungi Anda untuk pengembalian dana.`
      : `Halo ${input.customer}, terima kasih. Pembayaran Anda sudah kami terima dan jadwal berikut sudah dikunci untuk Anda.`,
    sessions: input.sessions,
    rows: [["Kode pesanan", input.code], ["Dibayar", rupiah(input.amount)], ...(remaining > 0 && !input.cancelled ? [["Sisa dibayar di venue", rupiah(remaining)] as [string, string]] : [])],
    link: input.order_id ? { label: input.cancelled ? "Lihat pesanan" : "Lihat bukti booking", url: `${publicUrl}/pesanan/${input.order_id}` } : undefined,
    outro: input.cancelled ? undefined : "Tunjukkan kode pesanan saat datang. Mohon tiba 10 menit sebelum jam main.",
    tone: input.cancelled ? "danger" : "success",
  }, input.order_id);
  await notifyStaff(`staff-paid:${input.key}`, {
    subject: `Booking online baru: ${input.customer} (${input.code})`,
    heading: input.cancelled ? "Pembayaran masuk setelah slot dilepas" : "Booking online baru sudah dibayar",
    intro: input.cancelled ? `${input.customer} membayar setelah batas waktu. Booking ditutup sebagai batal dan dananya perlu dikembalikan.` : `${input.customer} memesan dan membayar lewat situs.`,
    sessions: input.sessions,
    rows: [["Kode pesanan", input.code], ["Dibayar", rupiah(input.amount)], ["Total", rupiah(input.total)]],
  }, input.order_id);
}

/** Kasir mencatat pembayaran atau pengembalian dana: pelanggan menerima kwitansinya. */
export async function notifyReceipt(input: {
  payment_id: string; booking_id: string; kind: "payment" | "refund"; amount: number; method: string;
  code: string; customer: string; order_id: string | null; session: Session; total: number; paid: number;
}) {
  const refund = input.kind === "refund";
  const remaining = Math.max(0, input.total - input.paid);
  const methodName: Record<string, string> = { cash: "Tunai", transfer: "Transfer", qris: "QRIS", va: "Virtual account", ewallet: "E-wallet", card: "Kartu" };
  const rows: [string, string][] = [
    ["Kode booking", input.code], [refund ? "Dikembalikan" : "Dibayar", rupiah(input.amount)], ["Metode", methodName[input.method] ?? input.method],
  ];
  if (!refund) rows.push(remaining > 0 ? ["Sisa tagihan", rupiah(remaining)] : ["Status", "Lunas"]);
  return await dispatch(`receipt:${input.payment_id}`, "receipt", await contactOf(input.booking_id), {
    subject: refund ? `Pengembalian dana ${rupiah(input.amount)} untuk booking ${input.code}` : `Kwitansi pembayaran ${rupiah(input.amount)} untuk booking ${input.code}`,
    title: refund ? "Dana dikembalikan" : remaining > 0 ? "Pembayaran diterima" : "Booking lunas",
    heading: refund ? "Dana Anda sudah dikembalikan" : remaining > 0 ? "Pembayaran Anda sudah kami terima" : "Terima kasih, booking Anda sudah lunas",
    intro: refund
      ? `Halo ${input.customer}, venue sudah mencatat pengembalian dana untuk booking berikut.`
      : `Halo ${input.customer}, berikut bukti pembayaran untuk booking Anda.`,
    sessions: [input.session], rows,
    link: orderLink(input.order_id, refund ? "Lihat pesanan" : "Lihat kwitansi"),
    tone: refund ? "info" : "success",
  }, input.booking_id);
}

/** Booking dipindah ke jadwal lain, oleh staf atau oleh pelanggan sendiri. */
export async function notifyReschedule(input: { booking_id: string; count: number; code: string; customer: string; order_id: string | null; before: Session; after: Session; total: number; paid: number; by_customer: boolean }) {
  const rows: [string, string][] = [["Jadwal lama", sessionLine(input.before)], ["Jadwal baru", sessionLine(input.after)], ["Total tagihan", rupiah(input.total)]];
  if (input.total > input.paid) rows.push(["Sisa tagihan", rupiah(input.total - input.paid)]);
  await dispatch(`reschedule:${input.booking_id}:${input.count}`, "reschedule", await contactOf(input.booking_id), {
    subject: `Jadwal booking ${input.code} berubah`, title: "Jadwal dipindah", heading: "Jadwal booking Anda sudah dipindah",
    intro: `Halo ${input.customer}, booking ${input.code} sekarang berada di jadwal baru: ${sessionLine(input.after)}.`,
    rows, link: orderLink(input.order_id),
    outro: input.total > input.paid ? "Sisa tagihan dapat dibayar di venue sebelum main." : undefined,
  }, input.booking_id);
  if (input.by_customer) await notifyStaff(`staff-reschedule:${input.booking_id}:${input.count}`, {
    subject: `${input.customer} memindah jadwal booking ${input.code}`, heading: "Pelanggan memindah jadwal",
    intro: `${input.customer} memindah jadwal booking ${input.code} dari halaman akunnya.`, rows,
  }, input.booking_id);
}

/** Booking dibatalkan staf. */
export async function notifyCancelled(input: { booking_id: string; code: string; customer: string; order_id: string | null; session: Session; reason: string; paid: number }) {
  await dispatch(`cancel:${input.booking_id}`, "cancelled", await contactOf(input.booking_id), {
    subject: `Booking ${input.code} dibatalkan`, title: "Booking dibatalkan", heading: "Booking Anda dibatalkan",
    intro: `Halo ${input.customer}, booking berikut sudah dibatalkan oleh venue.`,
    sessions: [input.session],
    rows: [["Alasan", input.reason], ...(input.paid > 0 ? [["Pembayaran diterima", rupiah(input.paid)] as [string, string]] : [])],
    outro: input.paid > 0 ? "Venue akan menghubungi Anda terkait pengembalian dana sesuai kebijakan pembatalan." : undefined,
    link: orderLink(input.order_id), tone: "danger",
  }, input.booking_id);
}

/** Kotak masuk akun selalu mengingatkan sehari sebelumnya, walau email dan WhatsApp mati. */
const inboxReminderHours = 24;
/**
 * Pengingat sebelum main untuk booking aktif. Setiap kanal punya jendelanya sendiri (jam sebelum
 * main); kunci per booking dan jadwal mencegah pengingat ganda, dan booking yang dipindah mendapat
 * pengingat baru untuk jadwal barunya. Mengembalikan jumlah pesan yang masuk antrean.
 */
export async function queueReminders(now = new Date()) {
  const email = await emailConfig(), wa = await whatsappConfig();
  const windows: [Channel, number][] = [
    ["email", emailReady(email) && email.events.reminder ? email.reminder_hours : 0],
    ["whatsapp", whatsappReady(wa) && wa.events.reminder ? wa.reminder_hours : 0],
    ["inbox", inboxReminderHours],
  ];
  const widest = Math.max(...windows.map(([, hours]) => hours));
  const clock = localClock(now), later = localClock(new Date(now.getTime() + widest * 3600000));
  const rows = await db.prepare(`SELECT b.id,b.customer,b.date,b.start_time,b.end_time,b.total,b.order_id,c.name court_name,
      COALESCE((SELECT SUM(CASE kind WHEN 'payment' THEN amount ELSE -amount END) FROM payments WHERE booking_id=b.id),0) paid
    FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE b.status='confirmed' AND b.date BETWEEN ? AND ? AND CONCAT(b.date,' ',b.start_time) > ? AND CONCAT(b.date,' ',b.start_time) <= ?`)
    .all(clock.date, later.date, `${clock.date} ${clock.time}`, `${later.date} ${later.time}`) as
    { id: string; customer: string; date: string; start_time: string; end_time: string; total: number; order_id: string | null; court_name: string; paid: number }[];
  let queued = 0;
  for (const row of rows) {
    // Selisih menit dari sekarang ke jam main, dihitung di zona venue lewat tanggal dan jamnya.
    const startsIn = (Date.parse(`${row.date}T${row.start_time}:00Z`) - Date.parse(`${clock.date}T${clock.time}:00Z`)) / 3600000;
    const only = windows.filter(([, hours]) => hours > 0 && startsIn <= hours).map(([channel]) => channel);
    if (!only.length) continue;
    const code = row.id.slice(0, 8).toUpperCase();
    const details: [string, string][] = [["Kode booking", code]];
    if (row.total > row.paid) details.push(["Sisa tagihan", rupiah(row.total - row.paid)]);
    const when = row.date === clock.date ? "hari ini" : longDate(row.date);
    queued += await dispatch(`reminder:${row.id}:${row.date}T${row.start_time}`, "reminder", await contactOf(row.id), {
      subject: `Pengingat: main padel ${when} pukul ${row.start_time}`,
      title: `Main ${when} pukul ${row.start_time}`,
      heading: "Sampai jumpa di lapangan",
      intro: `Halo ${row.customer}, ini pengingat untuk jadwal main Anda.`,
      sessions: [row], rows: details, link: orderLink(row.order_id),
      outro: "Mohon datang 10 menit sebelum jam main.",
    }, row.id, only);
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

/**
 * Proses latar setiap 30 detik: menyiapkan pengingat main dan pengingat bayar, lalu mengirim
 * antrean email dan WhatsApp. Tidak dijalankan saat tes. `holdMinutes` dibaca dari pengaturan
 * pembayaran lewat parameter agar modul ini tidak bergantung pada midtrans.ts.
 */
export function startMailer(holdMinutes: () => Promise<number>, intervalMs = 30000) {
  const tick = async () => {
    try { await queueReminders(); } catch (error) { console.error("Gagal menyiapkan pengingat:", (error as Error).message); }
    try { await queuePaymentDue(await holdMinutes()); } catch (error) { console.error("Gagal menyiapkan pengingat bayar:", (error as Error).message); }
    await deliverDue().catch(error => console.error("Gagal mengirim email:", (error as Error).message));
    await deliverDueWhatsApp().catch(error => console.error("Gagal mengirim WhatsApp:", (error as Error).message));
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
  events: eventsSchema,
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
