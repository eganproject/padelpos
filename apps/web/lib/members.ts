/**
 * Tipe dan label keanggotaan, dipakai panel admin, dialog booking, dan halaman akun pelanggan.
 * Diskon disimpan dalam basis poin (1000 = 10%), sama dengan tarif pajak.
 */
export type MemberStatus = "pending_payment" | "pending_approval" | "active" | "frozen" | "cancelled";
export type MemberState = MemberStatus | "expired";
/** Tarif tetap member per jam: kunci id tarif khusus lapangan, atau `normal` untuk tarif dasar. */
export type FixedRates = Record<string, number>;
export type PlanBrief = {
  id: string; name: string; court_discount: number; addon_discount: number; duration_months: number; price: number;
  /** Batas jam harga member dalam menit; 0 = tanpa batas. */
  daily_minutes?: number; monthly_minutes?: number;
  /** Boleh memesan jam khusus member. */
  member_slots?: number | boolean;
  fixed?: FixedRates | null;
};
export type PlanRate = { rule_key: string; hourly_rate: number };
export type Plan = PlanBrief & { description: string; registration_fee: number; online: number; active: number; position: number; created_at: string; members: number; rates: PlanRate[] };
export type PublicPlan = PlanBrief & { description: string; registration_fee: number; rates?: { label: string; hourly_rate: number }[]; member_slots?: boolean };
export type MemberSlot = { id: string; label: string; days: number[]; start_time: string; end_time: string; court_ids: string[] };
export type Member = {
  id: string; code: string; name: string; phone: string; email: string; status: MemberStatus; state: MemberState; source: "staff" | "online";
  plan: PlanBrief; starts_on: string | null; ends_on: string | null; frozen_on: string | null; days_left: number | null;
  account: { id: string; name: string; email: string } | null; notes: string; cancel_reason: string; refund_amount: number; created_at: string;
};
export type MemberInvoice = {
  id: string; number: string; kind: "daftar" | "perpanjang"; plan_name: string; months: number; dues: number; registration_fee: number;
  tax: number; tax_label: string; tax_rate: number; tax_inclusive: number; amount: number; status: "pending" | "paid" | "cancelled";
  method: string | null; paid_at: string | null; period_start: string | null; period_end: string | null; online: boolean; created_at: string;
  pay_url: string | null; expires_at: number | null;
};
export type MemberSettings = { enabled: boolean; approval: boolean; terms: string; reminder_days: number; updated_at: string | null };
export type MemberStats = { month: string; active: number; frozen: number; expiring: number; waiting: number; joined: number; revenue: number; collected: number; discount: number };
export type MemberDetail = {
  member: Member; invoices: MemberInvoice[];
  bookings: { id: string; code: string; date: string; start_time: string; end_time: string; status: string; total: number; member_discount: number; member_plan: string; court_name: string }[];
  totals: { bookings: number; sales?: number; saved: number }; unearned: number; account_suggestions: { id: string; name: string; email: string }[];
};
/** `quota`: sisa menit harga member pada tanggal main (null = tanpa batas). */
export type LookupMember = Member & { valid: boolean; quota: { day: number | null; month: number | null } | null };

export const stateLabel: Record<MemberState, string> = {
  pending_payment: "Belum bayar", pending_approval: "Menunggu persetujuan", active: "Aktif", frozen: "Dibekukan", cancelled: "Dibatalkan", expired: "Berakhir",
};
/** Kelas warna untuk `.status-pill`. */
export const stateTone: Record<MemberState, string> = {
  pending_payment: "wait", pending_approval: "wait", active: "on", frozen: "done", cancelled: "off", expired: "off",
};
/** 1000 → "10%", 1250 → "12,5%". */
export const percentLabel = (bp: number) => `${(bp / 100).toLocaleString("id-ID")}%`;
export const hoursText = (value: number) => `${(value / 60).toLocaleString("id-ID")} jam`;
/** Ringkasan potongan paket: "Lapangan 20% · Tambahan 10% · tarif tetap · maks 2 jam/hari". */
export function discountSummary(plan: Pick<PlanBrief, "court_discount" | "addon_discount" | "fixed" | "daily_minutes" | "monthly_minutes">) {
  const parts = [`Lapangan ${percentLabel(plan.court_discount)}`];
  if (plan.fixed && Object.keys(plan.fixed).length) parts.push("tarif tetap");
  if (plan.addon_discount) parts.push(`Tambahan ${percentLabel(plan.addon_discount)}`);
  if (plan.daily_minutes) parts.push(`maks ${hoursText(plan.daily_minutes)}/hari`);
  if (plan.monthly_minutes) parts.push(`maks ${hoursText(plan.monthly_minutes)}/bulan`);
  return parts.join(" · ");
}
/** Batas jam harga member: "2 jam per hari · 8 jam per bulan", atau kosong bila tanpa batas. */
export function quotaSummary(plan: Pick<PlanBrief, "daily_minutes" | "monthly_minutes">) {
  return [plan.daily_minutes ? `${hoursText(plan.daily_minutes)} per hari` : "", plan.monthly_minutes ? `${hoursText(plan.monthly_minutes)} per bulan` : ""].filter(Boolean).join(" · ");
}
export const monthsLabel = (months: number) => months % 12 === 0 ? `${months / 12} tahun` : `${months} bulan`;
/** Tarif per jam satu slot 30 menit dan tarif khusus yang berlaku (null = tarif dasar). */
export type SlotRate = { rate: number; rule_id: string | null };
/**
 * Potongan member dari sewa lapangan, sama dengan server (apps/api/src/bill.ts#memberCourtCut): slot
 * dengan tarif tetap member dibayar dengan tarif itu, slot lain diskon persen.
 */
export function memberCourtCut(slots: SlotRate[], courtRate: number, fixed: FixedRates | null | undefined) {
  let normal = 0, saved = 0;
  for (const slot of slots) {
    const price = fixed?.[slot.rule_id ?? "normal"];
    if (price === undefined) normal += slot.rate;
    else saved += slot.rate - Math.min(price, slot.rate);
  }
  return Math.round(saved / 2) + Math.round(Math.round(normal / 2) * courtRate / 10000);
}
/** Potongan member seluruhnya: potongan lapangan ditambah diskon persen tambahan (apps/api/src/bill.ts#memberCut). */
export const memberCut = (courtCut: number, addons: number, addonRate: number) => courtCut + Math.round(addons * addonRate / 10000);
export const parseFixed = (value: string | null | undefined): FixedRates | null => {
  if (!value) return null;
  try { const parsed = JSON.parse(value) as FixedRates; return Object.keys(parsed).length ? parsed : null; } catch { return null; }
};
/** Jam khusus member yang bersinggungan dengan sesi itu (apps/api/src/member-rates.ts#memberOnlyAt). */
export function memberOnlyAt(slots: MemberSlot[] | undefined, courtId: string, date: string, start: string, end: string) {
  if (!slots?.length || !date) return undefined;
  const day = new Date(date + "T12:00:00Z").getUTCDay();
  return slots.find(slot => slot.days.includes(day) && (!slot.court_ids.length || slot.court_ids.includes(courtId)) && slot.start_time < end && slot.end_time > start);
}
export const methodName: Record<string, string> = { cash: "Tunai", transfer: "Transfer", qris: "QRIS" };
export const longDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
