import { db } from "./store.js";
import { check } from "./errors.js";
import { minutes } from "./clock.js";
import { type FixedRates, type MemberRates, type SlotRate, memberCourtCut } from "./bill.js";

/**
 * Tarif member yang disalin ke booking. Modul ini sengaja kecil dan hanya membaca tabel, agar
 * operations.ts dan payments.ts bisa memakainya tanpa lingkaran impor dengan membership.ts.
 *
 * Harga member berlaku bila keanggotaan aktif (bukan dibekukan) pada TANGGAL MAIN, bukan hanya
 * hari ini: member yang masa berlakunya habis minggu depan tidak bisa memesan bulan depan
 * dengan harga member.
 *
 * Harga lapangan member: tarif tetap per jam bila paket punya tarif tetap untuk tarif slot itu,
 * selain itu diskon persen paket. Paket boleh membatasi jam main dengan harga member per hari
 * dan per bulan; sesi yang melewati batas tetap boleh dipesan dengan harga normal.
 */
export interface BookingMember extends MemberRates {
  membership_id: string; member_plan: string; plan_id: string; fixed: FixedRates | null;
  daily_minutes: number; monthly_minutes: number; slot_access: boolean;
}
export const noMember = { membership_id: null, member_plan: "", member_court_rate: 0, member_addon_rate: 0, fixed: null } as const;

interface Row {
  id: string; code: string; name: string; status: string; starts_on: string | null; ends_on: string | null; plan_id: string; plan_name: string;
  court_discount: number; addon_discount: number; daily_minutes: number; monthly_minutes: number; member_slots: number;
}
const select = `SELECT m.id,m.code,m.name,m.status,m.starts_on,m.ends_on,p.id plan_id,p.name plan_name,p.court_discount,p.addon_discount,p.daily_minutes,p.monthly_minutes,p.member_slots
  FROM memberships m JOIN membership_plans p ON p.id=m.plan_id`;
const validOn = (row: Row, date: string) => row.status === "active" && !!row.starts_on && !!row.ends_on && row.starts_on <= date && date <= row.ends_on;

/** Tarif tetap paket, atau null bila paket hanya memakai diskon persen. */
export async function planFixedRates(planId: string): Promise<FixedRates | null> {
  const rows = await db.prepare("SELECT rule_key,hourly_rate FROM membership_plan_rates WHERE plan_id=?").all(planId) as { rule_key: string; hourly_rate: number }[];
  return rows.length ? Object.fromEntries(rows.map(row => [row.rule_key, Number(row.hourly_rate)])) : null;
}
const ratesOf = async (row: Row): Promise<BookingMember> => ({
  membership_id: row.id, member_plan: row.plan_name, plan_id: row.plan_id, member_court_rate: row.court_discount, member_addon_rate: row.addon_discount,
  fixed: await planFixedRates(row.plan_id), daily_minutes: row.daily_minutes, monthly_minutes: row.monthly_minutes, slot_access: !!row.member_slots,
});

/** Tarif untuk keanggotaan pilihan kasir. Galat bila tidak aktif pada tanggal main. */
export async function memberRatesFor(membershipId: string, date: string, what = "tanggal main"): Promise<BookingMember> {
  const row = await db.prepare(select + " WHERE m.id=?").get(membershipId) as Row | undefined;
  check(row, 404, "Member tidak ditemukan.");
  check(row.status !== "frozen", 409, `Keanggotaan ${row.name} (${row.code}) sedang dibekukan.`);
  check(validOn(row, date), 409, row.status === "active" && row.ends_on
    ? `Keanggotaan ${row.name} (${row.code}) hanya berlaku ${row.starts_on} s.d. ${row.ends_on}, tidak mencakup ${what} ${date}.`
    : `Keanggotaan ${row.name} (${row.code}) belum aktif.`);
  return await ratesOf(row);
}
/** Keanggotaan yang berlaku pada tanggal itu, atau null. Untuk pindah jadwal booking yang sudah memakai harga member. */
export async function memberOn(membershipId: string, date: string): Promise<BookingMember | null> {
  const row = await db.prepare(select + " WHERE m.id=?").get(membershipId) as Row | undefined;
  return row && validOn(row, date) ? await ratesOf(row) : null;
}
/** Tarif untuk pelanggan yang memesan sendiri lewat akunnya, atau null bila bukan member pada tanggal itu. */
export async function accountMember(accountId: string | null, date: string): Promise<BookingMember | null> {
  if (!accountId) return null;
  const row = await db.prepare(select + " WHERE m.account_id=? AND m.status<>'cancelled'").get(accountId) as Row | undefined;
  return row && validOn(row, date) ? await ratesOf(row) : null;
}

// --- Kuota jam harga member -----------------------------------------------------------

