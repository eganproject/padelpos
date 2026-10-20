import { api } from "./api";

/** Sama dengan daftar di API (apps/api/src/addons.ts). */
export const addonCategories = ["raket", "bola", "sepatu", "handuk", "minuman", "pelatih", "dokumentasi", "perlengkapan", "lainnya"] as const;
export type AddonCategory = typeof addonCategories[number];
export type AddonType = "sewa" | "jual" | "layanan";
export type AddonPricing = "per_booking" | "per_hour";

export const categoryLabel: Record<AddonCategory, string> = {
  raket: "Raket", bola: "Bola", sepatu: "Sepatu", handuk: "Handuk", minuman: "Minuman",
  pelatih: "Pelatih", dokumentasi: "Dokumentasi", perlengkapan: "Perlengkapan", lainnya: "Lainnya",
};
export const typeLabel: Record<AddonType, string> = { sewa: "Sewa", jual: "Jual", layanan: "Layanan" };
/** Istilah untuk pelanggan: "Jual" terdengar seperti pelanggan yang menjual. */
export const shopTypeLabel: Record<AddonType, string> = { sewa: "Disewakan", jual: "Beli", layanan: "Layanan" };
export const typeHint: Record<AddonType, string> = {
  sewa: "Dipinjam selama jam main lalu dikembalikan.",
  jual: "Habis pakai atau dibawa pulang.",
  layanan: "Jasa, mis. pelatih atau wasit.",
};

/** Item katalog untuk admin. */
export type Addon = {
  id: string; name: string; category: AddonCategory; type: AddonType; pricing: AddonPricing; price: number;
  stock: number | null; low_stock: number; max_per_booking: number; description: string;
  active: number; online: number; position: number; photo_id: string | null; in_use: boolean;
};
/** Pilihan saat booking. `available` null berarti tidak dibatasi. */
export type AddonOption = {
  id: string; name: string; category: AddonCategory; type: AddonType; pricing: AddonPricing; price: number;
  description: string; photo_id: string | null; max_per_booking: number; available: number | null; online?: boolean;
};
export type BookingAddon = {
  id: string; addon_id: string | null; name: string; type: AddonType | "lainnya"; pricing: AddonPricing;
  unit_price: number; quantity: number; subtotal: number; returned_at: string | null;
};
export type StockMove = {
  id: string; delta: number; reason: "awal" | "restok" | "koreksi" | "rusak" | "terpakai" | "kembali"; note: string;
  booking_id: string | null; sale_id?: string | null; sale_number?: string | null; booking_customer: string | null; stock_after: number; actor: string; created_at: string;
};
export type AddonSummary = {
  since: string; revenue: number; today: number;
  top: { addon_id: string | null; name: string; type: AddonType | "lainnya"; quantity: number; revenue: number; bookings: number }[];
  low_stock: { id: string; name: string; type: AddonType; stock: number; low_stock: number }[];
};

/** Barang sewa yang sedang dibawa pelanggan, dari booking (`booking`) atau transaksi kasir (`kasir`). */
export type UnreturnedRental = {
  id: string; source: "booking" | "kasir"; ref_id: string; name: string; quantity: number; customer: string; phone: string;
  date: string; start_time: string; end_time: string; court_name: string | null; sale_number: string;
};

/** `walkIn`: transaksi kasir tanpa booking, sewa sekali bayar disebut "per sewa". */
export const unitLabel = (type: AddonType | "lainnya", pricing: AddonPricing, walkIn = false) =>
  pricing === "per_hour" ? "per jam" : type === "jual" || type === "lainnya" ? "per pcs" : walkIn ? "per sewa" : "per booking";

/** Sama dengan server: harga per jam dikali durasi main. */
export const lineTotal = (price: number, quantity: number, pricing: AddonPricing, duration: number) =>
  pricing === "per_hour" ? Math.round(price * quantity * duration / 60) : price * quantity;

/** Batas jumlah yang boleh dipilih. `keep` menjaga jumlah lama agar tidak dipaksa turun. */
export const maxFor = (option: Pick<AddonOption, "max_per_booking" | "available">, keep = 0) =>
  Math.max(keep, Math.min(option.max_per_booking, option.available ?? option.max_per_booking));

export function stockLabel(addon: Pick<Addon, "type" | "stock">) {
  if (addon.stock === null) return "Tidak dibatasi";
  return addon.type === "jual" ? `${addon.stock} tersisa` : addon.type === "sewa" ? `${addon.stock} unit` : `${addon.stock} sekaligus`;
}
export const isLowStock = (addon: Pick<Addon, "type" | "stock" | "low_stock">) =>
  addon.stock !== null && (addon.stock === 0 || (addon.type === "jual" && addon.stock <= addon.low_stock));

/** Catatan singkat bila stok untuk jam yang dipilih tinggal sedikit. */
export function availabilityNote(option: Pick<AddonOption, "type" | "available">) {
  if (option.available === null || option.available > 3) return "";
  if (option.available === 0) return option.type === "jual" ? "Stok habis" : "Habis di jam ini";
  return option.type === "jual" ? `Sisa ${option.available}` : `Tersisa ${option.available} di jam ini`;
}

export const fetchAddonOptions = (date: string, start: string, end: string) =>
  api<{ addons: AddonOption[] }>(`/public/addons?date=${encodeURIComponent(date)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
