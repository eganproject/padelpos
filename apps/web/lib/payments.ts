import { api } from "./api";

/** Sama dengan API (apps/api/src/midtrans.ts dan payments.ts). */
export type PaymentMode = "full" | "dp";
export type IntentStatus = "pending" | "paid" | "expired" | "cancelled" | "failed" | "refunded";

/** Yang diketahui pelanggan. */
export type PaymentPublic = { enabled: boolean; mode: PaymentMode; dp_percent: number; hold_minutes: number; note: string };
/** Pengaturan untuk admin; server key tidak pernah ikut, hanya penandanya. */
export type PaymentSettings = {
  enabled: boolean; environment: "sandbox" | "production"; client_key: string; mode: PaymentMode;
  dp_percent: number; hold_minutes: number; note: string; updated_at: string | null;
  server_key_set: boolean; key_source: "panel" | "env"; ready: boolean; webhook_url: string; finish_url: string;
};
export type PaymentIntent = {
  order_id: string; booking_id: string; amount: number; kind: "booking" | "tagihan"; status: IntentStatus;
  redirect_url: string | null; payment_type: string | null; transaction_id: string | null;
  environment: string; expires_at: number; created_at: string; updated_at: string; raw_status: string | null;
};
export type AdminIntent = PaymentIntent & { customer: string; date: string; start_time: string; end_time: string; booking_status: string; court_name: string };
export type OrderView = {
  order: {
    id: string; code: string; court_name: string; date: string; start_time: string; end_time: string;
    customer: string; phone: string; status: string; total: number; court_total: number; paid: number;
    notes: string; cancel_reason: string; created_at: string;
    addons: { name: string; quantity: number; subtotal: number }[];
  };
  payment: { order_id: string; status: IntentStatus; amount: number; kind: "booking" | "tagihan"; redirect_url: string | null; expires_at: number; payment_type: string | null; updated_at: string } | null;
};

export const intentLabel: Record<IntentStatus, string> = {
  pending: "Menunggu pembayaran", paid: "Lunas", expired: "Kedaluwarsa",
  cancelled: "Dibatalkan", failed: "Gagal", refunded: "Dikembalikan",
};
/** Kelas warna untuk `.status-pill`. */
export const intentTone: Record<IntentStatus, string> = { pending: "wait", paid: "on", expired: "off", cancelled: "off", failed: "off", refunded: "done" };
export const methodLabel: Record<string, string> = { qris: "QRIS", va: "Virtual account", ewallet: "E-wallet", card: "Kartu", transfer: "Transfer", cash: "Tunai" };
export const payTypeLabel = (type: string | null) => (type ? type.replace(/_/g, " ") : "belum dipilih");

/** Nominal yang ditagih sekarang; hitungannya sama dengan server. */
export const amountDue = (payment: Pick<PaymentPublic, "mode" | "dp_percent">, total: number) =>
  payment.mode === "dp" ? Math.min(total, Math.max(1000, Math.ceil(total * payment.dp_percent / 100 / 1000) * 1000)) : total;

/** Sisa waktu "mm:ss"; kosong bila sudah lewat. */
export function countdown(expiresAt: number, now: number) {
  const seconds = Math.floor(expiresAt - now / 1000);
  if (seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type CheckoutBody = {
  court_id: string; date: string; start_time: string; end_time: string;
  customer: string; phone: string; email: string; notes: string;
  addons: { addon_id: string; quantity: number }[];
};
export type CheckoutResult = { booking_id: string; code: string; order_id: string; amount: number; total: number; expires_at: number; redirect_url: string; token: string };
export const startCheckout = (body: CheckoutBody) => api<CheckoutResult>("/public/checkout", { method: "POST", body: JSON.stringify(body) });
export const fetchOrder = (id: string) => api<OrderView>(`/public/orders/${encodeURIComponent(id)}`);
export const refreshOrder = (id: string) => api<OrderView>(`/public/orders/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" });
