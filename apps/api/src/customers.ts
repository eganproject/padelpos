import { createPublicKey, randomUUID, verify, type JsonWebKey as NodeJwk, type KeyObject } from "node:crypto";
import { z } from "zod";
import { audit, db, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { localClock } from "./clock.js";
import { publicUrl } from "./config.js";
import { bookingAddons } from "./addons.js";
import { customerMaxReschedules, getBooking, rescheduleBooking, type Booking } from "./operations.js";
import { getPolicies } from "./content.js";
import { bookingCode, expireHolds, normalizePhone } from "./payments.js";

/**
 * Akun pelanggan dengan login Google lewat Firebase Authentication.
 *
 * Browser masuk ke Google memakai Firebase, lalu mengirim ID token-nya ke sini. Token itu
 * diverifikasi dengan kunci publik Google — cukup project ID, tanpa service account —
 * dan setelah itu pelanggan memegang sesi aplikasi sendiri (cookie), bukan sesi Firebase.
 *
 * Konfigurasi web Firebase (apiKey, authDomain, projectId, appId) memang dirancang publik
 * oleh Google, jadi aman disimpan di database dan dikirim ke browser.
 */

// --- Pengaturan -------------------------------------------------------------

export interface LoginSettings {
  enabled: boolean; api_key: string; auth_domain: string; project_id: string; app_id: string; updated_at: string | null;
}
const defaults: LoginSettings = { enabled: false, api_key: "", auth_domain: "", project_id: "", app_id: "", updated_at: null };

export async function loginSettings(): Promise<LoginSettings> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key`='customer_login'").get() as { document: string } | undefined;
  return { ...defaults, ...(row ? JSON.parse(row.document) as Partial<LoginSettings> : {}) };
}
const complete = (settings: LoginSettings) => !!(settings.api_key && settings.auth_domain && settings.project_id && settings.app_id);
export const loginReady = async () => { const settings = await loginSettings(); return settings.enabled && complete(settings); };

export const loginSettingsSchema = z.object({
  enabled: z.boolean(),
  api_key: z.string().trim().max(80).regex(/^(AIza[0-9A-Za-z_-]{35})?$/, "API key Firebase diawali AIza dan panjangnya 39 karakter."),
  auth_domain: z.string().trim().toLowerCase().max(120).regex(/^([a-z0-9-]+\.)+[a-z]{2,}$|^$/, "Auth domain berupa nama domain, mis. nama-proyek.firebaseapp.com."),
  project_id: z.string().trim().max(40).regex(/^([a-z0-9-]{4,40})?$/, "Project ID hanya huruf kecil, angka, dan tanda hubung."),
  app_id: z.string().trim().max(80).regex(/^(\d+:\d+:web:[0-9a-f]+)?$/, "App ID berbentuk 1:1234567890:web:abc123."),
});
export async function saveLoginSettings(input: unknown, actor: string) {
  const data = loginSettingsSchema.parse(input);
  check(!data.enabled || complete({ ...defaults, ...data }), 409, "Lengkapi keempat isian konfigurasi Firebase sebelum mengaktifkan login pelanggan.");
  const next: LoginSettings = { ...data, updated_at: new Date().toISOString() };
  await transaction(async () => {
    await saveSetting("customer_login", next);
    await audit(actor, "customer_login.settings", "customer_login");
  });
  return await adminLogin();
}

/** Domain situs yang harus terdaftar di Firebase → Authentication → Settings → Authorized domains. */
const siteDomain = () => { try { return new URL(publicUrl).hostname; } catch { return "localhost"; } };
export async function adminLogin() {
  const settings = await loginSettings();
  return { ...settings, complete: complete(settings), ready: await loginReady(), site_domain: siteDomain() };
}
/** Yang dikirim ke browser pelanggan. */
export async function publicLogin() {
  const settings = await loginSettings();
  if (!await loginReady()) return { enabled: false as const, firebase: null };
  return { enabled: true as const, firebase: { apiKey: settings.api_key, authDomain: settings.auth_domain, projectId: settings.project_id, appId: settings.app_id } };
}

type Check = { key: string; ok: boolean | null; label: string; detail: string };
/**
 * Uji konfigurasi langsung ke Google memakai API key: apakah kuncinya diterima, project-nya
 * cocok, domain situs sudah diizinkan, dan login Google sudah dinyalakan. Setiap poin punya
 * arahan perbaikan sendiri supaya admin tahu persis apa yang harus diklik di Firebase.
 */
export async function testLogin(): Promise<{ ok: boolean; checks: Check[] }> {
  const settings = await loginSettings();
  check(settings.api_key && settings.project_id, 409, "Simpan API key dan project ID terlebih dahulu.");
  let response: Response;
  try {
    response = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(settings.api_key)}`, {
      // API key yang dibatasi per situs hanya menerima permintaan dengan Referer situs itu.
      headers: { Referer: `${publicUrl}/` }, signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    check(false, 502, `Tidak dapat menghubungi Google: ${(error as Error).message}`);
  }
  const body = await response!.json().catch(() => ({})) as {
    projectId?: string; authorizedDomains?: string[]; idpConfig?: { provider?: string; enabled?: boolean }[];
    error?: { message?: string; details?: { reason?: string }[] };
  };
  if (!response!.ok) {
    const reason = body.error?.details?.find(item => item.reason)?.reason ?? "";
    const detail = reason === "API_KEY_INVALID" ? "Google tidak mengenali API key ini. Salin ulang dari Project settings → General → Your apps."
      : reason.includes("REFERRER") ? `API key dibatasi per situs dan ${siteDomain()} belum diizinkan. Tambahkan di Google Cloud Console → Credentials.`
      : reason === "SERVICE_DISABLED" ? "Identity Toolkit API belum aktif. Buka Authentication di Firebase Console sekali untuk mengaktifkannya."
      : body.error?.message ?? `Google menjawab kode ${response!.status}.`;
    return { ok: false, checks: [{ key: "key", ok: false, label: "API key", detail }] };
  }
  const domain = siteDomain();
  const domains = body.authorizedDomains ?? [];
  const google = body.idpConfig?.find(item => item.provider?.toUpperCase() === "GOOGLE");
  const checks: Check[] = [
    { key: "key", ok: true, label: "API key", detail: "Diterima Google." },
    body.projectId === settings.project_id
      ? { key: "project", ok: true, label: "Project ID", detail: `Cocok dengan proyek ${body.projectId}.` }
      : { key: "project", ok: false, label: "Project ID", detail: `API key ini milik proyek ${body.projectId ?? "lain"}, bukan ${settings.project_id}. Tempel ulang konfigurasi dari proyek yang sama.` },
    domains.includes(domain)
      ? { key: "domain", ok: true, label: "Domain situs", detail: `${domain} sudah diizinkan.` }
      : { key: "domain", ok: false, label: "Domain situs", detail: `Tambahkan ${domain} di Authentication → Settings → Authorized domains. Tanpa ini, jendela login Google akan ditolak.` },
    google
      ? google.enabled
        ? { key: "google", ok: true, label: "Login Google", detail: "Penyedia Google sudah aktif." }
        : { key: "google", ok: false, label: "Login Google", detail: "Aktifkan di Authentication → Sign-in method → Google." }
      : { key: "google", ok: null, label: "Login Google", detail: "Tidak dapat dipastikan dari sini. Pastikan Authentication → Sign-in method → Google berstatus Enabled." },
  ];
  return { ok: checks.every(item => item.ok !== false), checks };
}

