/**
 * Tipe dan label keanggotaan, dipakai panel admin, dialog booking, dan halaman akun pelanggan.
 * Diskon disimpan dalam basis poin (1000 = 10%), sama dengan tarif pajak.
 */
export type MemberStatus = "pending_payment" | "pending_approval" | "active" | "frozen" | "cancelled";
export type MemberState = MemberStatus | "expired";
export type PlanBrief = { id: string; name: string; court_discount: number; addon_discount: number; duration_months: number; price: number };
export type Plan = PlanBrief & { description: string; registration_fee: number; online: number; active: number; position: number; created_at: string; members: number };
export type PublicPlan = PlanBrief & { description: string; registration_fee: number };
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
  totals: { bookings: number; saved: number }; unearned: number; account_suggestions: { id: string; name: string; email: string }[];
};
export type LookupMember = Member & { valid: boolean };

export const stateLabel: Record<MemberState, string> = {
  pending_payment: "Belum bayar", pending_approval: "Menunggu persetujuan", active: "Aktif", frozen: "Dibekukan", cancelled: "Dibatalkan", expired: "Berakhir",
};
/** Kelas warna untuk `.status-pill`. */
export const stateTone: Record<MemberState, string> = {
  pending_payment: "wait", pending_approval: "wait", active: "on", frozen: "done", cancelled: "off", expired: "off",
};
/** 1000 → "10%", 1250 → "12,5%". */
export const percentLabel = (bp: number) => `${(bp / 100).toLocaleString("id-ID")}%`;
/** Ringkasan potongan paket: "Lapangan 20% · Tambahan 10%". */
export function discountSummary(plan: Pick<PlanBrief, "court_discount" | "addon_discount">) {
  const parts = [`Lapangan ${percentLabel(plan.court_discount)}`];
  if (plan.addon_discount) parts.push(`Tambahan ${percentLabel(plan.addon_discount)}`);
  return parts.join(" · ");
}
export const monthsLabel = (months: number) => months % 12 === 0 ? `${months / 12} tahun` : `${months} bulan`;
/** Potongan member dengan pembulatan yang sama seperti server (apps/api/src/bill.ts#memberCut). */
export const memberCut = (court: number, addons: number, rates: { court: number; addon: number }) =>
  Math.round(court * rates.court / 10000) + Math.round(addons * rates.addon / 10000);
export const methodName: Record<string, string> = { cash: "Tunai", transfer: "Transfer", qris: "QRIS" };
export const longDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
