import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit, db, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { publicUrl } from "./config.js";
import { taxSnapshot } from "./bill.js";

/**
 * Midtrans Snap. Kunci dapat diisi dari panel admin atau dari environment; environment selalu
 * menang agar server produksi tidak bergantung pada isi database. Server key tidak pernah
 * dikirim kembali ke browser, hanya penanda bahwa kuncinya sudah terisi.
 */
export type PaymentMode = "full" | "dp";
export interface PaymentSettings {
  enabled: boolean; environment: "sandbox" | "production"; client_key: string; server_key: string;
  mode: PaymentMode; dp_percent: number; hold_minutes: number; note: string; updated_at: string | null;
}
const defaults: PaymentSettings = {
  enabled: false, environment: "sandbox", client_key: "", server_key: "",
  mode: "full", dp_percent: 50, hold_minutes: 20, note: "", updated_at: null,
};
async function stored(): Promise<PaymentSettings> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key`='payment'").get() as { document: string } | undefined;
  return { ...defaults, ...(row ? JSON.parse(row.document) as Partial<PaymentSettings> : {}) };
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
    const next: PaymentSettings = {
      enabled: data.enabled, environment: data.environment, client_key: data.client_key, server_key: serverKey,
      mode: data.mode, dp_percent: data.dp_percent, hold_minutes: data.hold_minutes, note: data.note,
      updated_at: new Date().toISOString(),
    };
    await saveSetting("payment", next);
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
    server_key_set: !!config.serverKey, key_source: config.fromEnv ? "env" : "panel",
    ready: await paymentReady(),
    webhook_url: `${publicUrl}/api/public/payments/midtrans/notification`,
    finish_url: `${publicUrl}/pesanan/`,
  };
}
/** Yang boleh diketahui pelanggan. */
export async function publicPayment() {
  const config = await paymentConfig();
  const ready = await paymentReady();
  // Client key memang dibuat untuk browser: Snap.js memakainya agar pembayaran terbuka di halaman pesanan.
  return {
    enabled: ready, mode: config.mode, dp_percent: config.dp_percent, hold_minutes: config.hold_minutes, note: config.note, tax: await taxSnapshot(),
    client_key: ready ? config.clientKey : "", environment: config.environment,
  };
}
