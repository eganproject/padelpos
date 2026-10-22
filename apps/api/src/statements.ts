import { db } from "./store.js";
import { check } from "./errors.js";
import { accounts, balanceOf, movements, periodOf, shiftDay, type Account } from "./finance.js";

/**
 * Laporan keuangan tambahan dari jurnal yang sama dengan laba rugi dan neraca:
 * - Arus kas metode langsung: setiap jurnal yang menyentuh akun kas/bank dibaca dari akun lawannya.
 *   Karena jurnal selalu seimbang, perubahan kas satu jurnal sama persis dengan jumlah (kredit − debit)
 *   akun-akun lawannya, jadi tidak ada angka yang ditebak.
 * - Neraca saldo: saldo awal, mutasi debit/kredit, dan saldo akhir setiap akun.
 */
type Activity = "operasi" | "investasi" | "pendanaan";
const activityLabel: Record<Activity, string> = { operasi: "Aktivitas operasi", investasi: "Aktivitas investasi", pendanaan: "Aktivitas pendanaan" };
/** Akun liabilitas buatan sistem (utang usaha, pajak, iuran di muka) adalah operasi; liabilitas buatan admin dianggap pinjaman. */
function activityOf(account: Account, source: string): Activity {
  if (source === "aset") return "investasi";
  if (source === "modal") return "pendanaan";
  if (account.subtype === "aset_tetap") return "investasi";
  if (account.type === "ekuitas") return "pendanaan";
  if (account.type === "liabilitas" && !account.system_key) return "pendanaan";
  return "operasi";
}
/** Nama baris yang lebih mudah dibaca untuk akun lawan yang paling sering muncul. */
const friendly: Record<string, string> = {
  piutang: "Penerimaan dari pelanggan booking",
  utang: "Pembayaran ke pemasok",
  modal: "Setoran / penarikan modal pemilik",
  prive: "Pengambilan pribadi pemilik",
  beban_gateway: "Potongan payment gateway",
};

export async function cashFlow(input: unknown) {
  const { from, to } = periodOf(input);
  const all = await accounts();
  const byId = new Map(all.map(account => [account.id, account]));
  const cash = all.filter(account => account.is_cash);
  const before = await movements(null, shiftDay(from, -1)), after = await movements(null, to);
  const opening = cash.reduce((sum, account) => sum + balanceOf(account, before), 0);
  const closing = cash.reduce((sum, account) => sum + balanceOf(account, after), 0);
  const lines = await db.prepare(`SELECT l.entry_id,e.source,l.account_id,l.debit,l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
    WHERE e.date>=? AND e.date<=? AND e.id IN (SELECT l2.entry_id FROM journal_lines l2 JOIN accounts a ON a.id=l2.account_id WHERE a.is_cash=1)`).all(from, to) as
    { entry_id: string; source: string; account_id: string; debit: number; credit: number }[];
  const rows = new Map<string, { activity: Activity; account_id: string; code: string; name: string; inflow: number; outflow: number }>();
  for (const line of lines) {
    const account = byId.get(line.account_id);
    if (!account || account.is_cash) continue;
    const effect = Number(line.credit) - Number(line.debit);
    if (!effect) continue;
    const activity = activityOf(account, line.source);
    const key = `${activity}:${account.id}`;
    const row = rows.get(key) ?? { activity, account_id: account.id, code: account.code, name: (account.system_key && friendly[account.system_key]) || account.name, inflow: 0, outflow: 0 };
    if (effect > 0) row.inflow += effect; else row.outflow -= effect;
    rows.set(key, row);
  }
  const sections = (Object.keys(activityLabel) as Activity[]).map(activity => {
    const items = [...rows.values()].filter(row => row.activity === activity)
      .map(row => ({ ...row, net: row.inflow - row.outflow }))
      .filter(row => row.net !== 0 || row.inflow !== 0)
      .sort((a, b) => b.net - a.net);
    return { key: activity, label: activityLabel[activity], rows: items, inflow: items.reduce((sum, row) => sum + row.inflow, 0), outflow: items.reduce((sum, row) => sum + row.outflow, 0), net: items.reduce((sum, row) => sum + row.net, 0) };
  });
  const net = sections.reduce((sum, section) => sum + section.net, 0);
  return {
    from, to, opening, closing, net, sections,
    cash_accounts: cash.map(account => ({ id: account.id, code: account.code, name: account.name, opening: balanceOf(account, before), closing: balanceOf(account, after) })).filter(row => row.opening || row.closing),
    difference: opening + net - closing,
  };
}

