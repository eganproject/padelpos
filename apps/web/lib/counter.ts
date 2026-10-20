import type { AddonOption, AddonPricing, BookingAddon } from "./addons";
import type { TaxSnapshot } from "./bill";
import type { ReceiptSettings, ReceiptVenue } from "./receipt";

/** Transaksi langsung di kasir tanpa booking lapangan. Sama dengan apps/api/src/counter.ts. */
export type SaleMethod = "cash" | "transfer" | "qris";
export type CounterSale = {
  id: string; number: string; customer: string; phone: string; date: string; start_time: string; end_time: string;
  subtotal: number; discount: number; discount_note: string; tax: number; tax_rate: number; tax_inclusive: number; tax_label: string;
  total: number; method: SaleMethod; tendered: number | null; status: "paid" | "void"; notes: string; void_reason: string;
  voided_at: string | null; created_at: string;
};
export type CounterLine = {
  id: string; addon_id: string | null; name: string; type: BookingAddon["type"]; pricing: AddonPricing;
  unit_price: number; quantity: number; subtotal: number; returned_at: string | null;
};
export type SaleRow = CounterSale & { open_rentals: number; items: string | null };
export type SaleList = { sales: SaleRow[]; summary: { count: number; total: number; by_method: Partial<Record<SaleMethod, number>> }; date: string; today: string };
export type SaleOptions = { addons: AddonOption[]; window: { date: string; start: string; end: string }; tax: TaxSnapshot };
export type SaleDetail = { sale: CounterSale; lines: CounterLine[] };
export type SaleReceiptData = SaleDetail & { venue: ReceiptVenue; settings: ReceiptSettings; cashier: string; printed_at: string };

export const saleMethods: { value: SaleMethod; label: string }[] = [
  { value: "cash", label: "Tunai" }, { value: "transfer", label: "Transfer" }, { value: "qris", label: "QRIS" },
];
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