// --- Verifikasi ID token Firebase -------------------------------------------

/**
 * Kunci publik yang menandatangani ID token Firebase. Disimpan selama masa berlaku yang
 * diumumkan Google (Cache-Control max-age), dan diambil ulang sekali bila token memakai
 * kunci yang belum dikenal — Google memutar kuncinya berkala.
 */
const keySetUrl = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let keySet: { keys: Map<string, KeyObject>; until: number; fetchedAt: number } | null = null;
async function signingKey(kid: string) {
  const fresh = keySet && keySet.until > Date.now();
  if (fresh && keySet!.keys.has(kid)) return keySet!.keys.get(kid)!;
  // Kunci tak dikenal pada daftar yang masih segar: ambil ulang, tetapi paling sering sekali semenit.
  if (fresh && Date.now() - keySet!.fetchedAt < 60_000) return undefined;
  let response: Response;
  try { response = await fetch(keySetUrl, { signal: AbortSignal.timeout(10000) }); }
  catch { check(false, 503, "Tidak dapat menghubungi Google untuk memeriksa login. Coba lagi sebentar lagi."); }
  check(response!.ok, 503, "Google sedang tidak dapat dihubungi. Coba lagi sebentar lagi.");
  const body = await response!.json() as { keys?: (NodeJwk & { kid?: string })[] };
  const maxAge = Number(/max-age=(\d+)/.exec(response!.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) if (jwk.kid) keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
  keySet = { keys, until: Date.now() + maxAge * 1000, fetchedAt: Date.now() };
  return keys.get(kid);
}

export interface GoogleIdentity { uid: string; email: string; name: string; picture: string }
const segment = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
const refuse = () => check(false, 401, "Login Google tidak dapat diverifikasi. Silakan coba masuk lagi.");

/** Aturan verifikasi mengikuti dokumentasi Firebase "Verify ID tokens using a third-party JWT library". */
export async function verifyIdToken(token: string, projectId: string): Promise<GoogleIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) refuse();
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try { header = segment(parts[0]); payload = segment(parts[1]); } catch { return refuse() as never; }
  // alg dikunci ke RS256: token "alg: none" atau HS256 tidak boleh lolos.
  if (header.alg !== "RS256" || typeof header.kid !== "string") refuse();
  const key = await signingKey(header.kid as string);
  if (!key) refuse();
  const valid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key!, Buffer.from(parts[2], "base64url"));
  if (!valid) refuse();

  const now = Math.floor(Date.now() / 1000), skew = 300;
  const firebase = payload.firebase as { sign_in_provider?: string } | undefined;
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) refuse();
  if (typeof payload.exp !== "number" || payload.exp <= now - skew) refuse();
  if (typeof payload.iat !== "number" || payload.iat > now + skew) refuse();
  if (typeof payload.auth_time !== "number" || payload.auth_time > now + skew) refuse();
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128) refuse();
  // Hanya akun Google yang diterima; token anonim atau email/password dari proyek yang sama ditolak.
  check(firebase?.sign_in_provider === "google.com", 403, "Silakan masuk memakai akun Google.");
  return {
    uid: payload.sub as string,
    email: typeof payload.email === "string" && payload.email_verified === true ? payload.email : "",
    name: typeof payload.name === "string" ? payload.name.slice(0, 80) : "",
    picture: typeof payload.picture === "string" && payload.picture.startsWith("https://") ? payload.picture.slice(0, 500) : "",
  };
}

