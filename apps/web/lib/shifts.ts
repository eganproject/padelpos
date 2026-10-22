import { money } from "./api";

/** Tutup kasir. Sama dengan apps/api/src/shifts.ts. */
export type MethodTotal = { method: string; received: number; returned: number; net: number; count: number };
export type ShiftSummary = {
  from: string; to: string; methods: MethodTotal[];
  sources: { booking: number; booking_refund: number; kasir: number; kasir_void: number; member: number };
  cash_net: number;
};
export type Shift = {
  id: string; number: string; user_id: string; user_name: string; opened_at: string; opening_cash: number; open_note: string;
  closed_at: string | null; closed_by_name: string; expected_cash: number; counted_cash: number | null; difference: number | null;
  close_note: string; summary: ShiftSummary;
};
export type ShiftOverview = { current: Shift | null; shifts: Shift[]; all_staff: boolean; date: string; time: string };

/** Asal uang dalam satu shift, untuk rincian di layar dan rekap cetak. */
export const shiftSources = (summary: ShiftSummary) => [
  { label: "Pembayaran booking", amount: summary.sources.booking, sign: 1 },
  { label: "Pengembalian booking", amount: summary.sources.booking_refund, sign: -1 },
  { label: "Transaksi kasir", amount: summary.sources.kasir, sign: 1 },
  { label: "Transaksi kasir dibatalkan", amount: summary.sources.kasir_void, sign: -1 },
  { label: "Iuran member", amount: summary.sources.member, sign: 1 },
];
export const differenceLabel = (difference: number) =>
  difference === 0 ? "Uang pas, tidak ada selisih" : `${difference < 0 ? "Kurang" : "Lebih"} ${money(Math.abs(difference))}`;
