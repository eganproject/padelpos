import { db } from "./store.js";
import { check } from "./errors.js";
import type { MemberRates } from "./bill.js";

/**
 * Tarif member yang disalin ke booking. Modul ini sengaja kecil dan hanya membaca tabel, agar
 * operations.ts dan payments.ts bisa memakainya tanpa lingkaran impor dengan membership.ts.
 *
 * Harga member berlaku bila keanggotaan aktif (bukan dibekukan) pada TANGGAL MAIN, bukan hanya
 * hari ini: member yang masa berlakunya habis minggu depan tidak bisa memesan bulan depan
 * dengan harga member.
 */
export interface BookingMember extends MemberRates { membership_id: string; member_plan: string }
export const noMember = { membership_id: null, member_plan: "", member_court_rate: 0, member_addon_rate: 0 } as const;

interface Row { id: string; code: string; name: string; status: string; starts_on: string | null; ends_on: string | null; plan_name: string; court_discount: number; addon_discount: number }
const select = `SELECT m.id,m.code,m.name,m.status,m.starts_on,m.ends_on,p.name plan_name,p.court_discount,p.addon_discount
  FROM memberships m JOIN membership_plans p ON p.id=m.plan_id`;
const validOn = (row: Row, date: string) => row.status === "active" && !!row.starts_on && !!row.ends_on && row.starts_on <= date && date <= row.ends_on;
const ratesOf = (row: Row): BookingMember => ({ membership_id: row.id, member_plan: row.plan_name, member_court_rate: row.court_discount, member_addon_rate: row.addon_discount });

/** Tarif untuk keanggotaan pilihan kasir. Galat bila tidak aktif pada tanggal main. */
export async function memberRatesFor(membershipId: string, date: string): Promise<BookingMember> {
  const row = await db.prepare(select + " WHERE m.id=?").get(membershipId) as Row | undefined;
  check(row, 404, "Member tidak ditemukan.");
  check(row.status !== "frozen", 409, `Keanggotaan ${row.name} (${row.code}) sedang dibekukan.`);
  check(validOn(row, date), 409, row.status === "active" && row.ends_on
    ? `Keanggotaan ${row.name} (${row.code}) hanya berlaku ${row.starts_on} s.d. ${row.ends_on}, tidak mencakup tanggal main ${date}.`
    : `Keanggotaan ${row.name} (${row.code}) belum aktif.`);
  return ratesOf(row);
}
/** Tarif untuk pelanggan yang memesan sendiri lewat akunnya, atau null bila bukan member pada tanggal itu. */
export async function accountMember(accountId: string | null, date: string): Promise<BookingMember | null> {
  if (!accountId) return null;
  const row = await db.prepare(select + " WHERE m.account_id=? AND m.status<>'cancelled'").get(accountId) as Row | undefined;
  return row && validOn(row, date) ? ratesOf(row) : null;
}
