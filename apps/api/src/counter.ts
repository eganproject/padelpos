import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, transaction } from "./store.js";
import { check } from "./errors.js";
import { clockLabel, localClock, minutes } from "./clock.js";
import { type Addon, addons, lineSchema, lineTotal, peakUse, recordMove } from "./addons.js";
import { billOf, memberCut, taxSnapshot } from "./bill.js";
import { memberRatesFor } from "./member-rates.js";
import { syncCounterSale } from "./finance.js";
import {
  createSnapTransaction, expireTransaction, fetchTransactionStatus, gatewayFee, outcomeOf, paymentConfig, paymentMethod, pickChannel, publicFees,
  snapPayments, surchargeFor, surchargeItem, type ChannelKey, type MidtransStatus,
} from "./midtrans.js";
import { normalizePhone } from "./payments.js";
import { publicUrl } from "./config.js";

/**
 * Transaksi langsung di kasir tanpa booking lapangan: pelanggan datang menyewa raket untuk
 * latihan sendiri, membeli bola atau minuman, atau memakai pelatih tanpa memesan lapangan.
 *
 * - Tunai, transfer, atau QRIS manual lunas saat dicatat, jadi jurnalnya langsung masuk kas.
 * - Midtrans: transaksi menunggu bayar (stok sudah dipegang) sampai webhook atau tombol periksa status
 *   mengonfirmasi lunas. Tidak dibayar sampai batas waktunya berarti kedaluwarsa dan stok kembali.
 * - Pelanggan dikenali (`customer_id`) bila dipilih dari riwayat atau diisi nomor teleponnya, dan
 *   transaksi bisa dihubungkan ke booking lapangan hari ini; jam sewanya lalu mengikuti jam booking.
 * - Barang sewa memegang unit dari jam transaksi sampai `end_time`, dihitung bersama booking
 *   lapangan (lihat peakUse), dan dilepas lebih awal begitu ditandai kembali.
 * - Barang jual memotong stok seperti pada booking dan kembali bila transaksinya dibatalkan.
 * - Member yang dipilih kasir (aktif hari ini) mendapat diskon tambahan paketnya untuk semua barang
 *   kecuali biaya lain yang diketik manual, dicatat ke akun Potongan Member seperti pada booking.
 */
export interface CounterSale {
  id: string; number: string; customer: string; phone: string; date: string; start_time: string; end_time: string;
  subtotal: number; discount: number; discount_note: string; tax: number; tax_rate: number; tax_inclusive: number; tax_label: string;
  total: number; method: string; tendered: number | null; status: SaleStatus; notes: string; void_reason: string;
  voided_at: string | null; created_by: string; created_at: string;
  customer_id: string | null; booking_id: string | null; fee: number; paid_at: string | null;
  /** Biaya layanan Midtrans yang dibayar pelanggan di atas `total`, dan metode yang dipilih untuknya. */
  surcharge: number; channel: ChannelKey | null;
  pay_order_id: string | null; snap_token: string | null; pay_url: string | null; pay_expires_at: number | null; payment_type: string | null;
  /** Salinan keanggotaan saat transaksi: nama paket, diskon tambahan (basis poin), dan nilai potongannya (sudah termasuk dalam `total`). */
  membership_id: string | null; member_plan: string; member_addon_rate: number; member_discount: number;
}
export type SaleStatus = "pending" | "paid" | "void" | "expired";
export interface CounterLine { id: string; sale_id: string; addon_id: string | null; name: string; type: Addon["type"] | "lainnya"; pricing: Addon["pricing"]; unit_price: number; quantity: number; subtotal: number; returned_at: string | null }

const columns = "s.id,s.number,s.customer,s.phone,s.date,s.start_time,s.end_time,s.subtotal,s.discount,s.discount_note,s.tax,s.tax_rate,s.tax_inclusive,s.tax_label,s.total,s.method,s.tendered,s.status,s.notes,s.void_reason,s.voided_at,s.created_by,s.created_at,s.customer_id,s.booking_id,s.fee,s.surcharge,s.channel,s.paid_at,s.pay_order_id,s.snap_token,s.pay_url,s.pay_expires_at,s.payment_type,s.membership_id,s.member_plan,s.member_addon_rate,s.member_discount";
/** Batas bayar Midtrans di kasir: pelanggan membayar di tempat, jadi cukup singkat. */
export const payMinutes = 15;
const rupiah = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
export const walkInName = "Pelanggan umum";