// --- Akun -------------------------------------------------------------------

export interface Account {
  id: string; firebase_uid: string; email: string; name: string; phone: string | null;
  photo_url: string; created_at: string; last_login_at: string; notify_email?: number; notify_whatsapp?: number;
}
const findAccount = async (id: string) => await db.prepare("SELECT * FROM customer_accounts WHERE id=?").get(id) as Account | undefined;
export async function getAccount(id: string) {
  const account = await findAccount(id);
  check(account, 401, "Sesi akun berakhir. Silakan masuk kembali.");
  return account;
}
/** 628123456789 → 0812-3456-789 untuk ditampilkan. */
export const displayPhone = (phone: string | null) => {
  if (!phone) return "";
  const local = phone.startsWith("62") ? "0" + phone.slice(2) : phone;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
};
export const publicAccount = (account: Account) => ({
  id: account.id, email: account.email, name: account.name, phone: displayPhone(account.phone),
  photo_url: account.photo_url, created_at: account.created_at, needs_profile: !account.phone,
  notify: { email: account.notify_email !== 0, whatsapp: account.notify_whatsapp !== 0 },
});

export async function signIn(idToken: unknown) {
  const settings = await loginSettings();
  check(await loginReady(), 409, "Login pelanggan belum diaktifkan oleh venue.");
  check(typeof idToken === "string" && idToken.length > 20 && idToken.length < 4096, 400, "Token login tidak valid.");
  const identity = await verifyIdToken(idToken as string, settings.project_id);
  return await transaction(async () => {
    const stamp = new Date().toISOString();
    const existing = await db.prepare("SELECT * FROM customer_accounts WHERE firebase_uid=?").get(identity.uid) as Account | undefined;
    if (existing) {
      // Foto dan email mengikuti Google; nama dibiarkan karena pelanggan mungkin sudah mengubahnya.
      await db.prepare("UPDATE customer_accounts SET email=COALESCE(NULLIF(?,''),email),photo_url=?,last_login_at=? WHERE id=?")
        .run(identity.email, identity.picture, stamp, existing.id);
      return { account: (await findAccount(existing.id))!, created: false };
    }
    const id = randomUUID();
    await db.prepare("INSERT INTO customer_accounts (id,firebase_uid,email,name,phone,photo_url,created_at,last_login_at) VALUES (?,?,?,?,NULL,?,?,?)")
      .run(id, identity.uid, identity.email, identity.name || identity.email.split("@")[0] || "Pelanggan", identity.picture, stamp, stamp);
    await audit(id, "customer.signup", id);
    return { account: (await findAccount(id))!, created: true };
  });
}

