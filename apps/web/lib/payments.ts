import { api } from "./api";
import type { TaxSnapshot } from "./bill";

/** Sama dengan API (apps/api/src/midtrans.ts dan payments.ts). */
export type PaymentMode = "full" | "dp";
export type IntentStatus = "pending" | "paid" | "expired" | "cancelled" | "failed" | "refunded";

/** Siapa yang menanggung biaya admin Midtrans. */
export type FeeBearer = "venue" | "customer";
export type ChannelKey = "qris" | "gopay" | "shopeepay" | "va" | "card" | "cstore" | "akulaku" | "kredivo";
/** Tarif satu metode Midtrans: persen dari nominal, ditambah biaya tetap, lalu PPN bila tarifnya belum termasuk pajak. */
export type ChannelFee = { key: ChannelKey; label: string; hint: string; enabled: boolean; percent: number; flat: number; vat: boolean };
/** Tarif yang diketahui pelanggan dan kasir; hanya metode yang aktif. */
export type PublicFees = { fee_bearer: FeeBearer; vat_percent: number; channels: ChannelFee[] };

/** Yang diketahui pelanggan. */
export type PaymentPublic = {
  enabled: boolean; mode: PaymentMode; dp_percent: number; hold_minutes: number; note: string; tax?: TaxSnapshot;
  /** Untuk Snap.js; kosong bila admin belum mengisi client key. */
  client_key?: string; environment?: "sandbox" | "production";
  fees?: PublicFees;
};
/** Pengaturan untuk admin; server key tidak pernah ikut, hanya penandanya. */
export type PaymentSettings = {
  enabled: boolean; environment: "sandbox" | "production"; client_key: string; mode: PaymentMode;
  dp_percent: number; hold_minutes: number; note: string; updated_at: string | null;
  fee_bearer: FeeBearer; vat_percent: number; channels: ChannelFee[];
  server_key_set: boolean; key_source: "panel" | "env"; ready: boolean; webhook_url: string; finish_url: string;
};

/** Potongan Midtrans untuk transaksi senilai `gross`; rumusnya sama dengan server (apps/api/src/midtrans.ts). */
export function feeFor(channel: Pick<ChannelFee, "percent" | "flat" | "vat"> | undefined, gross: number, vatPercent: number) {
  if (!channel || gross <= 0) return 0;
  const vat = channel.vat ? 1 + vatPercent / 100 : 1;
  return Math.max(0, Math.min(gross, Math.round((gross * channel.percent / 100 + channel.flat) * vat)));
}
/** Biaya layanan yang ditambahkan ke tagihan bila pelanggan menanggung biaya admin; 0 bila venue yang menanggung. */
export function surchargeFor(fees: Pick<PublicFees, "fee_bearer" | "vat_percent"> | undefined, channel: Pick<ChannelFee, "percent" | "flat" | "vat"> | undefined, base: number) {
  if (!fees || fees.fee_bearer !== "customer" || !channel || base <= 0) return 0;
  const vat = channel.vat ? 1 + fees.vat_percent / 100 : 1;
  let surcharge = Math.max(0, Math.ceil((base + channel.flat * vat) / (1 - channel.percent / 100 * vat)) - base);
  while (feeFor(channel, base + surcharge, fees.vat_percent) > surcharge) surcharge++;
  return surcharge;
}
/** "0,7%", "Rp4.000 + PPN", "2,9% + Rp2.000 + PPN". */
export function rateLabel(channel: Pick<ChannelFee, "percent" | "flat" | "vat">) {
  const parts = [
    channel.percent ? `${channel.percent.toLocaleString("id-ID")}%` : "",
    channel.flat ? `Rp${channel.flat.toLocaleString("id-ID")}` : "",
  ].filter(Boolean);
  if (!parts.length) return "Gratis";
  return parts.join(" + ") + (channel.vat ? " + PPN" : "");
}
export type PaymentIntent = {
  order_id: string; booking_id: string; amount: number; surcharge?: number; channel?: ChannelKey | null; kind: "booking" | "tagihan"; status: IntentStatus;
  redirect_url: string | null; payment_type: string | null; transaction_id: string | null;
  environment: string; expires_at: number; created_at: string; updated_at: string; raw_status: string | null;
};
export type AdminIntent = PaymentIntent & { customer: string; date: string; start_time: string; end_time: string; booking_status: string; court_name: string };
export type OrderSession = {
  id: string; code: string; court_name: string; date: string; start_time: string; end_time: string;
  status: string; court_total: number; total: number; paid: number; cancel_reason: string;
  discount: number; discount_note: string; tax: number; tax_rate: number; tax_inclusive: number; tax_label: string;
  member_discount?: number; member_plan?: string;
  voucher_discount?: number; voucher_code?: string;
  addons: { name: string; quantity: number; subtotal: number }[];
};
export type OrderView = {
  order: {
    id: string; code: string; customer: string; phone: string; status: string;
    total: number; paid: number; notes: string; created_at: string;
    sessions: OrderSession[];
  };
  /** Uang masuk (payment) dan keluar (refund) untuk kwitansi, urut waktu. */
  payments?: { id: string; session_code: string; amount: number; surcharge?: number; kind: "payment" | "refund"; method: string; source: "staff" | "gateway"; created_at: string }[];
  /** `amount` sudah termasuk `surcharge`, biaya layanan Midtrans yang ditanggung pelanggan. */
  payment: { order_id: string; status: IntentStatus; amount: number; surcharge?: number; channel?: ChannelKey | null; kind: "booking" | "tagihan"; redirect_url: string | null; snap_token?: string | null; expires_at: number; payment_type: string | null; updated_at: string } | null;
};

