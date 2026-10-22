import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, getUsers, transaction } from "./store.js";
import { check } from "./errors.js";
import { localClock } from "./clock.js";
import { postCashDifference } from "./finance.js";

/**
 * Tutup kasir (shift). Setiap staf membuka shift dengan modal awal di laci, lalu menutupnya dengan
 * menghitung uang fisik. Uang yang seharusnya ada dihitung dari transaksi yang dicatat staf itu sendiri
 * selama shift berjalan:
 *  - pembayaran dan pengembalian booking yang dicatat staf (bukan dari Midtrans),
 *  - transaksi kasir yang dibayar langsung (bukan lewat Midtrans), dan pembatalannya,
 *  - iuran member yang diterima di kasir.
 * Selisih uang tunai dijurnal ke akun Selisih Kas pada hari tutup.
 */

export interface MethodTotal { method: string; received: number; returned: number; net: number; count: number }
export interface ShiftSummary {
  from: string; to: string;
  methods: MethodTotal[];
  sources: { booking: number; booking_refund: number; kasir: number; kasir_void: number; member: number };
  cash_net: number;
}
interface ShiftRow {
  id: string; number: string; user_id: string; opened_at: string; opening_cash: number; open_note: string;
  closed_at: string | null; closed_by: string | null; expected_cash: number | null; counted_cash: number | null; difference: number | null;
  summary: string | null; close_note: string;
}
const columns = "id,number,user_id,opened_at,opening_cash,open_note,closed_at,closed_by,expected_cash,counted_cash,difference,summary,close_note";
const methodOrder = ["cash", "transfer", "qris", "va", "ewallet", "card"];

/** Rekap transaksi seorang staf dalam rentang waktu (stempel ISO, batas atas ikut dihitung). */
export async function summarize(userId: string, from: string, to: string): Promise<ShiftSummary> {
  const totals = new Map<string, MethodTotal>();
  const add = (method: string, received: number, returned: number, count: number) => {
    const row = totals.get(method) ?? { method, received: 0, returned: 0, net: 0, count: 0 };
    row.received += received; row.returned += returned; row.net += received - returned; row.count += count;
    totals.set(method, row);
  };
  const sources = { booking: 0, booking_refund: 0, kasir: 0, kasir_void: 0, member: 0 };
  type Row = { method: string; n: number; amount: number };
  const payments = await db.prepare(`SELECT method,kind,COUNT(*) n,SUM(amount) amount FROM payments
    WHERE created_by=? AND source='staff' AND created_at>=? AND created_at<=? GROUP BY method,kind`).all(userId, from, to) as (Row & { kind: string })[];
  for (const row of payments) {
    const amount = Number(row.amount), count = Number(row.n);
    if (row.kind === "refund") { add(row.method, 0, amount, count); sources.booking_refund += amount; }
    else { add(row.method, amount, 0, count); sources.booking += amount; }
  }
  // Transaksi kasir lewat Midtrans masuk ke rekening, bukan laci, jadi tidak ikut direkap.
  const sales = await db.prepare(`SELECT method,COUNT(*) n,SUM(total) amount FROM counter_sales
    WHERE created_by=? AND pay_order_id IS NULL AND paid_at>=? AND paid_at<=? GROUP BY method`).all(userId, from, to) as Row[];
  for (const row of sales) { add(row.method, Number(row.amount), 0, Number(row.n)); sources.kasir += Number(row.amount); }
  const voids = await db.prepare(`SELECT method,COUNT(*) n,SUM(total) amount FROM counter_sales
    WHERE voided_by=? AND status='void' AND pay_order_id IS NULL AND paid_at IS NOT NULL AND voided_at>=? AND voided_at<=? GROUP BY method`).all(userId, from, to) as Row[];
  for (const row of voids) { add(row.method, 0, Number(row.amount), Number(row.n)); sources.kasir_void += Number(row.amount); }
  const members = await db.prepare(`SELECT method,COUNT(*) n,SUM(amount) amount FROM membership_invoices
    WHERE paid_by=? AND paid_at>=? AND paid_at<=? GROUP BY method`).all(userId, from, to) as Row[];
  for (const row of members) { add(row.method, Number(row.amount), 0, Number(row.n)); sources.member += Number(row.amount); }
  const methods = [...totals.values()].sort((a, b) => (methodOrder.indexOf(a.method) + 99) % 99 - (methodOrder.indexOf(b.method) + 99) % 99);
  return { from, to, methods, sources, cash_net: totals.get("cash")?.net ?? 0 };
}