/** Nomor HP Indonesia: 08…, 628…, atau +628…, 10–15 digit setelah dirapikan. */
export const phoneSchema = z.string().trim().max(20).transform(normalizePhone)
  .refine(value => /^628\d{7,12}$/.test(value), "Masukkan nomor HP Indonesia yang aktif, mis. 0812 3456 7890.");
export const profileSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter.").max(80, "Nama maksimal 80 karakter."),
  phone: phoneSchema,
});
export async function updateProfile(accountId: string, input: unknown) {
  const data = profileSchema.parse(input);
  await transaction(async () => {
    await getAccount(accountId);
    await db.prepare("UPDATE customer_accounts SET name=?,phone=? WHERE id=?").run(data.name, data.phone, accountId);
    await audit(accountId, "customer.profile", accountId);
  });
  return publicAccount((await findAccount(accountId))!);
}

/**
 * Menghapus akun tidak menghapus booking: jadwal dan pembayarannya tetap milik venue.
 * Yang hilang hanya kaitannya ke akun ini dan data login Google-nya.
 */
export async function deleteAccount(accountId: string) {
  return await transaction(async () => {
    await getAccount(accountId);
    await db.prepare("UPDATE bookings SET account_id=NULL WHERE account_id=?").run(accountId);
    // Keanggotaan tetap ada dan bisa dihubungkan lagi dengan kode member; hanya tautan ke akunnya yang lepas.
    await db.prepare("UPDATE memberships SET account_id=NULL WHERE account_id=?").run(accountId);
    await db.prepare("DELETE FROM sessions WHERE subject_id=? AND subject_type='customer'").run(accountId);
    await db.prepare("DELETE FROM customer_accounts WHERE id=?").run(accountId);
    await audit(accountId, "customer.delete", accountId);
  });
}

// --- Riwayat dan ringkasan --------------------------------------------------

