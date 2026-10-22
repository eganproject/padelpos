import { db } from "./store.js";

/**
 * Perhitungan tagihan booking: subtotal (lapangan + tambahan), potongan harga, lalu pajak.
 * Tarif pajak disalin ke setiap booking saat dibuat, jadi mengubah pengaturan pajak tidak
 * mengubah tagihan yang sudah ada. Tarif disimpan dalam basis poin: 1000 = 10%.
 *
 * - Pajak di luar harga: total = subtotal − potongan + pajak.
 * - Pajak sudah termasuk: total = subtotal − potongan, dan pajak adalah bagian dari total itu.
 */
export interface TaxSettings { enabled: boolean; label: string; rate: number; inclusive: boolean }
export interface TaxSnapshot { tax_rate: number; tax_inclusive: number; tax_label: string }

export async function taxSettings(): Promise<TaxSettings> {
  const row = await db.prepare("SELECT document FROM settings WHERE `key`='finance'").get() as { document: string } | undefined;
  const stored = row ? (JSON.parse(row.document) as { tax?: Partial<TaxSettings> }).tax ?? {} : {};
  return { enabled: !!stored.enabled, label: stored.label || "Pajak", rate: stored.rate ?? 0, inclusive: !!stored.inclusive };
}
/** Tarif pajak yang berlaku untuk booking baru. */
export async function taxSnapshot(): Promise<TaxSnapshot> {
  const config = await taxSettings();
  return config.enabled && config.rate > 0
    ? { tax_rate: Math.round(config.rate * 100), tax_inclusive: config.inclusive ? 1 : 0, tax_label: config.label }
    : { tax_rate: 0, tax_inclusive: 0, tax_label: "" };
}
export function billOf(subtotal: number, discount: number, snapshot: Pick<TaxSnapshot, "tax_rate" | "tax_inclusive">) {
  const base = Math.max(0, subtotal - discount);
  const rate = snapshot.tax_rate;
  if (!rate) return { tax: 0, total: base };
  if (snapshot.tax_inclusive) return { tax: Math.round(base * rate / (10000 + rate)), total: base };
  const tax = Math.round(base * rate / 10000);
  return { tax, total: base + tax };
}

/**
 * Bagi `amount` mengikuti perbandingan `weights` dengan hasil bulat yang jumlahnya persis `amount`.
 * Sisa pembulatan diberikan ke porsi dengan pecahan terbesar.
 */
export function allocate(amount: number, weights: number[]) {
  if (weights.length <= 1) return [amount];
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total === amount) return [...weights];
  const base = total > 0 ? weights : weights.map(() => 1);
  const sum = base.reduce((value, weight) => value + weight, 0);
  const shares = base.map(weight => Math.floor(amount * weight / sum));
  const order = base.map((weight, index) => ({ index, rest: amount * weight / sum - shares[index] })).sort((a, b) => b.rest - a.rest);
  for (let left = amount - shares.reduce((value, share) => value + share, 0), i = 0; left > 0; left--, i++) shares[order[i % order.length].index]++;
  return shares;
}

/**
 * Potongan harga member: tarif lapangan dan tarif tambahan dalam basis poin (1000 = 10%), disalin
 * ke booking saat dipesan. Biaya lain yang diketik kasir ("lainnya") tidak ikut didiskon.
 */
export interface MemberRates { member_court_rate: number; member_addon_rate: number }
/** Tarif tetap member per jam: kunci id tarif khusus (`price_rules`) atau `normal` untuk tarif dasar lapangan. */
export type FixedRates = Record<string, number>;
/** Tarif per jam satu slot 30 menit, dan tarif khusus yang berlaku (null = tarif dasar). */
export interface SlotRate { rate: number; rule_id: string | null }
export const fixedKey = (slot: Pick<SlotRate, "rule_id">) => slot.rule_id ?? "normal";
/**
 * Potongan member dari sewa lapangan. Slot yang punya tarif tetap member dibayar dengan tarif itu
 * (tidak pernah lebih mahal dari harga normal); slot lain mendapat diskon persen paket. Tanpa tarif
 * tetap, hasilnya sama dengan diskon persen dari total sewa.
 */
export function memberCourtCut(slots: SlotRate[], courtRate: number, fixed: FixedRates | null) {
  let normal = 0, saved = 0;
  for (const slot of slots) {
    const price = fixed?.[fixedKey(slot)];
    if (price === undefined) normal += slot.rate;
    else saved += slot.rate - Math.min(price, slot.rate);
  }
  return Math.round(saved / 2) + Math.round(Math.round(normal / 2) * courtRate / 10000);
}
/** Potongan member seluruhnya: potongan sewa lapangan (sudah dihitung) ditambah diskon persen tambahan. */
export function memberCut(courtCut: number, addonsTotal: number, rates: Pick<MemberRates, "member_addon_rate">) {
  return courtCut + Math.round(addonsTotal * rates.member_addon_rate / 10000);
}
export const parseFixed = (value: string | null | undefined): FixedRates | null => {
  if (!value) return null;
  try { const parsed = JSON.parse(value) as FixedRates; return Object.keys(parsed).length ? parsed : null; } catch { return null; }
};
/** Jumlah tambahan yang ikut diskon member pada sebuah booking. */
export async function discountableAddons(bookingId: string) {
  return Number((await db.prepare("SELECT COALESCE(SUM(subtotal),0) n FROM booking_addons WHERE booking_id=? AND type<>'lainnya'").get(bookingId) as { n: number }).n);
}