export const saleSchema = z.object({
  /** Dibuat browser sekali per formulir, agar klik ganda tidak mencatat dua transaksi. */
  id: z.string().uuid().optional(),
  customer: z.string().trim().max(80, "Nama pelanggan maksimal 80 karakter.").default(""),
  phone: z.string().trim().max(18, "Nomor telepon maksimal 18 karakter.").default(""),
  /** Pelanggan terdaftar yang dipilih dari riwayat. */
  customer_id: z.string().max(64).nullable().default(null),
  /** Booking lapangan hari ini yang dihubungkan; jam sewa barang mengikuti jam booking. */
  booking_id: z.string().max(64).nullable().default(null),
  /** Keanggotaan yang dipilih kasir; harus aktif hari ini. */
  membership_id: z.string().max(64).nullable().default(null),
  /** Lama sewa dalam menit, kelipatan 30. Tidak berpengaruh bila tidak ada barang sewa atau harga per jam. */
  duration: z.number().int().min(30, "Lama sewa minimal 30 menit.").max(720, "Lama sewa maksimal 12 jam.").refine(value => value % 30 === 0, "Lama sewa harus kelipatan 30 menit.").default(60),
  lines: z.array(lineSchema.omit({ id: true })).min(1, "Pilih minimal satu barang.").max(30, "Maksimal 30 baris per transaksi."),
  method: z.enum(["cash", "transfer", "qris", "midtrans"]),
  /** Metode Midtrans yang dipilih; wajib bila biaya admin ditanggung pelanggan. */
  channel: z.string().max(20).nullable().optional(),
  tendered: z.number().int().min(0).max(999_999_999).nullable().default(null),
  discount: z.number().int().min(0, "Potongan tidak boleh negatif.").max(999_999_999).default(0),
  discount_note: z.string().trim().max(120, "Alasan potongan maksimal 120 karakter.").default(""),
  notes: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default(""),
});