export type Phase = "upcoming" | "past" | "cancelled";
function phaseOf(booking: Booking, now: { date: string; time: string }): Phase {
  if (booking.status === "cancelled" || booking.status === "expired") return "cancelled";
  if (booking.status === "completed") return "past";
  return booking.date > now.date || (booking.date === now.date && booking.end_time > now.time) ? "upcoming" : "past";
}
const orderOf = async (bookingId: string) =>
  await db.prepare("SELECT o.id,o.code FROM bookings b JOIN orders o ON o.id=b.order_id WHERE b.id=?").get(bookingId) as { id: string; code: string } | undefined;
const pendingIntent = async (orderId: string) =>
  await db.prepare("SELECT amount,expires_at,redirect_url FROM payment_intents WHERE order_ref=? AND status='pending' ORDER BY created_at DESC LIMIT 1").get(orderId) as
    { amount: number; expires_at: number; redirect_url: string | null } | undefined;

/**
 * Boleh tidaknya pelanggan memindah jadwal sendiri, beserta alasannya bila tidak. Aturannya sama
 * dengan pemeriksaan di `rescheduleBooking`; ini hanya untuk menampilkan tombol dan keterangannya.
 */
async function reschedulable(booking: Booking, now: { date: string; time: string }, policy?: Policies) {
  policy ??= await getPolicies();
  if (booking.status !== "confirmed" || phaseOf(booking, now) !== "upcoming") return { allowed: false, reason: "" };
  if (policy.reschedule !== "yes") return { allowed: false, reason: "Hubungi venue untuk pindah jadwal." };
  if (booking.reschedule_count >= customerMaxReschedules) return { allowed: false, reason: "Jadwal booking ini sudah pernah dipindah." };
  const startsIn = (Date.parse(`${booking.date}T${booking.start_time}:00Z`) - Date.parse(`${now.date}T${now.time}:00Z`)) / 3600000;
  if (startsIn < policy.reschedule_hours) return { allowed: false, reason: `Batas pindah jadwal ${policy.reschedule_hours} jam sebelum main sudah lewat.` };
  return { allowed: true, reason: policy.reschedule_hours ? `Bisa dipindah sekali, paling lambat ${policy.reschedule_hours} jam sebelum main.` : "Bisa dipindah sekali sebelum main." };
}
export async function historyItem(booking: Booking, now = localClock(), policy?: Policies) {
  policy ??= await getPolicies();
  const order = await orderOf(booking.id);
  return {
    id: booking.id, code: bookingCode(booking.id), order_id: order?.id ?? null, order_code: order?.code ?? null,
    court_id: booking.court_id, court_name: booking.court_name,
    date: booking.date, start_time: booking.start_time, end_time: booking.end_time,
    status: booking.status, phase: phaseOf(booking, now), source: booking.source,
    total: booking.total, paid: booking.paid, cancel_reason: booking.cancel_reason,
    reschedule: await reschedulable(booking, now, policy),
    addons: (await bookingAddons(booking.id)).map(line => ({ name: line.name, quantity: line.quantity, subtotal: line.subtotal })),
  };
}
export type HistoryItem = Awaited<ReturnType<typeof historyItem>>;
type Policies = Awaited<ReturnType<typeof getPolicies>>;

async function accountBookings(accountId: string) {
  await expireHolds();
  const now = localClock();
  const ids = await db.prepare("SELECT id FROM bookings WHERE account_id=? ORDER BY date DESC,start_time DESC").all(accountId) as { id: string }[];
  const policy = await getPolicies();
  const items: HistoryItem[] = [];
  for (const row of ids) items.push(await historyItem(await getBooking(row.id), now, policy));
  return items;
}

export async function history(accountId: string, scope: unknown) {
  await getAccount(accountId);
  const phase = z.enum(["upcoming", "past", "cancelled"]).catch("upcoming").parse(scope);
  const all = await accountBookings(accountId);
  const items = all.filter(item => item.phase === phase);
  // Yang akan datang dibaca dari yang terdekat; riwayat dari yang terbaru.
  if (phase === "upcoming") items.reverse();
  return {
    items,
    counts: { upcoming: all.filter(item => item.phase === "upcoming").length, past: all.filter(item => item.phase === "past").length, cancelled: all.filter(item => item.phase === "cancelled").length },
  };
}

