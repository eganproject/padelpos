import { api, money } from "./api";

/** Voucher & kode promo. Sama dengan apps/api/src/vouchers.ts. Persen dalam basis poin (1000 = 10%). */
export type VoucherState = "running" | "scheduled" | "ended" | "inactive";
export type Voucher = {
  id: string; code: string; name: string; description: string; kind: "percent" | "amount"; value: number;
  max_discount: number | null; min_order: number; target: "all" | "court"; channel: "all" | "online" | "kasir";
  quota: number | null; per_customer: number | null; starts_on: string | null; ends_on: string | null;
  active: number; created_at: string; updated_at: string;
  used: number; discount_given: number; state: VoucherState; summary: string;
};
export type Redemption = {
  id: string; code: string; order_id: string | null; booking_id: string | null; sale_id: string | null;
  customer: string; phone: string; channel: "online" | "kasir"; amount: number; created_at: string; live: boolean;
  order_code: string | null; sale_number: string | null; booking_status: string | null; sale_status: string | null;
};
export type VoucherCheck = { ok: boolean; code: string; name: string; summary: string; amount: number; message: string };

export const stateLabel: Record<VoucherState, string> = { running: "Berjalan", scheduled: "Terjadwal", ended: "Berakhir", inactive: "Nonaktif" };
export const stateTone: Record<VoucherState, string> = { running: "on", scheduled: "wait", ended: "done", inactive: "off" };
export const channelLabel: Record<Voucher["channel"], string> = { all: "Situs & kasir", online: "Hanya situs", kasir: "Hanya kasir" };
export const percentText = (basisPoints: number) => `${(basisPoints / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
export const valueText = (voucher: Pick<Voucher, "kind" | "value" | "max_discount">) =>
  voucher.kind === "percent" ? `${percentText(voucher.value)}${voucher.max_discount ? ` s.d. ${money(voucher.max_discount)}` : ""}` : money(voucher.value);

/** Periksa kode di kasir sebelum transaksi disimpan; server tetap memeriksa ulang saat menyimpan. */
export const checkVoucher = (body: { code: string; court?: number; extras: number; subtotal: number; cap: number; phone?: string }) =>
  api<{ voucher: VoucherCheck }>("/operations/vouchers/check", { method: "POST", body: JSON.stringify(body) }).then(result => result.voucher);