const hours = (value: number) => `${(value / 60).toLocaleString("id-ID")} jam`;
/** Menit main dengan harga lapangan member pada tanggal itu dan pada bulannya. */
export async function memberUse(membershipId: string, date: string, exclude: string | null = null) {
  const rows = await db.prepare(`SELECT date,start_time,end_time FROM bookings WHERE membership_id=? AND member_court_cut>0 AND id<>COALESCE(?,'') AND date LIKE ?
    AND (status IN ('confirmed','completed') OR (status='pending' AND hold_expires_at>UNIX_TIMESTAMP()))`).all(membershipId, exclude, `${date.slice(0, 7)}-%`) as { date: string; start_time: string; end_time: string }[];
  let day = 0, month = 0;
  for (const row of rows) {
    const length = minutes(row.end_time) - minutes(row.start_time);
    month += length;
    if (row.date === date) day += length;
  }
  return { day, month };
}
/** Sisa kuota (menit) pada tanggal itu; null = tanpa batas. */
export async function quotaLeft(member: Pick<BookingMember, "membership_id" | "daily_minutes" | "monthly_minutes">, date: string) {
  if (!member.daily_minutes && !member.monthly_minutes) return { day: null, month: null };
  const use = await memberUse(member.membership_id, date);
  return {
    day: member.daily_minutes ? Math.max(0, member.daily_minutes - use.day) : null,
    month: member.monthly_minutes ? Math.max(0, member.monthly_minutes - use.month) : null,
  };
}

export interface CourtPricing { member_court_rate: number; member_fixed: string | null; court_cut: number; note: string }
const noCut: CourtPricing = { member_court_rate: 0, member_fixed: null, court_cut: 0, note: "" };
/**
 * Potongan sewa lapangan member untuk satu sesi, dengan batas jam paketnya. `pending` adalah menit
 * harga member dari sesi lain di keranjang yang sama yang belum tersimpan. Lewat batas berarti sesi
 * ini memakai harga lapangan normal; diskon tambahan (raket, bola) tetap berlaku.
 */
export async function courtPricing(member: BookingMember | null, slots: SlotRate[], date: string, exclude: string | null = null, pending = { day: 0, month: 0 }): Promise<CourtPricing> {
  if (!member) return noCut;
  const cut = memberCourtCut(slots, member.member_court_rate, member.fixed);
  const priced: CourtPricing = { member_court_rate: member.member_court_rate, member_fixed: member.fixed ? JSON.stringify(member.fixed) : null, court_cut: cut, note: "" };
  if (!cut || (!member.daily_minutes && !member.monthly_minutes)) return priced;
  const length = slots.length * 30, use = await memberUse(member.membership_id, date, exclude);
  const day = use.day + pending.day, month = use.month + pending.month;
  if (member.daily_minutes && day + length > member.daily_minutes)
    return { ...noCut, note: `Kuota harga member ${hours(member.daily_minutes)} per hari${day ? ` sudah terpakai ${hours(day)}` : ""} pada tanggal ini, jadi sewa lapangan sesi ini memakai harga normal.` };
  if (member.monthly_minutes && month + length > member.monthly_minutes)
    return { ...noCut, note: `Kuota harga member ${hours(member.monthly_minutes)} per bulan${month ? ` sudah terpakai ${hours(month)}` : ""}, jadi sewa lapangan sesi ini memakai harga normal.` };
  return priced;
}

// --- Jam khusus member ------------------------------------------------------------------

export interface MemberSlot { id: string; label: string; days: number[]; start_time: string; end_time: string; court_ids: string[]; created_at: string }
export async function memberSlots(): Promise<MemberSlot[]> {
  const rows = await db.prepare("SELECT * FROM member_slots ORDER BY start_time,created_at").all() as (Omit<MemberSlot, "days" | "court_ids"> & { days: string; court_ids: string })[];
  return rows.map(row => ({ ...row, days: JSON.parse(row.days) as number[], court_ids: JSON.parse(row.court_ids) as string[] }));
}
const weekday = (date: string) => new Date(date + "T12:00:00Z").getUTCDay();
/** Jam khusus member yang bersinggungan dengan sesi itu. */
export function memberOnlyAt(slots: MemberSlot[], courtId: string, date: string, start: string, end: string) {
  const day = weekday(date);
  return slots.find(slot => slot.days.includes(day) && (!slot.court_ids.length || slot.court_ids.includes(courtId)) && slot.start_time < end && slot.end_time > start);
}
/** Pesan bila sesi berada di jam khusus member dan pemesannya tidak berhak; kosong bila boleh. */
export async function memberSlotProblem(courtId: string, date: string, start: string, end: string, member: Pick<BookingMember, "slot_access"> | null, staff = false) {
  const slot = memberOnlyAt(await memberSlots(), courtId, date, start, end);
  if (!slot || member?.slot_access) return "";
  const window = `${slot.start_time}–${slot.end_time}`;
  if (member) return `${slot.label} (${window}) khusus member, dan paket ${staff ? "member ini" : "Anda"} tidak termasuk.`;
  return staff ? `${slot.label} (${window}) khusus member. Pilih member yang berlaku, atau pilih jam lain.`
    : `${slot.label} (${window}) khusus member. Masuk dengan akun member untuk memesan jam ini.`;
}
export async function ensureMemberSlot(courtId: string, date: string, start: string, end: string, member: Pick<BookingMember, "slot_access"> | null) {
  const problem = await memberSlotProblem(courtId, date, start, end, member, true);
  check(!problem, 409, problem);
}