const hoursOf = (item: Pick<HistoryItem, "start_time" | "end_time">) => {
  const [sh, sm] = item.start_time.split(":").map(Number), [eh, em] = item.end_time.split(":").map(Number);
  return (eh * 60 + em - sh * 60 - sm) / 60;
};
export async function overview(accountId: string) {
  const account = await getAccount(accountId);
  const all = await accountBookings(accountId);
  const upcoming = all.filter(item => item.phase === "upcoming").reverse();
  const played = all.filter(item => item.phase === "past");
  const favorites = new Map<string, { id: string; name: string; sessions: number }>();
  for (const item of played) {
    const entry = favorites.get(item.court_id) ?? { id: item.court_id, name: item.court_name, sessions: 0 };
    entry.sessions += 1;
    favorites.set(item.court_id, entry);
  }
  const favorite = [...favorites.values()].sort((a, b) => b.sessions - a.sessions)[0] ?? null;
  // Pesanan online yang masih menunggu pembayaran, satu baris per pesanan.
  const awaiting = new Map<string, { order_id: string; order_code: string; amount: number; expires_at: number; sessions: number }>();
  for (const item of upcoming) {
    if (item.status !== "pending" || !item.order_id) continue;
    const intent = await pendingIntent(item.order_id);
    if (!intent) continue;
    const entry = awaiting.get(item.order_id) ?? { order_id: item.order_id, order_code: item.order_code!, amount: intent.amount, expires_at: intent.expires_at, sessions: 0 };
    entry.sessions += 1;
    awaiting.set(item.order_id, entry);
  }
  const month = localClock().date.slice(0, 7);
  return {
    account: publicAccount(account),
    next: upcoming.find(item => item.status === "confirmed") ?? upcoming[0] ?? null,
    upcoming: upcoming.slice(0, 4),
    upcoming_count: upcoming.length,
    awaiting: [...awaiting.values()],
    recent: played.slice(0, 3),
    stats: {
      sessions: played.length,
      hours: played.reduce((sum, item) => sum + hoursOf(item), 0),
      /** Sesi bulan ini, yang sudah dimainkan maupun yang akan datang. */
      this_month: [...played, ...upcoming].filter(item => item.date.startsWith(month)).length,
      favorite,
    },
  };
}

// --- Klaim pesanan lama -----------------------------------------------------

export const claimSchema = z.object({
  code: z.string().trim().toUpperCase().min(6, "Masukkan kode pesanan.").max(20),
  phone: phoneSchema,
});
/**
 * Pesanan yang dibuat sebelum punya akun dapat dihubungkan dengan dua bukti sekaligus:
 * kodenya (PDX-XXXXXX dari halaman pesanan, atau kode booking 8 karakter dari kasir) dan
 * nomor HP yang dipakai saat memesan. Pesan galatnya sengaja sama untuk kode salah dan
 * nomor salah agar tidak bisa dipakai menebak-nebak.
 */
export async function claim(accountId: string, input: unknown) {
  const data = claimSchema.parse(input);
  await getAccount(accountId);
  const code = data.code.replace(/\s+/g, "");
  const mismatch = "Kode pesanan atau nomor HP tidak cocok. Periksa lagi kode di halaman pesanan atau pesan WhatsApp dari venue.";
  return await transaction(async () => {
    let rows: { id: string; phone: string; account_id: string | null }[] = [];
    const order = /^(PDX-)?[A-Z0-9]{6,12}$/.test(code)
      ? await db.prepare("SELECT id FROM orders WHERE code=?").get(code.startsWith("PDX-") ? code : `PDX-${code}`) as { id: string } | undefined
      : undefined;
    if (order) rows = await db.prepare("SELECT id,phone,account_id FROM bookings WHERE order_id=?").all(order.id) as typeof rows;
    else if (/^[0-9A-F]{8}$/.test(code)) rows = await db.prepare("SELECT id,phone,account_id FROM bookings WHERE id LIKE ?").all(`${code.toLowerCase()}%`) as typeof rows;
    rows = rows.filter(row => normalizePhone(row.phone) === data.phone);
    check(rows.length, 404, mismatch);
    const others = rows.filter(row => row.account_id && row.account_id !== accountId);
    check(others.length < rows.length, 409, "Pesanan ini sudah terhubung ke akun lain. Hubungi venue bila itu pesanan Anda.");
    const fresh = rows.filter(row => !row.account_id);
    for (const row of fresh) await db.prepare("UPDATE bookings SET account_id=? WHERE id=? AND account_id IS NULL").run(accountId, row.id);
    if (fresh.length) await audit(accountId, "customer.claim", rows[0].id);
    return { linked: fresh.length, already: rows.length - fresh.length - others.length };
  });
}