async function names() { return new Map((await getUsers()).map(user => [user.id, user.name])); }
async function shape(row: ShiftRow, users?: Map<string, string>) {
  users ??= await names();
  const summary = row.summary ? JSON.parse(row.summary) as ShiftSummary : await summarize(row.user_id, row.opened_at, new Date().toISOString());
  return {
    id: row.id, number: row.number, user_id: row.user_id, user_name: users.get(row.user_id) ?? "Staf terhapus",
    opened_at: row.opened_at, opening_cash: Number(row.opening_cash), open_note: row.open_note,
    closed_at: row.closed_at, closed_by_name: row.closed_by ? users.get(row.closed_by) ?? "" : "",
    expected_cash: row.expected_cash === null ? Number(row.opening_cash) + summary.cash_net : Number(row.expected_cash),
    counted_cash: row.counted_cash === null ? null : Number(row.counted_cash),
    difference: row.difference === null ? null : Number(row.difference),
    close_note: row.close_note, summary,
  };
}
async function getShift(id: string) {
  const row = await db.prepare(`SELECT ${columns} FROM cash_shifts WHERE id=?`).get(id) as ShiftRow | undefined;
  check(row, 404, "Shift kasir tidak ditemukan.");
  return row;
}
/** Staf biasa hanya melihat shiftnya sendiri; Super Admin melihat dan boleh menutup shift siapa pun. */
function ensureAccess(row: ShiftRow, actor: { sub: string; role: string }) {
  check(row.user_id === actor.sub || actor.role === "admin", 403, "Shift ini milik staf lain.");
}

export async function shiftOverview(actor: { sub: string; role: string }) {
  const users = await names();
  const open = await db.prepare(`SELECT ${columns} FROM cash_shifts WHERE user_id=? AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`).get(actor.sub) as ShiftRow | undefined;
  const everyone = actor.role === "admin";
  const recent = await db.prepare(`SELECT ${columns} FROM cash_shifts WHERE (?=1 OR user_id=?) ORDER BY opened_at DESC LIMIT 30`).all(everyone ? 1 : 0, actor.sub) as ShiftRow[];
  const shifts = [];
  for (const row of recent) shifts.push(await shape(row, users));
  return { current: open ? await shape(open, users) : null, shifts, all_staff: everyone, ...localClock() };
}

export async function shiftDetail(id: string, actor: { sub: string; role: string }) {
  const row = await getShift(id);
  ensureAccess(row, actor);
  return await shape(row);
}

async function nextNumber(year: string) {
  const last = await db.prepare("SELECT number FROM cash_shifts WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`TK-${year}-%`) as { number: string } | undefined;
  return `TK-${year}-${String(last ? Number(last.number.slice(-5)) + 1 : 1).padStart(5, "0")}`;
}

const money = z.number().int("Nominal harus bilangan bulat.").min(0, "Nominal tidak boleh negatif.").max(1_000_000_000, "Nominal terlalu besar.");
export const openSchema = z.object({ opening_cash: money, note: z.string().trim().max(200, "Catatan maksimal 200 karakter.").default("") });
export async function openShift(input: unknown, actor: { sub: string; role: string }) {
  const data = openSchema.parse(input);
  return await transaction(async () => {
    check(!await db.prepare("SELECT 1 FROM cash_shifts WHERE user_id=? AND closed_at IS NULL").get(actor.sub), 409, "Anda masih punya shift yang belum ditutup.");
    const id = randomUUID(), number = await nextNumber(localClock().date.slice(0, 4));
    await db.prepare("INSERT INTO cash_shifts (id,number,user_id,opened_at,opening_cash,open_note) VALUES (?,?,?,?,?,?)")
      .run(id, number, actor.sub, new Date().toISOString(), data.opening_cash, data.note);
    await audit(actor.sub, "shift.open", id, { number, opening_cash: data.opening_cash });
    return await shape(await getShift(id));
  });
}

export const closeSchema = z.object({ counted_cash: money, note: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default("") });
export async function closeShift(id: string, input: unknown, actor: { sub: string; role: string }) {
  const data = closeSchema.parse(input);
  return await transaction(async () => {
    const row = await getShift(id);
    ensureAccess(row, actor);
    check(!row.closed_at, 409, "Shift ini sudah ditutup.");
    const closedAt = new Date().toISOString();
    const summary = await summarize(row.user_id, row.opened_at, closedAt);
    const expected = Number(row.opening_cash) + summary.cash_net, difference = data.counted_cash - expected;
    check(!difference || data.note.length >= 3, 400, "Ada selisih uang. Isi catatan penyebabnya sebelum menutup shift.");
    const users = await names();
    await postCashDifference({ shift_id: id, number: row.number, difference, actor: actor.sub, name: users.get(row.user_id) ?? "" });
    await db.prepare("UPDATE cash_shifts SET closed_at=?,closed_by=?,expected_cash=?,counted_cash=?,difference=?,summary=?,close_note=? WHERE id=?")
      .run(closedAt, actor.sub, expected, data.counted_cash, difference, JSON.stringify(summary), data.note, id);
    await audit(actor.sub, "shift.close", id, { number: row.number, expected, counted: data.counted_cash, difference });
    return await shape(await getShift(id), users);
  });
}
