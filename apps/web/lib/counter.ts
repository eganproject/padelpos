import type { ChannelKey, PublicFees } from "./payments";
import type { AddonOption, AddonPricing, BookingAddon } from "./addons";
import type { TaxSnapshot } from "./bill";
import type { ReceiptSettings, ReceiptVenue } from "./receipt";

/** Transaksi langsung di kasir tanpa booking lapangan. Sama dengan apps/api/src/counter.ts. */
export type SaleMethod = "cash" | "transfer" | "qris" | "midtrans";
export type SaleStatus = "pending" | "paid" | "void" | "expired";
export type CounterSale = {
  id: string; number: string; customer: string; phone: string; date: string; start_time: string; end_time: string;
  subtotal: number; discount: number; discount_note: string; tax: number; tax_rate: number; tax_inclusive: number; tax_label: string;
  /** Setelah lunas lewat Midtrans, berisi metode sebenarnya: qris, va, ewallet, card, atau transfer. */
  total: number; method: string; tendered: number | null; status: SaleStatus; notes: string; void_reason: string;
  voided_at: string | null; created_at: string;
  customer_id: string | null; booking_id: string | null; fee: number; paid_at: string | null;
  /** Biaya layanan Midtrans yang dibayar pelanggan di atas `total` (bila biaya admin ditanggung pelanggan). */
  surcharge?: number; channel?: ChannelKey | null;
  pay_order_id: string | null; snap_token: string | null; pay_url: string | null; pay_expires_at: number | null; payment_type: string | null;
  voucher_id?: string | null; voucher_code?: string; voucher_discount?: number;
};
/** Booking lapangan hari ini yang bisa dihubungkan ke transaksi kasir. */
export type LinkedBooking = { id: string; code: string; court_name: string; customer: string; phone: string; customer_id: string | null; date: string; start_time: string; end_time: string; status: string };
/** Rekomendasi pelanggan dari riwayat booking dan transaksi kasir. */
export type CustomerHit = { customer_id: string | null; name: string; phone: string; visits: number; last_visit: string; booking: LinkedBooking | null };
export type CounterLine = {
  id: string; addon_id: string | null; name: string; type: BookingAddon["type"]; pricing: AddonPricing;
  unit_price: number; quantity: number; subtotal: number; returned_at: string | null;
};
export type SaleRow = CounterSale & { open_rentals: number; items: string | null; booking_court: string | null; booking_start: string | null; booking_end: string | null };
export type SaleList = { sales: SaleRow[]; summary: { count: number; total: number; by_method: Partial<Record<string, number>>; pending: number }; date: string; today: string };
export type SaleOptions = {
  addons: AddonOption[]; window: { date: string; start: string; end: string }; tax: TaxSnapshot; bookings: LinkedBooking[];
  midtrans: { enabled: boolean; client_key: string; environment: "sandbox" | "production"; minutes: number; fees?: PublicFees };
};
export type SaleDetail = { sale: CounterSale; lines: CounterLine[]; booking: LinkedBooking | null };
/** Transaksi kasir yang terhubung ke sebuah booking, untuk detail booking. */
export type BookingSale = { id: string; number: string; status: SaleStatus; method: string; total: number; created_at: string; items: string | null; open_rentals: number };
export type SaleReceiptData = SaleDetail & { venue: ReceiptVenue; settings: ReceiptSettings; cashier: string; printed_at: string };

export const saleMethods: { value: SaleMethod; label: string }[] = [
  { value: "cash", label: "Tunai" }, { value: "transfer", label: "Transfer" }, { value: "qris", label: "QRIS manual" }, { value: "midtrans", label: "Midtrans" },
];
/** Nama metode di daftar, detail, dan nota. */
export const methodName: Record<string, string> = { cash: "Tunai", transfer: "Transfer", qris: "QRIS", midtrans: "Midtrans", va: "Virtual account", ewallet: "E-wallet", card: "Kartu" };
export const saleStatus: Record<SaleStatus, { label: string; pill: string }> = {
  pending: { label: "Menunggu bayar", pill: "wait" }, paid: { label: "Lunas", pill: "done" },
  void: { label: "Dibatalkan", pill: "off" }, expired: { label: "Kedaluwarsa", pill: "off" },
};
const shortTime = (time: string) => time === "24:00" ? "24.00" : time.replace(":", ".");
export const bookingLabel = (booking: Pick<LinkedBooking, "court_name" | "start_time" | "end_time">) => `${booking.court_name} · ${shortTime(booking.start_time)}–${shortTime(booking.end_time)}`;
export const walkInName = "Pelanggan umum";
/** Pilihan lama sewa, kelipatan 30 menit sampai 6 jam. */
export const durations = Array.from({ length: 12 }, (_, index) => (index + 1) * 30);
export const durationLabel = (value: number) => value % 60 ? `${(value / 60).toLocaleString("id-ID")} jam` : `${value / 60} jam`;
/** Pecahan uang tunai yang sering diterima, untuk tombol cepat. */
export function cashPresets(total: number) {
  const notes = [10000, 20000, 50000, 100000];
  const result = new Set<number>([total]);
  for (const note of notes) { const value = Math.ceil(total / note) * note; if (value > total) result.add(value); }
  return [...result].sort((a, b) => a - b).slice(0, 4);
}