async function nextNumber(year: string) {
  const last = await db.prepare("SELECT number FROM counter_sales WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(`KSR-${year}-%`) as { number: string } | undefined;
  return `KSR-${year}-${String(last ? Number(last.number.slice(-5)) + 1 : 1).padStart(5, "0")}`;
}

export async function getSale(id: string) {
  const sale = await db.prepare(`SELECT ${columns} FROM counter_sales s WHERE s.id=?`).get(id) as CounterSale | undefined;
  check(sale, 404, "Transaksi kasir tidak ditemukan.");
  return sale;
}
export async function saleLines(saleId: string) {
  return await db.prepare("SELECT id,sale_id,addon_id,name,type,pricing,unit_price,quantity,subtotal,returned_at FROM counter_sale_lines WHERE sale_id=? ORDER BY seq").all(saleId) as CounterLine[];
}
export async function detail(id: string) {
  const sale = await getSale(id);
  return { sale: publicSale(sale), lines: await saleLines(id), booking: sale.booking_id ? await linkedBooking(sale.booking_id) : null };
}
/** Tautan bayar hanya relevan selama masih menunggu bayar. */
const publicSale = (sale: CounterSale) => sale.status === "pending" ? sale : { ...sale, snap_token: null, pay_url: null };

export interface LinkedBooking {
  id: string; code: string; court_name: string; customer: string; phone: string; customer_id: string | null; date: string; start_time: string; end_time: string; status: string;
  /** Kode member bila booking itu memakai harga member, agar kasir bisa langsung memakainya. */
  member_code: string | null;
}
const bookingColumns = "b.id,b.customer,b.phone,b.customer_id,b.date,b.start_time,b.end_time,b.status,c.name court_name,(SELECT m.code FROM memberships m WHERE m.id=b.membership_id) member_code";
const withCode = (row: Omit<LinkedBooking, "code">): LinkedBooking => ({ ...row, code: row.id.slice(0, 8).toUpperCase() });
async function linkedBooking(id: string) {
  const row = await db.prepare(`SELECT ${bookingColumns} FROM bookings b JOIN courts c ON c.id=b.court_id WHERE b.id=?`).get(id) as Omit<LinkedBooking, "code"> | undefined;
  return row ? withCode(row) : null;
}
/** Booking lapangan hari ini yang bisa dihubungkan: aktif atau sudah selesai main. */
async function todayBookings() {
  const rows = await db.prepare(`SELECT ${bookingColumns} FROM bookings b JOIN courts c ON c.id=b.court_id
    WHERE b.date=? AND b.status IN ('confirmed','completed') ORDER BY b.start_time,c.name`).all(localClock().date) as Omit<LinkedBooking, "code">[];
  return rows.map(withCode);
}
/** 62812… disimpan seragam di tabel pelanggan; kasir dan nota menampilkannya sebagai 0812…. */
const localPhone = (phone: string) => phone.startsWith("62") ? "0" + phone.slice(2) : phone;
const validPhone = (phone: string) => /^628\d{7,12}$/.test(normalizePhone(phone));
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Jam mulai sewa: sekarang dibulatkan ke bawah ke 30 menit, selesai paling lambat 24:00. */
function rentalWindow(duration: number) {
  const now = localClock();
  const start = Math.floor(minutes(now.time) / 30) * 30;
  return { date: now.date, start: clockLabel(start), end: clockLabel(Math.min(1440, start + duration)) };
}

/**
 * Jam sewa transaksi yang dihubungkan ke booking: mengikuti jam booking selama booking itu belum
 * selesai. Booking yang sudah selesai (mis. beli minuman setelah main) memakai jam sekarang.
 */
function windowFor(duration: number, booking: LinkedBooking | null) {
  if (booking && booking.end_time > localClock().time) return { date: booking.date, start: booking.start_time, end: booking.end_time };
  return rentalWindow(duration);
}
async function bookingToLink(id: string | null) {
  if (!id) return null;
  const booking = await linkedBooking(id);
  check(booking, 404, "Booking tidak ditemukan. Muat ulang halaman.");
  check(booking.status === "confirmed" || booking.status === "completed", 409, "Booking itu tidak aktif, jadi tidak bisa dihubungkan.");
  check(booking.date === localClock().date, 409, "Hanya booking hari ini yang bisa dihubungkan ke transaksi kasir.");
  return booking;
}

/** Pilihan barang untuk transaksi kasir, dengan sisa stok pada jam sekarang sampai lama sewa yang dipilih. */
export async function saleOptions(input: unknown) {
  const { duration, booking_id } = z.object({ duration: z.coerce.number().int().min(30).max(720).default(60), booking_id: z.string().max(64).default("") }).parse(input ?? {});
  await expirePendingSales();
  const window = windowFor(duration, booking_id ? await bookingToLink(booking_id) : null);
  const list = [];
  for (const addon of (await addons()).filter(item => item.active)) {
    const available = addon.stock === null ? null : addon.type === "jual" ? addon.stock : Math.max(0, addon.stock - await peakUse(addon.id, window, ""));
    list.push({ id: addon.id, name: addon.name, category: addon.category, type: addon.type, pricing: addon.pricing, price: addon.price, description: addon.description, photo_id: addon.photo_id, max_per_booking: addon.max_per_booking, online: !!addon.online, available });
  }
  const config = await paymentConfig();
  const midtrans = config.enabled && !!config.serverKey;
  return {
    addons: list, window, tax: await taxSnapshot(), bookings: await todayBookings(),
    // Client key memang untuk browser: Snap.js memakainya bila pelanggan membayar di layar kasir.
    midtrans: { enabled: midtrans, client_key: midtrans ? config.clientKey : "", environment: config.environment, minutes: payMinutes, fees: await publicFees() },
  };
}

/**
 * Rekomendasi pelanggan untuk formulir kasir dari riwayatnya: pelanggan terdaftar, nama di booking
 * staf, dan nama di transaksi kasir sebelumnya. Tanpa kata kunci, yang punya booking hari ini dan
 * yang baru datang ditampilkan lebih dulu. Setiap hasil membawa booking hari ini milik pelanggan itu.
 */
export async function customerOptions(input: unknown) {
  const { q } = z.object({ q: z.string().trim().max(60).default("") }).parse(input ?? {});
  const term = q.toLowerCase(), digits = q.replace(/\D/g, "");
  const phoneTerm = digits.length >= 3 ? (digits.startsWith("0") ? "62" + digits.slice(1) : digits) : "";
  const rawDigits = digits.length >= 3 ? digits : "";
  const today = await todayBookings();
  type Hit = { customer_id: string | null; name: string; phone: string; visits: number; last_visit: string; member_code?: string | null };
  const registered = await db.prepare(`SELECT c.id customer_id,c.name,c.phone,
      (SELECT m.code FROM memberships m WHERE (m.customer_id=c.id OR m.phone=c.phone) AND m.status IN ('active','frozen') ORDER BY m.ends_on DESC LIMIT 1) member_code,
      (SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id AND b.status IN ('confirmed','completed'))+(SELECT COUNT(*) FROM counter_sales s WHERE s.customer_id=c.id AND s.status='paid') visits,
      GREATEST(COALESCE((SELECT MAX(b.date) FROM bookings b WHERE b.customer_id=c.id AND b.status IN ('confirmed','completed') AND b.date<=?),''),COALESCE((SELECT MAX(s.date) FROM counter_sales s WHERE s.customer_id=c.id AND s.status='paid'),'')) last_visit
    FROM customers c WHERE (?='' OR lower(c.name) LIKE CONCAT('%',?,'%') OR (?<>'' AND c.phone LIKE CONCAT('%',?,'%')))
    ORDER BY last_visit DESC,c.name LIMIT 12`).all(localClock().date, term, term, phoneTerm, phoneTerm) as Hit[];
  // Booking staf dan transaksi kasir lama sering tanpa data pelanggan terdaftar: dikelompokkan per nama.
  const unregistered = await db.prepare(`SELECT NULL customer_id,name,MAX(phone) phone,SUM(visits) visits,MAX(last_visit) last_visit FROM (
      SELECT b.customer name,b.phone,1 visits,b.date last_visit FROM bookings b WHERE b.customer_id IS NULL AND b.status IN ('confirmed','completed') AND b.date<=?
      UNION ALL SELECT s.customer,s.phone,1,s.date FROM counter_sales s WHERE s.customer_id IS NULL AND s.status='paid' AND s.customer<>?
    ) x WHERE (?='' OR lower(name) LIKE CONCAT('%',?,'%') OR (?<>'' AND phone LIKE CONCAT('%',?,'%')))
    GROUP BY name ORDER BY last_visit DESC LIMIT 12`).all(localClock().date, walkInName, term, term, rawDigits, rawDigits) as Hit[];
  const hits: (Hit & { booking: LinkedBooking | null })[] = [];
  const bookingOf = (hit: Hit) => today.find(booking => (hit.customer_id && booking.customer_id === hit.customer_id)
    || (hit.phone && booking.phone && normalizePhone(booking.phone) === normalizePhone(hit.phone)) || sameName(booking.customer, hit.name)) ?? null;
  for (const hit of [...registered, ...unregistered]) {
    // Nama yang sama dari sumber lain digabung ke pelanggan terdaftar.
    if (hits.some(other => sameName(other.name, hit.name) && (!hit.phone || !other.phone || normalizePhone(other.phone) === normalizePhone(hit.phone)))) continue;
    const booking = bookingOf(hit);
    hits.push({ ...hit, phone: localPhone(hit.phone ?? ""), visits: Number(hit.visits), booking, member_code: hit.member_code ?? booking?.member_code ?? null });
  }
  // Pemesan lapangan hari ini yang belum punya riwayat lain tetap direkomendasikan.
  for (const booking of today) {
    if (term && !booking.customer.toLowerCase().includes(term) && !(rawDigits && booking.phone.replace(/\D/g, "").includes(rawDigits))) continue;
    if (hits.some(hit => hit.booking?.id === booking.id)) continue;
    hits.push({ customer_id: booking.customer_id, name: booking.customer, phone: localPhone(booking.phone), visits: 1, last_visit: booking.date, booking, member_code: booking.member_code });
  }
  hits.sort((a, b) => Number(!!b.booking) - Number(!!a.booking) || b.last_visit.localeCompare(a.last_visit) || a.name.localeCompare(b.name));
  return { customers: hits.slice(0, 10) };
}

/** Pelanggan baru dengan nomor telepon disimpan agar dikenali di transaksi berikutnya. */
async function customerFor(name: string, phone: string) {
  const normalized = normalizePhone(phone);
  const existing = await db.prepare("SELECT id FROM customers WHERE phone=?").get(normalized) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = randomUUID();
  await db.prepare("INSERT INTO customers (id,name,phone,email,created_at) VALUES (?,?,?,NULL,?)").run(id, name, normalized, new Date().toISOString());
  return id;
}

export async function createSale(input: unknown, actor: string) {
  const data = saleSchema.parse(input);
  let channel: ChannelKey | null = null;
  if (data.method === "midtrans") {
    const config = await paymentConfig();
    check(config.enabled && config.serverKey, 409, "Pembayaran Midtrans belum aktif. Atur dulu di menu Pembayaran, atau pilih metode lain.");
    channel = await pickChannel(data.channel);
  }
  await expirePendingSales();
  const created = await transaction(async () => {
    if (data.id && await db.prepare("SELECT 1 FROM counter_sales WHERE id=?").get(data.id)) return { id: data.id, fresh: false };
    const booking = await bookingToLink(data.booking_id);
    const window = windowFor(data.duration, booking), duration = minutes(window.end) - minutes(window.start);
    const catalog = await addons(), seen = new Set<string>();
    const plan: { addon?: Addon; name: string; type: CounterLine["type"]; pricing: CounterLine["pricing"]; unit_price: number; quantity: number; subtotal: number }[] = [];
    for (const item of data.lines) {
      if (item.addon_id) {
        const addon = catalog.find(entry => entry.id === item.addon_id);
        check(addon, 404, "Barang tidak ditemukan. Muat ulang halaman.");
        check(addon.active, 409, `${addon.name} sedang tidak tersedia.`);
        check(!seen.has(addon.id), 400, `${addon.name} tercatat dua kali. Ubah jumlah pada baris yang sudah ada.`);
        seen.add(addon.id);
        check(item.quantity <= addon.max_per_booking, 400, `${addon.name} maksimal ${addon.max_per_booking} per transaksi.`);
        if (addon.stock !== null) {
          if (addon.type === "jual") check(addon.stock >= item.quantity, 409, `Stok ${addon.name} hanya ${addon.stock}.`);
          else {
            const use = await peakUse(addon.id, window, "");
            check(use + item.quantity <= addon.stock, 409, `${addon.name} tersisa ${Math.max(0, addon.stock - use)} pada ${window.start}–${window.end}.`);
          }
        }
        plan.push({ addon, name: addon.name, type: addon.type, pricing: addon.pricing, unit_price: addon.price, quantity: item.quantity, subtotal: lineTotal(addon.price, item.quantity, addon.pricing, duration) });
      } else {
        check(item.name !== undefined && item.unit_price !== undefined, 400, "Biaya lain wajib punya nama dan harga.");
        plan.push({ name: item.name!, type: "lainnya", pricing: "per_booking", unit_price: item.unit_price!, quantity: item.quantity, subtotal: item.unit_price! * item.quantity });
      }
    }
    // Pelanggan: dipilih dari riwayat, pemesan booking yang dihubungkan, atau nama baru (disimpan bila ada nomornya).
    let customerId: string | null = null, name = data.customer, phone = data.phone;
    if (data.customer_id) {
      const known = await db.prepare("SELECT id,name,phone FROM customers WHERE id=?").get(data.customer_id) as { id: string; name: string; phone: string } | undefined;
      check(known, 404, "Pelanggan tidak ditemukan. Pilih ulang dari daftar.");
      customerId = known.id; name ||= known.name; phone ||= localPhone(known.phone);
    } else if (booking && (!name || sameName(name, booking.customer))) {
      customerId = booking.customer_id; name = booking.customer; phone ||= booking.phone;
    } else if (name.length >= 2 && phone && validPhone(phone)) {
      customerId = await customerFor(name, phone);
    }
    // Barang sewa harus kembali, jadi pelanggannya perlu dikenali.
    const renting = plan.some(entry => entry.type === "sewa");
    check(!renting || name.length >= 2, 400, "Isi nama penyewa agar barang sewa bisa ditagih kembali.");
    const subtotal = plan.reduce((sum, entry) => sum + entry.subtotal, 0);
    // Diskon member berlaku untuk barang katalog; biaya lain yang diketik kasir tidak ikut.
    const member = data.membership_id ? await memberRatesFor(data.membership_id, window.date, "hari ini,") : null;
    const memberDiscount = member ? memberCut(0, plan.filter(entry => entry.type !== "lainnya").reduce((sum, entry) => sum + entry.subtotal, 0), member) : 0;
    check(data.discount + memberDiscount <= subtotal, 400, memberDiscount ? `Potongan ditambah potongan member lebih besar dari subtotal ${rupiah(subtotal)}.` : `Potongan lebih besar dari subtotal ${rupiah(subtotal)}.`);
    check(!data.discount || data.discount_note.length >= 3, 400, "Isi alasan potongan harga.");
    const snapshot = await taxSnapshot(), bill = billOf(subtotal, data.discount + memberDiscount, snapshot);
    check(bill.total > 0, 400, "Total transaksi harus lebih dari Rp0.");
    if (data.method === "cash" && data.tendered !== null) check(data.tendered >= bill.total, 400, `Uang diterima kurang dari total ${rupiah(bill.total)}.`);

    const id = data.id ?? randomUUID(), now = new Date().toISOString(), online = data.method === "midtrans";
    check(!online || bill.total >= 1000, 400, "Pembayaran Midtrans minimal Rp1.000.");
    const surcharge = online ? surchargeFor(channel, bill.total, await paymentConfig()) : 0;
    await db.prepare(`INSERT INTO counter_sales (id,number,customer,phone,date,start_time,end_time,subtotal,discount,discount_note,tax,tax_rate,tax_inclusive,tax_label,total,method,tendered,status,notes,created_by,created_at,customer_id,booking_id,paid_at,pay_expires_at,surcharge,channel,membership_id,member_plan,member_addon_rate,member_discount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, await nextNumber(window.date.slice(0, 4)), name || walkInName, phone, window.date, window.start, window.end, subtotal, data.discount, data.discount ? data.discount_note : "",
        bill.tax, snapshot.tax_rate, snapshot.tax_inclusive, snapshot.tax_label, bill.total, data.method, data.method === "cash" ? data.tendered : null, online ? "pending" : "paid", data.notes, actor, now,
        customerId, booking?.id ?? null, online ? null : now, online ? Math.floor(Date.now() / 1000) + payMinutes * 60 : null, surcharge, online ? channel : null,
        member?.membership_id ?? null, member?.member_plan ?? "", member?.member_addon_rate ?? 0, memberDiscount);
    for (const entry of plan) {
      await db.prepare("INSERT INTO counter_sale_lines (id,sale_id,addon_id,name,type,pricing,unit_price,quantity,subtotal,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), id, entry.addon?.id ?? null, entry.name, entry.type, entry.pricing, entry.unit_price, entry.quantity, entry.subtotal, now);
      if (entry.type === "jual" && entry.addon) await consume(entry.addon.id, entry.quantity, id, actor);
    }
    await syncCounterSale(id);
    await audit(actor, "counter.create", id, { total: bill.total, method: data.method, booking: booking?.id ?? null, ...(member ? { membership: member.membership_id, member_discount: memberDiscount } : {}) });
    return { id, fresh: true };
  });
  if (data.method === "midtrans" && created.fresh) await openPayment(created.id, actor);
  return await detail(created.id);
}

// --- Midtrans ----------------------------------------------------------------------------

/**
 * Buka halaman bayar Midtrans untuk transaksi yang menunggu bayar. Pelanggan memindai QR tautannya
 * dengan ponselnya sendiri, atau membayar di layar kasir lewat Snap. Gagal dibuat berarti transaksi
 * langsung kedaluwarsa agar stoknya tidak tertahan.
 */
async function openPayment(id: string, actor: string) {
  const sale = await getSale(id), lines = await saleLines(id);
  const orderId = `${sale.number}-${Date.now().toString(36).toUpperCase()}`;
  const items = [
    ...lines.map(line => ({ id: line.id.slice(0, 50), price: Math.round(line.subtotal / line.quantity), quantity: line.quantity, name: line.name.slice(0, 50) })),
    ...(sale.member_discount ? [{ id: "member", price: -sale.member_discount, quantity: 1, name: `Potongan member ${sale.member_plan}`.slice(0, 50) }] : []),
    ...(sale.discount ? [{ id: "diskon", price: -sale.discount, quantity: 1, name: `Potongan ${sale.discount_note}`.slice(0, 50) }] : []),
    ...(sale.tax && !sale.tax_inclusive ? [{ id: "pajak", price: sale.tax, quantity: 1, name: `${sale.tax_label || "Pajak"} ${sale.tax_rate / 100}%`.slice(0, 50) }] : []),
  ];
  const sum = items.reduce((total, item) => total + item.price * item.quantity, 0);
  if (sum !== sale.total) items.push({ id: "penyesuaian", price: sale.total - sum, quantity: 1, name: "Penyesuaian pembulatan" });
  try {
    const snap = await createSnapTransaction({
      transaction_details: { order_id: orderId, gross_amount: sale.total + sale.surcharge },
      item_details: [...items, ...surchargeItem(sale.surcharge, sale.channel)],
      ...await snapPayments(sale.channel),
      customer_details: { first_name: sale.customer.slice(0, 20), ...(sale.phone ? { phone: sale.phone.slice(0, 19) } : {}) },
      expiry: { unit: "minute", duration: payMinutes },
      callbacks: { finish: `${publicUrl}/` },
    });
    await db.prepare("UPDATE counter_sales SET pay_order_id=?,snap_token=?,pay_url=? WHERE id=? AND status='pending'").run(orderId, snap.token, snap.redirect_url, id);
  } catch (error) {
    await closePending(id, "expired", actor, "Halaman bayar Midtrans gagal dibuat");
    console.error("Snap gagal untuk transaksi kasir", sale.number, (error as Error).message);
    check(false, 502, `Midtrans belum dapat dihubungi: ${(error as Error).message.replace(/^Midtrans menolak transaksi: /, "")}. Transaksi tidak disimpan; pilih metode lain atau coba lagi.`);
  }
}

/** Tutup transaksi yang menunggu bayar: stok barang jual kembali dan barang sewa dilepas. */
async function closePending(id: string, status: "expired" | "void", actor: string, reason: string) {
  return await transaction(async () => {
    const now = new Date().toISOString();
    const changed = await db.prepare("UPDATE counter_sales SET status=?,void_reason=?,voided_at=?,voided_by=? WHERE id=? AND status='pending'")
      .run(status, reason, now, actor, id);
    if (!changed.changes) return false;
    for (const line of await saleLines(id)) if (line.type === "jual" && line.addon_id) await consume(line.addon_id, -line.quantity, id, actor, status === "void" ? "Transaksi kasir dibatalkan" : "Transaksi kasir tidak dibayar");
    await db.prepare("UPDATE counter_sale_lines SET returned_at=COALESCE(returned_at,?) WHERE sale_id=? AND type='sewa'").run(now, id);
    await audit(actor, `counter.${status === "void" ? "void" : "expired"}`, id, { reason });
    return true;
  });
}

export const saleByOrder = async (orderId: string) =>
  await db.prepare(`SELECT ${columns} FROM counter_sales s WHERE s.pay_order_id=?`).get(orderId) as CounterSale | undefined;

/**
 * Terapkan status Midtrans pada transaksi kasir. Idempoten. Uang yang masuk setelah transaksinya
 * kedaluwarsa atau dibatalkan tetap dicatat lunas (stok dipotong lagi) dengan catatan untuk kasir,
 * agar tidak ada uang pelanggan yang tidak tercatat.
 */
export async function applySaleStatus(sale: CounterSale, status: MidtransStatus) {
  const outcome = outcomeOf(status);
  if (outcome === "paid" && sale.status !== "paid") {
    await transaction(async () => {
      const fresh = await getSale(sale.id);
      if (fresh.status === "paid") return;
      const method = paymentMethod(status.payment_type), now = new Date().toISOString(), late = fresh.status !== "pending";
      if (late) for (const line of await saleLines(sale.id)) if (line.type === "jual" && line.addon_id) await consume(line.addon_id, line.quantity, sale.id, "midtrans", "Pembayaran Midtrans masuk terlambat");
      await db.prepare(`UPDATE counter_sales SET status='paid',method=?,fee=?,paid_at=?,payment_type=?,transaction_id=?,void_reason='',voided_at=NULL,voided_by=NULL,
          notes=CASE WHEN ? THEN TRIM(CONCAT(notes,' ','[Pembayaran Midtrans masuk setelah transaksi ${fresh.status === "void" ? "dibatalkan" : "kedaluwarsa"}. Serahkan barangnya atau kembalikan dananya.]')) ELSE notes END
        WHERE id=?`).run(method, await gatewayFee(status.payment_type, fresh.total + fresh.surcharge), now, status.payment_type ?? null, status.transaction_id ?? null, late ? 1 : 0, sale.id);
      await syncCounterSale(sale.id);
      await audit("midtrans", "counter.paid", sale.id, { total: fresh.total, method, late });
    });
  } else if (outcome !== "paid" && outcome !== "pending" && sale.status === "pending") {
    await closePending(sale.id, "expired", "midtrans", outcome === "cancelled" ? "Pembayaran dibatalkan di Midtrans" : "Batas waktu bayar lewat");
  } else if (status.payment_type && sale.status === "pending") {
    await db.prepare("UPDATE counter_sales SET payment_type=? WHERE id=?").run(status.payment_type, sale.id);
  }
  return { handled: true, outcome };
}

/** Tanya langsung ke Midtrans; dipakai layar menunggu bayar di kasir, tidak bergantung pada webhook. */
export async function refreshSale(id: string) {
  const sale = await getSale(id);
  if (sale.status === "pending" && sale.pay_order_id) {
    const status = await fetchTransactionStatus(sale.pay_order_id);
    if (status) await applySaleStatus(sale, status);
    else if ((sale.pay_expires_at ?? 0) <= Date.now() / 1000) await closePending(id, "expired", "sistem", "Batas waktu bayar lewat");
  }
  return await detail(id);
}

/**
 * Transaksi Midtrans yang lewat batas bayarnya ditutup. Status Midtrans diperiksa dulu (lewat
 * semenit) agar pembayaran yang webhook-nya belum sampai tidak ikut kedaluwarsa.
 */
export async function expirePendingSales() {
  const stale = await db.prepare(`SELECT ${columns} FROM counter_sales s WHERE s.status='pending' AND s.pay_expires_at<=UNIX_TIMESTAMP()-60 LIMIT 20`).all() as CounterSale[];
  for (const sale of stale) {
    const status = sale.pay_order_id ? await fetchTransactionStatus(sale.pay_order_id).catch(() => undefined) : null;
    if (status === undefined) continue; // Midtrans tidak terjangkau: coba lagi nanti.
    if (status && outcomeOf(status) !== "pending") await applySaleStatus(sale, status);
    else await closePending(sale.id, "expired", "sistem", "Batas waktu bayar lewat");
  }
}

/** Transaksi kasir yang dihubungkan ke sebuah booking, untuk detail booking. */
export async function bookingSales(bookingId: string) {
  return await db.prepare(`SELECT s.id,s.number,s.status,s.method,s.total,s.created_at,
      (SELECT GROUP_CONCAT(CONCAT(l.quantity,'× ',l.name) ORDER BY l.seq SEPARATOR ', ') FROM counter_sale_lines l WHERE l.sale_id=s.id) items,
      (SELECT COUNT(*) FROM counter_sale_lines l WHERE l.sale_id=s.id AND l.type='sewa' AND l.returned_at IS NULL) open_rentals
    FROM counter_sales s WHERE s.booking_id=? AND s.status IN ('pending','paid','void') ORDER BY s.created_at`).all(bookingId);
}

/** Potong (positif) atau kembalikan (negatif) stok barang jual yang dilacak. */
async function consume(addonId: string, quantity: number, saleId: string, actor: string, note = "") {
  const changed = await db.prepare("UPDATE addons SET stock=stock-? WHERE id=? AND type='jual' AND stock IS NOT NULL").run(quantity, addonId);
  if (!changed.changes) return;
  const row = await db.prepare("SELECT stock FROM addons WHERE id=?").get(addonId) as { stock: number };
  await recordMove(addonId, -quantity, quantity > 0 ? "terpakai" : "kembali", row.stock, actor, note, null, saleId);
}

export async function listSales(input: unknown) {
  const today = localClock().date;
  const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid.").optional(), q: z.string().trim().max(60).default("") }).parse(input ?? {});
  const date = query.date ?? today, term = query.q.toLowerCase();
  await expirePendingSales();
  const sales = await db.prepare(`SELECT ${columns},(SELECT COUNT(*) FROM counter_sale_lines l WHERE l.sale_id=s.id AND l.type='sewa' AND l.returned_at IS NULL) open_rentals,
      (SELECT GROUP_CONCAT(CONCAT(l.quantity,'× ',l.name) ORDER BY l.seq SEPARATOR ', ') FROM counter_sale_lines l WHERE l.sale_id=s.id) items,
      c.name booking_court,b.start_time booking_start,b.end_time booking_end
    FROM counter_sales s LEFT JOIN bookings b ON b.id=s.booking_id LEFT JOIN courts c ON c.id=b.court_id WHERE s.date=? AND (?='' OR lower(s.customer) LIKE CONCAT('%',?,'%') OR lower(s.number) LIKE CONCAT('%',?,'%') OR s.phone LIKE CONCAT('%',?,'%'))
    ORDER BY s.created_at DESC LIMIT 300`).all(date, term, term, term, term) as (CounterSale & { open_rentals: number; items: string })[];
  const paid = sales.filter(sale => sale.status === "paid");
  for (const sale of sales) if (sale.status !== "pending") { sale.snap_token = null; sale.pay_url = null; }
  const byMethod: Record<string, number> = {};
  for (const sale of paid) byMethod[sale.method] = (byMethod[sale.method] ?? 0) + sale.total;
  return { sales, summary: { count: paid.length, total: paid.reduce((sum, sale) => sum + sale.total, 0), by_method: byMethod, pending: sales.filter(sale => sale.status === "pending").length }, date, today };
}

export const saleReturnSchema = z.object({ line_ids: z.array(z.string().min(1)).min(1, "Pilih barang yang dikembalikan.").max(30), returned: z.boolean() });
export async function returnSaleLines(id: string, input: unknown, actor: string) {
  const data = saleReturnSchema.parse(input);
  return await transaction(async () => {
    const sale = await getSale(id), lines = await saleLines(id);
    check(sale.status === "paid", 409, "Transaksi ini sudah dibatalkan.");
    for (const lineId of data.line_ids) {
      const line = lines.find(entry => entry.id === lineId);
      check(line, 404, "Barang tidak ditemukan pada transaksi ini. Muat ulang halaman.");
      check(line.type === "sewa", 400, `${line.name} bukan barang sewa.`);
    }
    if (!data.returned) {
      // Membatalkan tanda kembali memegang unit lagi; pastikan unitnya belum dipakai orang lain.
      const catalog = await addons(), window = { date: sale.date, start: sale.start_time, end: sale.end_time };
      for (const lineId of data.line_ids) {
        const line = lines.find(entry => entry.id === lineId)!, addon = catalog.find(entry => entry.id === line.addon_id);
        if (!line.returned_at || !addon || addon.stock === null) continue;
        const use = await peakUse(addon.id, window, "");
        check(use + line.quantity <= addon.stock, 409, `${addon.name} sudah dipakai pelanggan lain, tanda kembali tidak dapat dibatalkan.`);
      }
    }
    const stamp = data.returned ? new Date().toISOString() : null;
    for (const lineId of data.line_ids) await db.prepare("UPDATE counter_sale_lines SET returned_at=? WHERE id=? AND sale_id=?").run(stamp, lineId, id);
    await audit(actor, "counter.return", id, { returned: data.returned, lines: data.line_ids.length });
    return await detail(id);
  });
}

export async function voidSale(id: string, input: unknown, actor: string) {
  const { reason } = z.object({ reason: z.string().trim().min(3, "Isi alasan pembatalan minimal 3 karakter.").max(200, "Alasan maksimal 200 karakter.") }).parse(input);
  const current = await getSale(id);
  if (current.status === "pending") {
    // Belum ada uang masuk: cukup tutup tagihannya. Halaman bayar Midtrans ikut dihentikan bila bisa.
    if (current.pay_order_id) await expireTransaction(current.pay_order_id).catch(() => undefined);
    check(await closePending(id, "void", actor, reason), 409, "Pembayaran transaksi ini baru saja masuk. Muat ulang untuk melihat statusnya.");
    return await detail(id);
  }
  return await transaction(async () => {
    const sale = await getSale(id);
    check(sale.status === "paid", 409, sale.status === "expired" ? "Transaksi ini sudah kedaluwarsa." : "Transaksi ini sudah dibatalkan.");
    for (const line of await saleLines(id)) if (line.type === "jual" && line.addon_id) await consume(line.addon_id, -line.quantity, id, actor, "Transaksi kasir dibatalkan");
    // Barang sewa dianggap sudah kembali agar tidak muncul di daftar belum kembali.
    const now = new Date().toISOString();
    await db.prepare("UPDATE counter_sale_lines SET returned_at=COALESCE(returned_at,?) WHERE sale_id=? AND type='sewa'").run(now, id);
    await db.prepare("UPDATE counter_sales SET status='void',void_reason=?,voided_at=?,voided_by=? WHERE id=?").run(reason, now, actor, id);
    await syncCounterSale(id);
    await audit(actor, "counter.void", id, { total: sale.total, method: sale.method, reason });
    return await detail(id);
  });
}
