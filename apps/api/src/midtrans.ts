import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit, db, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { publicUrl } from "./config.js";
import { taxSnapshot } from "./bill.js";
import { seal, unseal } from "./secrets.js";

/**
 * Midtrans Snap. Kunci dapat diisi dari panel admin atau dari environment; environment selalu
 * menang agar server produksi tidak bergantung pada isi database. Server key tidak pernah
 * dikirim kembali ke browser, hanya penanda bahwa kuncinya sudah terisi.
 */
export type PaymentMode = "full" | "dp";
/** Siapa yang menanggung biaya admin Midtrans: venue (dipotong dari pendapatan) atau pelanggan (ditambahkan ke tagihan). */
export type FeeBearer = "venue" | "customer";
export type ChannelKey = "qris" | "gopay" | "shopeepay" | "va" | "card" | "cstore" | "akulaku" | "kredivo";
/** Tarif Midtrans untuk satu kanal: persen dari nominal transaksi, ditambah biaya tetap, lalu PPN bila tarifnya belum termasuk pajak. */
export interface ChannelFee { enabled: boolean; percent: number; flat: number; vat: boolean }
export interface PaymentSettings {
  enabled: boolean; environment: "sandbox" | "production"; client_key: string; server_key: string;
  mode: PaymentMode; dp_percent: number; hold_minutes: number; note: string; updated_at: string | null;
  fee_bearer: FeeBearer; vat_percent: number; channels: Record<ChannelKey, ChannelFee>;
}

/**
 * Kanal pembayaran Snap dan tarif standar Midtrans (midtrans.com/pricing, Oktober 2026). Venue dengan
 * tarif khusus dapat mengubahnya di panel. `snap` adalah nilai `enabled_payments`, `types` adalah
 * `payment_type` yang dikirim kembali oleh Midtrans saat pembayaran masuk.
 */
export const channelCatalog: { key: ChannelKey; label: string; hint: string; snap: string[]; types: string[]; defaults: ChannelFee }[] = [
  { key: "qris", label: "QRIS", hint: "Semua aplikasi bank & e-wallet", snap: ["other_qris"], types: ["qris"], defaults: { enabled: true, percent: 0.7, flat: 0, vat: false } },
  { key: "gopay", label: "GoPay", hint: "Aplikasi Gojek / GoPay", snap: ["gopay"], types: ["gopay"], defaults: { enabled: true, percent: 2, flat: 0, vat: false } },
  { key: "shopeepay", label: "ShopeePay", hint: "Aplikasi Shopee", snap: ["shopeepay"], types: ["shopeepay"], defaults: { enabled: true, percent: 2, flat: 0, vat: false } },
  { key: "va", label: "Virtual account", hint: "BCA, BNI, BRI, Mandiri, Permata, CIMB", snap: ["bca_va", "bni_va", "bri_va", "echannel", "permata_va", "cimb_va", "other_va"],
    types: ["bank_transfer", "echannel", "permata", "bca_va", "bni_va", "bri_va", "cimb_va", "other_va"], defaults: { enabled: true, percent: 0, flat: 4000, vat: true } },
  { key: "card", label: "Kartu kredit/debit", hint: "Visa, Mastercard, JCB, Amex", snap: ["credit_card"], types: ["credit_card"], defaults: { enabled: true, percent: 2.9, flat: 2000, vat: true } },
  { key: "cstore", label: "Indomaret / Alfamart", hint: "Bayar tunai di gerai", snap: ["indomaret", "alfamart"], types: ["cstore"], defaults: { enabled: true, percent: 0, flat: 5000, vat: false } },
  { key: "akulaku", label: "Akulaku PayLater", hint: "Cicilan tanpa kartu", snap: ["akulaku"], types: ["akulaku"], defaults: { enabled: true, percent: 1.7, flat: 0, vat: true } },
  { key: "kredivo", label: "Kredivo", hint: "Cicilan tanpa kartu", snap: ["kredivo"], types: ["kredivo"], defaults: { enabled: true, percent: 2, flat: 0, vat: true } },
];
export const channelKeys = channelCatalog.map(channel => channel.key) as [ChannelKey, ...ChannelKey[]];
const defaultChannels = () => Object.fromEntries(channelCatalog.map(channel => [channel.key, { ...channel.defaults }])) as Record<ChannelKey, ChannelFee>;