export async function trialBalance(input: unknown) {
  const { from, to } = periodOf(input);
  const all = await accounts();
  const before = await movements(null, shiftDay(from, -1)), period = await movements(from, to);
  const side = (amount: number) => ({ debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0 });
  const rows = all.map(account => {
    const start = before.get(account.id), moved = period.get(account.id);
    const openingNet = Number(start?.debit ?? 0) - Number(start?.credit ?? 0);
    const debit = Number(moved?.debit ?? 0), credit = Number(moved?.credit ?? 0);
    const closingNet = openingNet + debit - credit;
    return { id: account.id, code: account.code, name: account.name, type: account.type, opening: side(openingNet), debit, credit, closing: side(closingNet) };
  }).filter(row => row.opening.debit || row.opening.credit || row.debit || row.credit || row.closing.debit || row.closing.credit);
  const total = (pick: (row: typeof rows[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const totals = {
    opening_debit: total(row => row.opening.debit), opening_credit: total(row => row.opening.credit),
    debit: total(row => row.debit), credit: total(row => row.credit),
    closing_debit: total(row => row.closing.debit), closing_credit: total(row => row.closing.credit),
  };
  return { from, to, rows, totals, balanced: totals.debit === totals.credit && totals.closing_debit === totals.closing_credit };
}

// --- Laporan operasional ------------------------------------------------------

const minutes = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };
const played = "b.status IN ('confirmed','completed')";
const dayList = (from: string, to: string) => {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
};

/**
 * Okupansi per lapangan dan per jam, pendapatan per lapangan, pelanggan teratas, pemakaian voucher,
 * dan penjualan per barang. Booking yang dihitung hanya yang terkonfirmasi atau selesai.
 */
export async function operationsReport(input: unknown) {
  const { from, to } = periodOf(input);
  const span = dayList(from, to);
  check(span.length <= 366, 400, "Pilih rentang paling lama satu tahun.");

  const courts = await db.prepare("SELECT id,name,opens_at,closes_at,active FROM courts ORDER BY name").all() as { id: string; name: string; opens_at: string; closes_at: string; active: number }[];
  const bookings = await db.prepare(`SELECT b.court_id,b.date,b.start_time,b.end_time,b.court_total,b.total,b.tax,
      b.discount+b.member_discount+b.voucher_discount discounts,
      COALESCE((SELECT SUM(subtotal) FROM booking_addons WHERE booking_id=b.id),0) addons
    FROM bookings b WHERE ${played} AND b.date>=? AND b.date<=?`).all(from, to) as
    { court_id: string; date: string; start_time: string; end_time: string; court_total: number; total: number; tax: number; discounts: number; addons: number }[];
  const blocked = await db.prepare("SELECT court_id,start_time,end_time FROM maintenance WHERE date>=? AND date<=?").all(from, to) as { court_id: string; start_time: string; end_time: string }[];

  const perCourt = courts.map(court => {
    const own = bookings.filter(row => row.court_id === court.id);
    const open = Math.max(0, minutes(court.closes_at) - minutes(court.opens_at)) * span.length
      - blocked.filter(row => row.court_id === court.id).reduce((sum, row) => sum + Math.max(0, minutes(row.end_time) - minutes(row.start_time)), 0);
    const booked = own.reduce((sum, row) => sum + Math.max(0, minutes(row.end_time) - minutes(row.start_time)), 0);
    return {
      id: court.id, name: court.name, active: !!court.active, sessions: own.length,
      booked_hours: Math.round(booked / 6) / 10, open_hours: Math.round(Math.max(0, open) / 6) / 10,
      occupancy: open > 0 ? Math.round(booked / open * 1000) / 10 : 0,
      court_revenue: own.reduce((sum, row) => sum + Number(row.court_total), 0),
      addon_revenue: own.reduce((sum, row) => sum + Number(row.addons), 0),
      discounts: own.reduce((sum, row) => sum + Number(row.discounts), 0),
      total: own.reduce((sum, row) => sum + Number(row.total) - Number(row.tax), 0),
    };
  }).filter(row => row.active || row.sessions);

  // Peta panas jam × hari: menit terisi dibagi menit buka seluruh lapangan aktif pada jam itu.
  const weekdays = span.map(day => new Date(day + "T00:00:00Z").getUTCDay());
  const active = courts.filter(court => court.active);
  const firstHour = Math.min(...active.map(court => Math.floor(minutes(court.opens_at) / 60)), 24);
  const lastHour = Math.max(...active.map(court => Math.ceil(minutes(court.closes_at) / 60)), 0);
  const hours = firstHour < lastHour ? Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index) : [];
  const heat = hours.map(hour => {
    const cells = Array.from({ length: 7 }, (_, weekday) => {
      const dayCount = weekdays.filter(day => day === weekday).length;
      const capacity = active.reduce((sum, court) => sum + Math.max(0, Math.min(minutes(court.closes_at), (hour + 1) * 60) - Math.max(minutes(court.opens_at), hour * 60)), 0) * dayCount;
      const used = bookings.reduce((sum, row) => {
        if (new Date(row.date + "T00:00:00Z").getUTCDay() !== weekday) return sum;
        return sum + Math.max(0, Math.min(minutes(row.end_time), (hour + 1) * 60) - Math.max(minutes(row.start_time), hour * 60));
      }, 0);
      return capacity > 0 ? Math.round(used / capacity * 100) : null;
    });
    return { hour: `${String(hour).padStart(2, "0")}:00`, cells };
  });

  const customers = await db.prepare(`SELECT COALESCE(b.customer_id,b.phone) \`key\`,MAX(b.customer) name,MAX(b.phone) phone,count(*) sessions,
      SUM(TIME_TO_SEC(TIMEDIFF(IF(b.end_time='24:00','23:59:59',CONCAT(b.end_time,':00')),CONCAT(b.start_time,':00'))))/3600 hours,
      SUM(b.total-b.tax) spend,MAX(b.date) last_date
    FROM bookings b WHERE ${played} AND b.date>=? AND b.date<=? GROUP BY \`key\` ORDER BY spend DESC LIMIT 15`).all(from, to) as
    { key: string; name: string; phone: string; sessions: number; hours: number; spend: number; last_date: string }[];

  const vouchers = await db.prepare(`SELECT v.id,v.code,v.name,v.active,count(r.id) uses,COALESCE(SUM(r.amount),0) discount,count(DISTINCT COALESCE(r.customer_id,r.phone)) customers,
      SUM(r.channel='online') online
    FROM voucher_redemptions r JOIN vouchers v ON v.id=r.voucher_id
    WHERE LEFT(r.created_at,10)>=? AND LEFT(r.created_at,10)<=? GROUP BY v.id,v.code,v.name,v.active ORDER BY uses DESC`).all(from, to) as
    { id: string; code: string; name: string; active: number; uses: number; discount: number; customers: number; online: number }[];

  const items = await db.prepare(`SELECT addon_id,MAX(name) name,MAX(type) type,SUM(quantity) quantity,SUM(subtotal) revenue,SUM(unit_cost*quantity) cost,SUM(source='kasir') kasir_lines FROM (
      SELECT a.addon_id,a.name,a.type,a.quantity,a.subtotal,a.unit_cost,'booking' source FROM booking_addons a JOIN bookings b ON b.id=a.booking_id WHERE ${played} AND b.date>=? AND b.date<=?
      UNION ALL
      SELECT l.addon_id,l.name,l.type,l.quantity,l.subtotal,l.unit_cost,'kasir' source FROM counter_sale_lines l JOIN counter_sales s ON s.id=l.sale_id WHERE s.status='paid' AND s.date>=? AND s.date<=?
    ) x GROUP BY addon_id ORDER BY revenue DESC`).all(from, to, from, to) as
    { addon_id: string | null; name: string; type: string; quantity: number; revenue: number; cost: number; kasir_lines: number }[];

  const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + Number(pick(row)), 0);
  const bookedMinutes = sum(perCourt, row => row.booked_hours * 60), openMinutes = sum(perCourt, row => row.open_hours * 60);
  return {
    from, to, days: span.length,
    summary: {
      sessions: bookings.length, booked_hours: Math.round(bookedMinutes / 6) / 10,
      occupancy: openMinutes > 0 ? Math.round(bookedMinutes / openMinutes * 1000) / 10 : 0,
      court_revenue: sum(perCourt, row => row.court_revenue), revenue: sum(perCourt, row => row.total),
      voucher_uses: sum(vouchers, row => row.uses), voucher_discount: sum(vouchers, row => row.discount),
      item_revenue: sum(items, row => row.revenue),
    },
    courts: perCourt, heat,
    customers: customers.map(row => ({ ...row, sessions: Number(row.sessions), hours: Math.round(Number(row.hours) * 10) / 10, spend: Number(row.spend) })),
    vouchers: vouchers.map(row => ({ ...row, uses: Number(row.uses), discount: Number(row.discount), customers: Number(row.customers), online: Number(row.online) })),
    items: items.map(row => ({ addon_id: row.addon_id, name: row.name, type: row.type, quantity: Number(row.quantity), revenue: Number(row.revenue), cost: Number(row.cost), margin: Number(row.revenue) - Number(row.cost) })),
  };
}
