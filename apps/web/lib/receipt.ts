import type { Booking, Payment } from "./operations";
import type { BookingAddon } from "./addons";

/** Ukuran kertas nota. "custom" memakai `custom_width` dalam milimeter. Sama dengan apps/api/src/receipts.ts. */
export type Paper = "58mm" | "80mm" | "a5" | "a4" | "custom";
export type ReceiptSettings = {
  paper: Paper; custom_width: number; header_note: string; footer_note: string;
  show_payments: boolean; show_cashier: boolean; show_logo: boolean; updated_at?: string | null;
};
export type ReceiptVenue = { name: string; address: string; phone: string; whatsapp: string; email: string; instagram: string; logo?: string | null; show_name?: boolean };
export type ReceiptData = {
  booking: Booking & { code: string; order_code: string | null; source?: "staff" | "online"; created_at?: string };
  addons: BookingAddon[]; payments: Payment[]; venue: ReceiptVenue; settings: ReceiptSettings; cashier: string; printed_at: string;
};

export const paperOptions: { value: Paper; label: string; hint: string }[] = [
  { value: "58mm", label: "Thermal 58 mm", hint: "Printer kasir kecil / Bluetooth" },
  { value: "80mm", label: "Thermal 80 mm", hint: "Printer kasir standar" },
  { value: "a5", label: "A5", hint: "Setengah A4, nota lembar" },
  { value: "a4", label: "A4", hint: "Printer kantor biasa" },
  { value: "custom", label: "Lebar lain", hint: "Tentukan lebar kertas (mm)" },
];
export const paperLabel = (paper: Paper, width: number) => paper === "custom" ? `Lebar ${width} mm` : paperOptions.find(option => option.value === paper)?.label ?? paper;

/** Kertas gulung (thermal atau lebar lain): panjang halaman mengikuti isi nota agar kertas tidak terbuang. */
export const isRoll = (paper: Paper) => paper === "58mm" || paper === "80mm" || paper === "custom";
/** Lebar kertas gulung dalam milimeter. */
export const rollWidth = (paper: Paper, custom: number) => paper === "58mm" ? 58 : paper === "80mm" ? 80 : custom;

/**
 * Aturan @page untuk dialog cetak browser. Kertas gulung memakai panjang hasil ukur isi nota
 * (`heightMm`), sehingga printer thermal memotong tepat di akhir nota. A4/A5 memakai ukuran baku.
 */
export function pageCss(paper: Paper, custom: number, heightMm: number) {
  if (paper === "a4" || paper === "a5") return `@page{size:${paper.toUpperCase()} portrait;margin:12mm}`;
  return `@page{size:${rollWidth(paper, custom)}mm ${Math.max(60, Math.ceil(heightMm))}mm;margin:0}`;
}

export const defaultReceiptSettings: ReceiptSettings = {
  paper: "80mm", custom_width: 76, header_note: "", footer_note: "Terima kasih sudah bermain di tempat kami.", show_payments: true, show_cashier: true, show_logo: true,
};