// --- Panel admin ------------------------------------------------------------

export async function adminAccounts() {
  const rows = await db.prepare(`SELECT a.*,
      (SELECT count(*) FROM bookings WHERE account_id=a.id AND status NOT IN ('cancelled','expired')) bookings,
      (SELECT max(date) FROM bookings WHERE account_id=a.id AND status NOT IN ('cancelled','expired')) last_booking
    FROM customer_accounts a ORDER BY a.last_login_at DESC`).all() as (Account & { bookings: number; last_booking: string | null })[];
  return rows.map(row => ({
    id: row.id, name: row.name, email: row.email, phone: displayPhone(row.phone), photo_url: row.photo_url,
    created_at: row.created_at, last_login_at: row.last_login_at, bookings: row.bookings, last_booking: row.last_booking,
  }));
}

/** Akun yang terhubung ke booking, dan akun lain dengan nomor HP yang sama sebagai saran. */
export async function bookingAccount(booking: Pick<Booking, "id" | "phone">) {
  const linked = await db.prepare("SELECT a.* FROM bookings b JOIN customer_accounts a ON a.id=b.account_id WHERE b.id=?").get(booking.id) as Account | undefined;
  const brief = (account: Account) => ({ id: account.id, name: account.name, email: account.email, phone: displayPhone(account.phone) });
  const suggestions = linked ? [] : (await db.prepare("SELECT * FROM customer_accounts WHERE phone=? ORDER BY last_login_at DESC LIMIT 3").all(normalizePhone(booking.phone)) as Account[]).map(brief);
  return { linked: linked ? brief(linked) : null, suggestions };
}

/**
 * Staf menghubungkan booking kasir ke akun pelanggan. Staf yang memverifikasi — mis. pesan
 * WhatsApp-nya memang datang dari nomor itu — sehingga aman walau nomor di akun tidak
 * diverifikasi SMS.
 */
export async function linkBooking(bookingId: string, input: unknown, actor: string) {
  const { account_id } = z.object({ account_id: z.string().uuid().nullable() }).parse(input);
  return await transaction(async () => {
    const booking = await getBooking(bookingId);
    if (account_id) check(await findAccount(account_id), 404, "Akun pelanggan tidak ditemukan.");
    await db.prepare("UPDATE bookings SET account_id=? WHERE id=?").run(account_id, booking.id);
    await audit(actor, account_id ? "booking.account.link" : "booking.account.unlink", booking.id);
    return await bookingAccount(booking);
  });
}

/** Pelanggan memindah jadwal booking miliknya sendiri. Booking orang lain dijawab "tidak ditemukan". */
export async function rescheduleOwn(accountId: string, bookingId: string, input: unknown) {
  const moved = await transaction(async () => {
    await getAccount(accountId);
    const owner = await db.prepare("SELECT account_id FROM bookings WHERE id=?").get(bookingId) as { account_id: string | null } | undefined;
    check(owner && owner.account_id === accountId, 404, "Booking tidak ditemukan di akun Anda.");
    return await rescheduleBooking(bookingId, input, accountId, true);
  });
  return await historyItem(moved);
}