const defaults: PaymentSettings = {
  enabled: false, environment: "sandbox", client_key: "", server_key: "",
  mode: "full", dp_percent: 50, hold_minutes: 20, note: "", updated_at: null,
  fee_bearer: "venue", vat_percent: 11, channels: defaultChannels(),
};
async function stored(): Promise<PaymentSettings> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key`='payment'").get() as { document: string } | undefined;
  const saved = row ? JSON.parse(row.document) as Partial<PaymentSettings> : {};
  // Kanal yang belum pernah disimpan memakai tarif standar Midtrans.
  return { ...defaults, ...saved, server_key: unseal(saved.server_key), channels: { ...defaultChannels(), ...(saved.channels ?? {}) } };
}
export async function paymentConfig() {
  const settings = await stored();
  const envServer = process.env.MIDTRANS_SERVER_KEY?.trim() || "";
  const envClient = process.env.MIDTRANS_CLIENT_KEY?.trim() || "";
  const fromEnv = !!envServer;
  return {
    ...settings,
    environment: fromEnv ? (process.env.MIDTRANS_IS_PRODUCTION?.trim() === "true" ? "production" : "sandbox") : settings.environment,
    serverKey: envServer || settings.server_key,
    clientKey: envClient || settings.client_key,
    fromEnv,
  };
}
/** Siap dipakai bila admin mengaktifkannya dan server key tersedia. */
export const paymentReady = async () => { const config = await paymentConfig(); return config.enabled && !!config.serverKey; };

// --- Biaya admin Midtrans --------------------------------------------------------

type FeeConfig = Pick<PaymentSettings, "fee_bearer" | "vat_percent" | "channels">;
/** Kanal dari `payment_type` Midtrans; null untuk jenis yang tidak dikenal (tanpa potongan). */
export const channelOf = (paymentType?: string | null) => channelCatalog.find(channel => channel.types.includes(paymentType ?? ""))?.key ?? null;
export const channelLabel = (key: string | null | undefined) => channelCatalog.find(channel => channel.key === key)?.label ?? "";
/** Potongan Midtrans untuk satu transaksi senilai `gross` lewat kanal itu, dibulatkan ke rupiah terdekat. */
export function feeFor(channel: ChannelKey | null, gross: number, config: FeeConfig) {
  const rate = channel ? config.channels[channel] : undefined;
  if (!rate || gross <= 0) return 0;
  const vat = rate.vat ? 1 + config.vat_percent / 100 : 1;
  return Math.max(0, Math.min(gross, Math.round((gross * rate.percent / 100 + rate.flat) * vat)));
}
/**
 * Biaya layanan yang ditambahkan ke tagihan bila pelanggan menanggung biaya admin. Midtrans memotong
 * persennya dari nominal yang ditagih (termasuk biaya layanan itu sendiri), jadi angkanya dinaikkan
 * sampai potongan Midtrans tertutup penuh dan venue tetap menerima harga aslinya.
 */
export function surchargeFor(channel: ChannelKey | null, base: number, config: FeeConfig) {
  if (config.fee_bearer !== "customer" || !channel || base <= 0) return 0;
  const rate = config.channels[channel];
  const vat = rate.vat ? 1 + config.vat_percent / 100 : 1;
  const share = rate.percent / 100 * vat;
  let surcharge = Math.max(0, Math.ceil((base + rate.flat * vat) / (1 - share)) - base);
  while (feeFor(channel, base + surcharge, config) > surcharge) surcharge++;
  return surcharge;
}
/** Potongan Midtrans untuk pembayaran yang sudah masuk, menurut jenis pembayaran yang dilaporkan Midtrans. */
export async function gatewayFee(paymentType: string | null | undefined, gross: number) {
  return feeFor(channelOf(paymentType), gross, await stored());
}
/**
 * Kanal yang dipilih pelanggan sebelum membuka Midtrans. Wajib bila pelanggan menanggung biaya admin,
 * karena besarnya berbeda per kanal; bila venue yang menanggung, Midtrans menampilkan semua kanal aktif.
 */
export async function pickChannel(input: unknown): Promise<ChannelKey | null> {
  const config = await stored();
  const parsed = z.enum(channelKeys).nullable().optional().safeParse(input);
  const channel = parsed.success ? parsed.data ?? null : null;
  check(!channel || config.channels[channel].enabled, 400, "Metode pembayaran itu sedang tidak tersedia. Pilih metode lain.");
  check(channel || config.fee_bearer !== "customer", 400, "Pilih metode pembayaran terlebih dahulu.");
  return channel;
}
/** `enabled_payments` untuk Snap: kanal yang dipilih, atau semua kanal yang aktif. */
export async function snapPayments(channel: ChannelKey | null) {
  const config = await stored();
  if (channel) return { enabled_payments: channelCatalog.find(entry => entry.key === channel)!.snap };
  const active = channelCatalog.filter(entry => config.channels[entry.key].enabled);
  return active.length === channelCatalog.length ? {} : { enabled_payments: active.flatMap(entry => entry.snap) };
}
/** Baris biaya layanan untuk rincian Midtrans. */
export const surchargeItem = (surcharge: number, channel: ChannelKey | null) =>
  surcharge > 0 ? [{ id: "biaya-layanan", price: surcharge, quantity: 1, name: `Biaya layanan ${channelLabel(channel)}`.trim().slice(0, 50) }] : [];
/** Tarif yang boleh diketahui pelanggan dan kasir, untuk menghitung biaya layanan sebelum membayar. */
async function publicFees() {
  const config = await stored();
  return {
    fee_bearer: config.fee_bearer, vat_percent: config.vat_percent,
    channels: channelCatalog.filter(entry => config.channels[entry.key].enabled)
      .map(entry => ({ key: entry.key, label: entry.label, hint: entry.hint, ...config.channels[entry.key] })),
  };
}

/** Nominal yang ditagih online: penuh, atau DP yang dibulatkan ke ribuan terdekat ke atas. */
export function payableAmount(total: number, config: Pick<PaymentSettings, "mode" | "dp_percent">) {
  if (config.mode === "full") return total;
  return Math.min(total, Math.max(1000, Math.ceil(total * config.dp_percent / 100 / 1000) * 1000));
}

const hosts = (environment: string) => environment === "production"
  ? { snap: "https://app.midtrans.com", api: "https://api.midtrans.com" }
  : { snap: "https://app.sandbox.midtrans.com", api: "https://api.sandbox.midtrans.com" };

type MidtransBody = Record<string, unknown> & { status_code?: string; status_message?: string; error_messages?: string[] };
async function callMidtrans(host: "snap" | "api", path: string, init: { method: string; body?: string } = { method: "GET" }) {
  const config = await paymentConfig();
  check(config.serverKey, 409, "Server key Midtrans belum diisi.");
  let response: Response | undefined;
  try {
    response = await fetch(hosts(config.environment)[host] + path, {
      method: init.method, body: init.body,
      headers: {
        Accept: "application/json", "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(config.serverKey + ":").toString("base64"),
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    check(false, 502, `Tidak dapat menghubungi Midtrans: ${(error as Error).message}`);
  }
  const text = await response!.text();
  let body: MidtransBody = {};
  try { body = text ? JSON.parse(text) as MidtransBody : {}; } catch { body = { status_message: text.slice(0, 200) }; }
  return { status: response!.status, body };
}
const complaint = (body: MidtransBody, status: number) =>
  [body.status_message, ...(body.error_messages ?? [])].filter(Boolean).join(" ") || `kode ${status}`;

export async function createSnapTransaction(payload: object) {
  const { status, body } = await callMidtrans("snap", "/snap/v1/transactions", { method: "POST", body: JSON.stringify(payload) });
  check(status < 300 && typeof body.token === "string", 502, `Midtrans menolak transaksi: ${complaint(body, status)}`);
  return body as { token: string; redirect_url: string };
}
export type MidtransStatus = { transaction_status?: string; fraud_status?: string; transaction_id?: string; payment_type?: string; gross_amount?: string; status_code?: string };
/** null bila pelanggan belum memilih metode pembayaran, sehingga ordernya belum ada di Midtrans. */
export async function fetchTransactionStatus(orderId: string) {
  const { status, body } = await callMidtrans("api", `/v2/${encodeURIComponent(orderId)}/status`);
  if (status === 404 || body.status_code === "404") return null;
  check(status < 300, 502, `Gagal membaca status dari Midtrans: ${complaint(body, status)}`);
  return body as MidtransStatus;
}
/** Hentikan transaksi yang belum dibayar. 404 berarti pelanggan belum memilih metode, jadi tidak ada yang perlu dihentikan. */
export async function expireTransaction(orderId: string) {
  const { status, body } = await callMidtrans("api", `/v2/${encodeURIComponent(orderId)}/expire`, { method: "POST" });
  if (status === 404 || body.status_code === "404") return false;
  check(status < 300, 502, `Gagal menghentikan transaksi di Midtrans: ${complaint(body, status)}`);
  return true;
}
/** Uji kunci: 401 berarti server key ditolak; 404 berarti kunci sah dan order uji memang tidak ada. */
export async function testCredentials() {
  const { status, body } = await callMidtrans("api", "/v2/padelix-uji-koneksi/status");
  const environment = (await paymentConfig()).environment === "production" ? "produksi" : "sandbox";
  if (status === 401 || body.status_code === "401")
    return { ok: false, message: `Server key ditolak Midtrans. Periksa kuncinya dan pilihan ${environment}.` };
  check(status === 404 || status < 300 || body.status_code === "404", 502, `Midtrans menjawab: ${complaint(body, status)}`);
  return { ok: true, message: `Server key ${environment} diterima Midtrans.` };
}

export const signatureFor = (orderId: string, statusCode: string, grossAmount: string, serverKey: string) =>
  createHash("sha512").update(orderId + statusCode + grossAmount + serverKey).digest("hex");
export function signatureMatches(expected: string, received: string) {
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/** payment_type Midtrans dipetakan ke metode pembayaran yang dikenal aplikasi. */
const methods: Record<string, string> = {
  credit_card: "card", gopay: "ewallet", shopeepay: "ewallet", dana: "ewallet", qris: "qris",
  bank_transfer: "va", echannel: "va", permata: "va", bca_va: "va", bni_va: "va", bri_va: "va", other_va: "va",
};
export const paymentMethod = (type?: string) => methods[type ?? ""] ?? "transfer";
export type Outcome = "paid" | "pending" | "expired" | "cancelled" | "failed" | "refunded";
export function outcomeOf(status: MidtransStatus): Outcome {
  const value = status.transaction_status;
  if (value === "settlement" || (value === "capture" && status.fraud_status !== "deny" && status.fraud_status !== "challenge")) return "paid";
  if (value === "pending" || value === "authorize" || value === "capture") return "pending";
  if (value === "expire") return "expired";
  if (value === "cancel") return "cancelled";
  if (value === "refund" || value === "partial_refund" || value === "chargeback" || value === "partial_chargeback") return "refunded";
  return "failed";
}

export const paymentSettingsSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(["sandbox", "production"]),
  client_key: z.string().trim().max(120).default(""),
  /** Kosong berarti server key yang tersimpan dipertahankan. */
  server_key: z.string().trim().max(120).default(""),
  clear_server_key: z.boolean().default(false),
  mode: z.enum(["full", "dp"]),
  dp_percent: z.number().int().min(10, "DP minimal 10%.").max(90, "DP maksimal 90%."),
  hold_minutes: z.number().int().min(10, "Batas waktu bayar minimal 10 menit.").max(120, "Batas waktu bayar maksimal 120 menit."),
  note: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default(""),
  fee_bearer: z.enum(["venue", "customer"]).optional(),
  vat_percent: z.number().min(0).max(20, "PPN maksimal 20%.").optional(),
  channels: z.partialRecord(z.enum(channelKeys), z.object({
    enabled: z.boolean(),
    percent: z.number().min(0).max(10, "Persen biaya admin maksimal 10%."),
    flat: z.number().int().min(0).max(50000, "Biaya tetap maksimal Rp50.000."),
    vat: z.boolean(),
  })).optional(),
});
export async function savePaymentSettings(input: unknown, actor: string) {
  const data = paymentSettingsSchema.parse(input);
  const prefix = data.environment === "sandbox" ? "SB-Mid-" : "Mid-";
  if (data.server_key) check(data.server_key.startsWith(prefix + "server-"), 400, `Server key ${data.environment} diawali ${prefix}server-.`);
  if (data.client_key) check(data.client_key.startsWith(prefix + "client-"), 400, `Client key ${data.environment} diawali ${prefix}client-.`);
  return await transaction(async () => {
    const current = await stored();
    const serverKey = data.clear_server_key ? "" : (data.server_key || current.server_key);
    check(!data.enabled || serverKey || process.env.MIDTRANS_SERVER_KEY, 409, "Isi server key sebelum mengaktifkan pembayaran online.");
    const channels = { ...current.channels };
    for (const key of channelKeys) {
      const rate = data.channels?.[key];
      if (rate) channels[key] = { enabled: rate.enabled, percent: Math.round(rate.percent * 100) / 100, flat: rate.flat, vat: rate.vat };
    }
    check(channelKeys.some(key => channels[key].enabled), 400, "Aktifkan minimal satu metode pembayaran.");
    const next: PaymentSettings = {
      enabled: data.enabled, environment: data.environment, client_key: data.client_key, server_key: serverKey,
      mode: data.mode, dp_percent: data.dp_percent, hold_minutes: data.hold_minutes, note: data.note,
      fee_bearer: data.fee_bearer ?? current.fee_bearer, vat_percent: data.vat_percent ?? current.vat_percent, channels,
      updated_at: new Date().toISOString(),
    };
    await saveSetting("payment", { ...next, server_key: seal(next.server_key) });
    await audit(actor, "payment.settings", "payment");
    return await adminPayment();
  });
}
/** Ringkasan untuk panel admin, tanpa server key. */
export async function adminPayment() {
  const config = await paymentConfig();
  return {
    enabled: config.enabled, environment: config.environment, client_key: config.clientKey,
    mode: config.mode, dp_percent: config.dp_percent, hold_minutes: config.hold_minutes,
    note: config.note, updated_at: config.updated_at,
    fee_bearer: config.fee_bearer, vat_percent: config.vat_percent,
    channels: channelCatalog.map(entry => ({ key: entry.key, label: entry.label, hint: entry.hint, ...config.channels[entry.key] })),
    server_key_set: !!config.serverKey, key_source: config.fromEnv ? "env" : "panel",
    ready: await paymentReady(),
    webhook_url: `${publicUrl}/api/public/payments/midtrans/notification`,
    finish_url: `${publicUrl}/pesanan/`,
  };
}
/** Yang boleh diketahui pelanggan. */
export { publicFees };
export async function publicPayment() {
  const config = await paymentConfig();
  const ready = await paymentReady();
  // Client key memang dibuat untuk browser: Snap.js memakainya agar pembayaran terbuka di halaman pesanan.
  return {
    enabled: ready, mode: config.mode, dp_percent: config.dp_percent, hold_minutes: config.hold_minutes, note: config.note, tax: await taxSnapshot(),
    client_key: ready ? config.clientKey : "", environment: config.environment,
    fees: await publicFees(),
  };
}