export const intentLabel: Record<IntentStatus, string> = {
  pending: "Menunggu pembayaran", paid: "Lunas", expired: "Kedaluwarsa",
  cancelled: "Dibatalkan", failed: "Gagal", refunded: "Dikembalikan",
};
/** Kelas warna untuk `.status-pill`. */
export const intentTone: Record<IntentStatus, string> = { pending: "wait", paid: "on", expired: "off", cancelled: "off", failed: "off", refunded: "done" };
export const methodLabel: Record<string, string> = { qris: "QRIS", va: "Virtual account", ewallet: "E-wallet", card: "Kartu", transfer: "Transfer", cash: "Tunai" };
/** Nama `payment_type` Midtrans yang dikenal pelanggan dan kasir. */
const payTypes: Record<string, string> = {
  qris: "QRIS", gopay: "GoPay", shopeepay: "ShopeePay", dana: "DANA", credit_card: "Kartu kredit",
  bank_transfer: "Transfer bank (VA)", echannel: "Mandiri Bill", permata: "VA Permata", bca_va: "VA BCA", bni_va: "VA BNI", bri_va: "VA BRI", other_va: "Virtual account",
  cstore: "Gerai retail", akulaku: "Akulaku", kredivo: "Kredivo",
};
const channelNames: Record<string, string> = { qris: "QRIS", gopay: "GoPay", shopeepay: "ShopeePay", va: "Virtual account", card: "Kartu", cstore: "Indomaret/Alfamart", akulaku: "Akulaku", kredivo: "Kredivo" };
export const channelName = (key: string | null | undefined) => (key ? channelNames[key] ?? key : "");
export const payTypeLabel = (type: string | null) => (type ? payTypes[type] ?? type.replace(/_/g, " ") : "belum dipilih");

/** Nominal yang ditagih sekarang; hitungannya sama dengan server. */
export const amountDue = (payment: Pick<PaymentPublic, "mode" | "dp_percent">, total: number) =>
  payment.mode === "dp" ? Math.min(total, Math.max(1000, Math.ceil(total * payment.dp_percent / 100 / 1000) * 1000)) : total;

/** Sisa waktu "mm:ss"; kosong bila sudah lewat. */
export function countdown(expiresAt: number, now: number) {
  const seconds = Math.floor(expiresAt - now / 1000);
  if (seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type CartLine = { court_id: string; date: string; start_time: string; end_time: string; addons: { addon_id: string; quantity: number }[] };
export type CheckoutBody = { items: CartLine[]; customer: string; phone: string; email: string; notes: string; channel?: ChannelKey | null; voucher_code?: string };
export type CheckoutResult = { order_id: string; code: string; transaction_id: string; sessions: number; amount: number; surcharge: number; total: number; expires_at: number; redirect_url: string; token: string };
/** Hasil pemeriksaan keranjang oleh server: harga terbaru dan alasan bila satu sesi tidak bisa dipesan. */
export type CartQuoteItem = {
  index: number; court_id: string; court_name: string; date: string; start_time: string; end_time: string;
  ok: boolean; reason?: string; court_total: number; tax: number; total: number;
  /** Potongan member bila pelanggan masuk dengan akun member; sudah termasuk dalam `total`. */
  member_discount?: number; member_plan?: string;
  /** Bagian potongan voucher untuk sesi ini; sudah termasuk dalam `total`. */
  voucher_discount?: number;
  addons: { addon_id: string; name: string; quantity: number; unit_price: number; pricing: "per_booking" | "per_hour"; subtotal: number; ok: boolean }[];
};
/** Hasil pemeriksaan kode promo. `message` menjelaskan alasan bila kode tidak berlaku. */
export type VoucherCheck = { ok: boolean; code: string; name: string; summary: string; amount: number; message: string };
export type CartQuote = {
  items: CartQuoteItem[]; total: number; tax: number; tax_label: string; tax_inclusive: boolean; amount: number; member_discount?: number;
  voucher?: VoucherCheck | null; voucher_discount?: number;
};
export const quoteCart = (items: CartLine[], extra: { voucher_code?: string; phone?: string } = {}) =>
  api<CartQuote>("/public/cart/quote", { method: "POST", body: JSON.stringify({ items, ...extra }) });
export const startCheckout = (body: CheckoutBody) => api<CheckoutResult>("/public/checkout", { method: "POST", body: JSON.stringify(body) });
export const fetchOrder = (id: string) => api<OrderView>(`/public/orders/${encodeURIComponent(id)}`);
export const refreshOrder = (id: string) => api<OrderView>(`/public/orders/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" });
