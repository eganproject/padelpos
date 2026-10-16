import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, transaction } from "./store.js";
import { check } from "./errors.js";
import { localClock, minutes } from "./clock.js";
import { applyLines, bookingAddons, publicAddons, releaseAddons } from "./addons.js";
import { gatewayFee, syncBooking } from "./finance.js";
import { allocate, billOf, taxSnapshot } from "./bill.js";
import { closeSchema, dateSchema, ensureSlot, getBooking, maintenances, priceRules, quote, timeSchema, type Booking } from "./operations.js";
import {
  createSnapTransaction, fetchTransactionStatus, outcomeOf, paymentConfig, paymentMethod,
  payableAmount, signatureFor, signatureMatches, type MidtransStatus, type Outcome,
} from "./midtrans.js";
import { publicUrl } from "./config.js";

/**
 * Pemesanan online lewat Midtrans Snap, dengan keranjang.
 *
 * Satu pesanan (`orders`) berisi satu atau beberapa sesi. Setiap sesi tetap menjadi satu booking
 * tersendiri agar jadwal, tambahan, dan pembayarannya tercatat seperti booking biasa. Seluruh sesi
 * dibuat dalam satu transaksi: bila satu jam keburu diambil orang lain, tidak ada yang tersimpan.
 *
 * Booking berstatus `pending` mengunci slotnya lewat trigger jadwal sampai `hold_expires_at`.
 * Setelah pembayaran masuk, webhook mengonfirmasi semua sesi dan mencatat pembayaran per sesi.
 *
 * Staf juga dapat membuat link tagihan untuk satu booking yang sudah berjalan (kind `tagihan`);
 * link itu hanya mencatat pembayaran, tidak mengubah status booking.
 */
export interface PaymentIntent {
  order_id: string; booking_id: string; order_ref: string | null; amount: number; kind: "booking" | "tagihan"; status: Outcome;
  snap_token: string | null; redirect_url: string | null; payment_type: string | null; transaction_id: string | null;
  environment: string; expires_at: number; created_by: string | null; created_at: string; updated_at: string; raw_status: string | null;
}
export interface Order {
  id: string; code: string; customer_id: string | null; customer: string; phone: string;
  email: string; notes: string; total: number; created_at: string;
}
export const bookingCode = (id: string) => id.slice(0, 8).toUpperCase();
const intentOf = (orderId: string) => db.prepare("SELECT * FROM payment_intents WHERE order_id=?").get(orderId) as unknown as PaymentIntent | undefined;
export const bookingIntents = (bookingId: string) =>
  db.prepare("SELECT * FROM payment_intents WHERE booking_id=? ORDER BY created_at DESC").all(bookingId) as unknown as PaymentIntent[];
const orderBookings = (orderId: string) =>
  db.prepare("SELECT id FROM bookings WHERE order_id=? ORDER BY date,start_time").all(orderId).map(row => getBooking((row as { id: string }).id));
/** Transaksi terbaru untuk panel admin, lengkap dengan data booking pertamanya. */
export const recentIntents = (limit = 30) =>
  db.prepare(`SELECT i.*,b.customer,b.date,b.start_time,b.end_time,b.status booking_status,c.name court_name,
      (SELECT count(*) FROM bookings WHERE order_id=i.order_ref) sessions
    FROM payment_intents i JOIN bookings b ON b.id=i.booking_id JOIN courts c ON c.id=b.court_id
    ORDER BY i.created_at DESC LIMIT ?`).all(limit) as unknown as (PaymentIntent & { customer: string; date: string; start_time: string; end_time: string; booking_status: string; court_name: string; sessions: number })[];

/**
 * Booking yang batas bayarnya lewat dilepas: slot terbuka kembali dan stok barang jual dikembalikan.
 * Dipanggil sebelum jadwal dibaca dan sebelum transaksi baru dibuat.
 */
export function expireHolds() {
  const stale = db.prepare("SELECT id FROM bookings WHERE status='pending' AND hold_expires_at<=unixepoch()").all() as { id: string }[];
  if (!stale.length) return 0;
  return transaction(() => {
    const stamp = new Date().toISOString();
    for (const booking of stale) {
      db.prepare("UPDATE bookings SET status='expired' WHERE id=? AND status='pending'").run(booking.id);
      releaseAddons(booking.id, "sistem");
      syncBooking(booking.id);
      db.prepare("UPDATE payment_intents SET status='expired',updated_at=? WHERE booking_id=? AND status='pending'").run(stamp, booking.id);
      audit("sistem", "booking.expired", booking.id);
    }
    return stale.length;
  });
}

const addonPick = z.object({ addon_id: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) });
export const cartItemSchema = z.object({
  court_id: z.string().min(1),
  date: dateSchema, start_time: timeSchema, end_time: closeSchema,
  addons: z.array(addonPick).max(20).default([]),
});
export const maxCartItems = 6;
export const checkoutSchema = z.object({
  items: z.array(cartItemSchema).min(1, "Keranjang masih kosong.").max(maxCartItems, `Maksimal ${maxCartItems} sesi dalam satu pesanan.`),
  customer: z.string().trim().min(2, "Isi nama pemesan.").max(80),
  // Aturannya sama dengan nomor di profil akun, agar nomor yang lolos di sini juga dikenali saat klaim pesanan.
  phone: z.string().trim().max(20).refine(value => /^628\d{7,12}$/.test(normalizePhone(value)), "Masukkan nomor WhatsApp Indonesia yang aktif, mis. 0812 3456 7890."),
  email: z.union([z.email("Email tidak valid."), z.literal("")]).default(""),
  notes: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default(""),
});
export const cartSchema = z.object({ items: z.array(cartItemSchema).max(maxCartItems) });
type CartItem = z.infer<typeof cartItemSchema>;

const label = (item: { date: string; start_time: string; end_time: string }, courtName: string) =>
  `${courtName} pukul ${item.start_time}–${item.end_time} pada ${item.date}`;
const overlapping = (a: CartItem, b: CartItem) =>
  a.court_id === b.court_id && a.date === b.date && a.start_time < b.end_time && a.end_time > b.start_time;
/** Slot yang sudah dipegang booking lain atau sedang dirawat. */
function slotTaken(item: CartItem) {
  const busy = db.prepare(`SELECT 1 FROM bookings WHERE court_id=? AND date=? AND start_time<? AND end_time>?
    AND (status IN ('confirmed','completed') OR (status='pending' AND hold_expires_at>unixepoch())) LIMIT 1`)
    .get(item.court_id, item.date, item.end_time, item.start_time);
  if (busy) return "sudah dipesan orang lain";
  const care = maintenances(item.date).some(entry => entry.court_id === item.court_id && entry.start_time < item.end_time && entry.end_time > item.start_time);
  return care ? "sedang dijadwalkan perawatan" : "";
}

/**
 * Periksa keranjang sebelum bayar: harga terbaru, ketersediaan slot, dan stok tambahan.
 * Tidak mengubah apa pun, jadi aman dipanggil setiap kali halaman keranjang dibuka.
 */
export function quoteCart(input: unknown) {
  const { items } = cartSchema.parse(input);
  expireHolds();
  const rules = priceRules();
  const snapshot = taxSnapshot();
  const now = localClock();
  const results = items.map((item, index) => {
    const duration = minutes(item.end_time) - minutes(item.start_time);
    const court = db.prepare("SELECT id,name,hourly_rate,opens_at,closes_at,active FROM courts WHERE id=?").get(item.court_id) as
      { id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string; active: number } | undefined;
    const base = { index, court_id: item.court_id, court_name: court?.name ?? "Lapangan", date: item.date, start_time: item.start_time, end_time: item.end_time, tax: 0 };
    if (!court || !court.active) return { ...base, ok: false, reason: "Lapangan ini sedang tidak tersedia.", court_total: 0, total: 0, addons: [] };
    // Keranjang yang ditinggal semalam bisa memuat jam yang sudah lewat. Batasnya sama dengan
    // jadwal publik: slot yang dimulai tepat pada menit ini masih boleh dipesan.
    if (item.date < now.date || (item.date === now.date && item.start_time < now.time))
      return { ...base, ok: false, reason: "Jam main ini sudah lewat.", court_total: 0, total: 0, addons: [] };
    if (duration < 60 || duration > 180) return { ...base, ok: false, reason: "Durasi main antara 1 sampai 3 jam.", court_total: 0, total: 0, addons: [] };
    if (item.start_time < court.opens_at || item.end_time > court.closes_at)
      return { ...base, ok: false, reason: "Jam itu di luar jam operasional lapangan.", court_total: 0, total: 0, addons: [] };
    const clash = items.findIndex((other, position) => position !== index && overlapping(item, other));
    if (clash >= 0 && clash < index) return { ...base, ok: false, reason: "Sesi ini bertabrakan dengan sesi lain di keranjang.", court_total: 0, total: 0, addons: [] };
    const taken = slotTaken(item);
    const courtTotal = quote(court, rules, item.date, item.start_time, item.end_time);
    // Stok dihitung untuk jam sesi ini, sama seperti pemeriksaan saat checkout.
    const catalog = publicAddons({ date: item.date, start: item.start_time, end: item.end_time });
    const addons = item.addons.map(pick => {
      const option = catalog.find(entry => entry.id === pick.addon_id);
      const limit = option ? Math.min(option.max_per_booking, option.available ?? option.max_per_booking) : 0;
      const quantity = Math.min(pick.quantity, limit);
      const subtotal = option ? (option.pricing === "per_hour" ? Math.round(option.price * quantity * duration / 60) : option.price * quantity) : 0;
      return {
        addon_id: pick.addon_id, name: option?.name ?? "Item tidak tersedia", quantity,
        unit_price: option?.price ?? 0, pricing: option?.pricing ?? "per_booking", subtotal,
        ok: !!option && quantity === pick.quantity,
      };
    });
    // Hitungan yang sama dengan saat booking dibuat, jadi angka di keranjang = angka yang ditagih.
    const { total, tax } = billOf(courtTotal + addons.reduce((sum, line) => sum + line.subtotal, 0), 0, snapshot);
    return {
      ...base, ok: !taken && addons.every(line => line.ok),
      reason: taken ? `Jam ini ${taken}.`
        : addons.some(line => !line.ok) ? addonProblem(addons.filter(line => !line.ok), catalog) : "",
      court_total: courtTotal, tax, total, addons,
    };
  });
  const ok = results.filter(item => item.ok);
  const config = paymentConfig();
  return {
    items: results, total: ok.reduce((sum, item) => sum + item.total, 0), tax: ok.reduce((sum, item) => sum + item.tax, 0),
    tax_label: snapshot.tax_label, tax_inclusive: !!snapshot.tax_inclusive,
    amount: ok.reduce((sum, item) => sum + payableAmount(item.total, config), 0),
  };
}

/** Penjelasan untuk tambahan yang tidak bisa dipenuhi: sudah tidak dijual online, atau stoknya kurang. */
function addonProblem(lines: { addon_id: string; name: string; quantity: number }[], catalog: ReturnType<typeof publicAddons>) {
  const missing = lines.filter(line => !catalog.some(entry => entry.id === line.addon_id));
  if (missing.length) return "Ada tambahan yang sudah tidak tersedia. Hapus tambahan itu dari sesi ini.";
  return lines.map(line => line.quantity > 0
    ? `${line.name} hanya bisa dipesan ${line.quantity} untuk sesi ini.`
    : `${line.name} sudah habis di jam ini.`).join(" ");
}

/** 08xx dan +62xx disimpan seragam sebagai 62xx agar pelanggan lama dikenali. */
export function normalizePhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("62") ? digits : "62" + digits;
}
function upsertCustomer(name: string, phone: string, email: string) {
  const normalized = normalizePhone(phone);
  const existing = db.prepare("SELECT id FROM customers WHERE phone=?").get(normalized) as { id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE customers SET name=?,email=COALESCE(NULLIF(?,''),email) WHERE id=?").run(name, email, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO customers (id,name,phone,email,created_at) VALUES (?,?,?,?,?)").run(id, name, normalized, email || null, new Date().toISOString());
  return id;
}
/** Kode pendek yang mudah dibacakan lewat telepon. */
function newOrderCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = "PDX-" + [...randomBytes(6)].map(byte => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join("");
    if (!db.prepare("SELECT 1 FROM orders WHERE code=?").get(code)) return code;
  }
  return "PDX-" + Date.now().toString(36).toUpperCase();
}

/** Rincian item untuk halaman Midtrans; jumlahnya wajib sama persis dengan nominal tagihan. */
function itemsFor(bookings: Booking[], amount: number, full: boolean) {
  const items = full
    ? bookings.flatMap(booking => [
      { id: `court-${booking.id.slice(0, 8)}`, price: booking.court_total, quantity: 1, name: `${booking.court_name} ${booking.start_time}-${booking.end_time}`.slice(0, 50) },
      ...bookingAddons(booking.id).map(line => ({
        id: line.id.slice(0, 50), price: Math.round(line.subtotal / line.quantity), quantity: line.quantity, name: line.name.slice(0, 50),
      })),
      ...(booking.discount ? [{ id: `diskon-${booking.id.slice(0, 8)}`, price: -booking.discount, quantity: 1, name: `Potongan ${booking.discount_note}`.slice(0, 50) }] : []),
      // Pajak yang sudah termasuk harga tidak ditambahkan lagi.
      ...(booking.tax && !booking.tax_inclusive ? [{ id: `pajak-${booking.id.slice(0, 8)}`, price: booking.tax, quantity: 1, name: `${booking.tax_label || "Pajak"} ${booking.tax_rate / 100}%`.slice(0, 50) }] : []),
    ])
    : bookings.map(booking => ({
      id: `dp-${booking.id.slice(0, 8)}`, price: payableAmount(booking.total, paymentConfig()), quantity: 1,
      name: `DP ${booking.court_name} ${booking.start_time}`.slice(0, 50),
    }));
  // Harga per jam yang dibagi rata bisa menyisakan selisih rupiah; catat sebagai penyesuaian.
  const sum = items.reduce((total, item) => total + item.price * item.quantity, 0);
  if (sum !== amount) items.push({ id: "penyesuaian", price: amount - sum, quantity: 1, name: "Penyesuaian pembulatan" });
  return items;
}
async function openSnap(bookings: Booking[], intent: PaymentIntent, contact: { name: string; phone: string; email: string }, expiryMinutes: number, full: boolean) {
  const snap = await createSnapTransaction({
    transaction_details: { order_id: intent.order_id, gross_amount: intent.amount },
    item_details: itemsFor(bookings, intent.amount, full),
    customer_details: { first_name: contact.name.slice(0, 20), phone: contact.phone.slice(0, 19), ...(contact.email ? { email: contact.email.slice(0, 45) } : {}) },
    // Tanpa start_time, Midtrans memakai waktu transaksi sebagai awal hitungan.
    expiry: { unit: "minute", duration: expiryMinutes },
    callbacks: { finish: `${publicUrl}/pesanan/${intent.order_ref ?? bookings[0].id}` },
  });
  db.prepare("UPDATE payment_intents SET snap_token=?,redirect_url=?,updated_at=? WHERE order_id=?")
    .run(snap.token, snap.redirect_url, new Date().toISOString(), intent.order_id);
  return snap;
}
const newTransactionId = (reference: string) => `PDX-${reference.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
function insertIntent(bookingId: string, orderRef: string | null, amount: number, kind: "booking" | "tagihan", expiresAt: number, actor: string | null) {
  const stamp = new Date().toISOString(), orderId = newTransactionId(orderRef ?? bookingId);
  db.prepare("INSERT INTO payment_intents (order_id,booking_id,order_ref,amount,kind,status,environment,expires_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?,?,?,?)")
    .run(orderId, bookingId, orderRef, amount, kind, paymentConfig().environment, expiresAt, actor, stamp, stamp);
  return intentOf(orderId)!;
}

/** Pelanggan memesan dan membayar sendiri. Seluruh sesi dikunci bersama atau tidak sama sekali. */
export async function createCheckout(input: unknown, accountId: string | null = null) {
  const data = checkoutSchema.parse(input);
  const config = paymentConfig();
  check(config.enabled && config.serverKey, 409, "Pembayaran online belum aktif. Silakan hubungi venue lewat WhatsApp.");
  for (const [index, item] of data.items.entries()) {
    const duration = minutes(item.end_time) - minutes(item.start_time);
    check(duration >= 60 && duration <= 180, 400, "Durasi main antara 1 sampai 3 jam.");
    const clash = data.items.findIndex((other, position) => position !== index && overlapping(item, other));
    check(clash < 0, 400, "Ada dua sesi yang bertabrakan di keranjang. Hapus salah satunya.");
  }
  expireHolds();
  // Item yang tidak ditandai tampil online hanya untuk kasir, walau masih aktif di katalog.
  const online = new Set(publicAddons().map(addon => addon.id));
  check(data.items.every(item => item.addons.every(pick => online.has(pick.addon_id))), 409, "Ada tambahan yang sudah tidak tersedia online. Periksa lagi keranjang Anda.");

  const { order, bookings } = transaction(() => {
    const customerId = upsertCustomer(data.customer, data.phone, data.email);
    const snapshot = taxSnapshot();
    const orderId = randomUUID(), stamp = new Date().toISOString();
    const created: Booking[] = [];
    for (const item of data.items) {
      const court = ensureSlot(item.court_id, item.date, item.start_time, item.end_time);
      check(!slotTaken(item), 409, `${label(item, court.name)} sudah dipesan orang lain. Hapus sesi itu dari keranjang.`);
      const courtTotal = quote(court, priceRules(), item.date, item.start_time, item.end_time), bill = billOf(courtTotal, 0, snapshot);
      const id = randomUUID();
      // Baris pesanan baru dibuat setelah seluruh tagihan diketahui, jadi order_id diisi menyusul.
      db.prepare(`INSERT INTO bookings (id,court_id,customer_id,account_id,customer,phone,date,start_time,end_time,total,court_total,tax,tax_rate,tax_inclusive,tax_label,status,source,hold_expires_at,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','online',unixepoch()+?,?,?)`)
        .run(id, item.court_id, customerId, accountId, data.customer, data.phone, item.date, item.start_time, item.end_time, bill.total, courtTotal,
          bill.tax, snapshot.tax_rate, snapshot.tax_inclusive, snapshot.tax_label, config.hold_minutes * 60, data.notes, stamp);
      if (item.addons.length) applyLines(getBooking(id), item.addons, customerId);
      created.push(getBooking(id));
    }
    const total = created.reduce((sum, booking) => sum + booking.total, 0);
    db.prepare("INSERT INTO orders (id,code,customer_id,customer,phone,email,notes,total,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(orderId, newOrderCode(), customerId, data.customer, data.phone, data.email, data.notes, total, stamp);
    for (const booking of created) db.prepare("UPDATE bookings SET order_id=? WHERE id=?").run(orderId, booking.id);
    audit(customerId, "order.checkout", orderId);
    return { order: db.prepare("SELECT * FROM orders WHERE id=?").get(orderId) as unknown as Order, bookings: created };
  });

  const amount = bookings.reduce((sum, booking) => sum + payableAmount(booking.total, config), 0);
  const intent = insertIntent(bookings[0].id, order.id, amount, "booking", bookings[0].hold_expires_at!, null);
  try {
    const snap = await openSnap(bookings, intent, { name: data.customer, phone: data.phone, email: data.email }, config.hold_minutes, config.mode === "full");
    return {
      order_id: order.id, code: order.code, transaction_id: intent.order_id, sessions: bookings.length,
      amount, total: order.total, expires_at: bookings[0].hold_expires_at,
      redirect_url: snap.redirect_url, token: snap.token,
    };
  } catch (error) {
    // Halaman pembayaran gagal dibuat: slot tidak boleh ikut tertahan.
    transaction(() => {
      db.prepare("UPDATE payment_intents SET status='failed',updated_at=? WHERE order_id=?").run(new Date().toISOString(), intent.order_id);
      for (const booking of bookings) {
        db.prepare("UPDATE bookings SET status='expired' WHERE id=? AND status='pending'").run(booking.id);
        releaseAddons(booking.id, "sistem");
      }
    });
    // Pesan asli Midtrans berguna untuk admin, tetapi membingungkan pelanggan.
    console.error("Snap gagal untuk pesanan", order.code, (error as Error).message);
    check(false, 502, "Pembayaran lewat Midtrans belum dapat dimulai. Coba lagi sebentar lagi atau hubungi venue.");
  }
}

/** Staf membuat link pembayaran untuk sisa tagihan satu booking yang sudah ada. */
export async function createPaymentLink(bookingId: string, input: unknown, actor: string) {
  const { amount: requested } = z.object({ amount: z.number().int().positive().max(240000000).optional() }).parse(input ?? {});
  const config = paymentConfig();
  check(config.enabled && config.serverKey, 409, "Pembayaran online belum aktif. Atur dulu di menu Pembayaran.");
  const booking = getBooking(bookingId);
  check(booking.status === "confirmed", 409, "Link pembayaran hanya untuk booking yang masih aktif.");
  const remaining = booking.total - booking.paid;
  const amount = requested ?? remaining;
  check(remaining > 0, 409, "Tagihan booking ini sudah lunas.");
  check(amount >= 1000, 400, "Nominal minimal Rp1.000.");
  check(amount <= remaining, 400, "Nominal melebihi sisa tagihan.");
  const hours = 24;
  const intent = insertIntent(booking.id, null, amount, "tagihan", Math.floor(Date.now() / 1000) + hours * 3600, actor);
  const snap = await openSnap([booking], intent, { name: booking.customer, phone: booking.phone, email: "" }, hours * 60, amount === booking.total);
  audit(actor, "payment.link", booking.id);
  return { ...intentOf(intent.order_id)!, redirect_url: snap.redirect_url };
}

const notificationSchema = z.object({
  order_id: z.string().min(1).max(80),
  status_code: z.string().min(1).max(10),
  gross_amount: z.string().min(1).max(30),
  signature_key: z.string().min(1).max(200),
  transaction_status: z.string().max(40).optional(),
  fraud_status: z.string().max(40).optional(),
  transaction_id: z.string().max(80).optional(),
  payment_type: z.string().max(40).optional(),
});

/** Terapkan status dari Midtrans ke intent dan seluruh sesi pesanannya. Idempoten. */
function applyStatus(intent: PaymentIntent, status: MidtransStatus) {
  const outcome = outcomeOf(status);
  return transaction(() => {
    const stamp = new Date().toISOString();
    db.prepare("UPDATE payment_intents SET status=?,payment_type=?,transaction_id=?,raw_status=?,updated_at=? WHERE order_id=?")
      .run(outcome, status.payment_type ?? intent.payment_type, status.transaction_id ?? intent.transaction_id, status.transaction_status ?? intent.raw_status, stamp, intent.order_id);
    const bookings = intent.order_ref ? orderBookings(intent.order_ref) : [getBooking(intent.booking_id)];
    const config = paymentConfig();
    if (outcome === "paid") {
      const reference = status.transaction_id ?? intent.order_id;
      // Satu pembayaran Midtrans dibagi ke tiap sesi agar pembukuan per booking tetap utuh. Nominal yang
      // ditagih Midtrans adalah patokannya, jadi persen DP yang diubah setelah checkout tidak berpengaruh.
      const shares = allocate(intent.amount, bookings.map(booking => payableAmount(booking.total, config)));
      // Potongan gateway dihitung sekali per transaksi (biaya tetap VA tidak boleh terhitung per sesi).
      const method = paymentMethod(status.payment_type);
      const fees = allocate(gatewayFee(method, intent.amount), shares);
      bookings.forEach((booking, index) => {
        const key = `${reference}:${booking.id.slice(0, 8)}`;
        if (shares[index] > 0 && !db.prepare("SELECT 1 FROM payments WHERE gateway_ref=?").get(key)) {
          db.prepare("INSERT INTO payments (id,booking_id,amount,fee,kind,method,source,gateway_ref,note,created_at) VALUES (?,?,?,?,'payment',?,'gateway',?,?,?)")
            .run(randomUUID(), booking.id, shares[index], Math.min(fees[index], shares[index]), method, key, `Midtrans ${status.payment_type ?? ""}`.trim(), stamp);
        }
        if (booking.status === "expired") {
          // Uang masuk setelah batas bayar lewat: slotnya sudah dilepas, jadi booking ditutup sebagai batal
          // supaya staf dapat mencatat pengembaliannya dan dana tidak menggantung sebagai uang muka.
          db.prepare("UPDATE bookings SET status='cancelled',cancel_reason=? WHERE id=?")
            .run("Pembayaran masuk setelah batas waktu bayar. Dana perlu dikembalikan.", booking.id);
        } else if (booking.status === "pending") {
          try {
            db.prepare("UPDATE bookings SET status='confirmed',hold_expires_at=NULL WHERE id=?").run(booking.id);
          } catch {
            // Slot keburu terisi booking lain: pembayaran tetap tercatat agar staf bisa mengembalikannya.
            db.prepare("UPDATE bookings SET status='cancelled',cancel_reason=? WHERE id=?")
              .run("Slot keburu terisi setelah pembayaran masuk. Dana perlu dikembalikan.", booking.id);
            releaseAddons(booking.id, "midtrans");
          }
        }
      });
      for (const booking of bookings) syncBooking(booking.id);
      audit("midtrans", "payment.settled", intent.order_ref ?? intent.booking_id);
    } else if (outcome !== "pending" && intent.kind === "booking") {
      for (const booking of bookings) {
        if (booking.status !== "pending") continue;
        db.prepare("UPDATE bookings SET status='expired' WHERE id=?").run(booking.id);
        releaseAddons(booking.id, "midtrans");
        syncBooking(booking.id);
      }
      audit("midtrans", "payment." + outcome, intent.order_ref ?? intent.booking_id);
    }
    return { handled: true, outcome, booking: getBooking(intent.booking_id) };
  });
}

/** Webhook Midtrans. Tanda tangan dan nominalnya diperiksa sebelum status dipercaya. */
export function handleNotification(input: unknown) {
  const data = notificationSchema.parse(input);
  const config = paymentConfig();
  check(config.serverKey, 409, "Pembayaran online belum diatur.");
  const intent = intentOf(data.order_id);
  // Order asing tetap dijawab 200 agar Midtrans berhenti mengirim ulang.
  if (!intent) return { handled: false, outcome: null, message: "Order tidak dikenal." };
  check(signatureMatches(signatureFor(data.order_id, data.status_code, data.gross_amount, config.serverKey), data.signature_key), 403, "Tanda tangan notifikasi tidak sah.");
  check(Math.round(Number(data.gross_amount)) === intent.amount, 409, "Nominal notifikasi tidak cocok dengan tagihan.");
  return applyStatus(intent, data);
}

/** Tanya langsung ke Midtrans, dipakai halaman status pelanggan dan tombol periksa di admin. */
export async function refreshIntent(orderId: string) {
  const intent = intentOf(orderId);
  check(intent, 404, "Transaksi tidak ditemukan.");
  if (intent.status !== "pending") return { handled: false, outcome: intent.status };
  const status = await fetchTransactionStatus(orderId);
  if (!status) { expireHolds(); return { handled: false, outcome: "pending" as Outcome }; }
  return applyStatus(intent, status);
}

/** Pesanan dicari dari id order; id booking lama tetap dilayani agar tautan lama tidak mati. */
function findOrder(id: string) {
  const direct = db.prepare("SELECT * FROM orders WHERE id=?").get(id) as unknown as Order | undefined;
  if (direct) return direct;
  const booking = db.prepare("SELECT order_id FROM bookings WHERE id=?").get(id) as { order_id: string | null } | undefined;
  const linked = booking?.order_id ? db.prepare("SELECT * FROM orders WHERE id=?").get(booking.order_id) as unknown as Order | undefined : undefined;
  check(linked, 404, "Pesanan tidak ditemukan.");
  return linked;
}
const latestIntent = (orderId: string) =>
  db.prepare("SELECT * FROM payment_intents WHERE order_ref=? ORDER BY created_at DESC LIMIT 1").get(orderId) as unknown as PaymentIntent | undefined;

export async function refreshOrder(id: string) {
  const order = findOrder(id);
  const intent = latestIntent(order.id);
  check(intent, 404, "Pesanan ini belum punya transaksi pembayaran.");
  return refreshIntent(intent.order_id);
}

/** Halaman status pesanan. Nomor telepon disamarkan karena tautannya bisa diteruskan. */
export function orderView(id: string) {
  expireHolds();
  const order = findOrder(id);
  const sessions = orderBookings(order.id);
  const intent = latestIntent(order.id);
  const paid = sessions.reduce((sum, booking) => sum + booking.paid, 0);
  const total = sessions.reduce((sum, booking) => sum + booking.total, 0);
  const states = new Set(sessions.map(booking => booking.status));
  return {
    order: {
      id: order.id, code: order.code, customer: order.customer,
      phone: order.phone.replace(/\d(?=\d{3})/g, "•"),
      status: states.size === 1 ? [...states][0] : sessions.some(booking => booking.status === "confirmed") ? "confirmed" : "pending",
      total, paid, notes: order.notes, created_at: order.created_at,
      sessions: sessions.map(booking => ({
        id: booking.id, code: bookingCode(booking.id), court_name: booking.court_name, date: booking.date,
        start_time: booking.start_time, end_time: booking.end_time, status: booking.status,
        court_total: booking.court_total, total: booking.total, paid: booking.paid, cancel_reason: booking.cancel_reason,
        discount: booking.discount, discount_note: booking.discount_note,
        tax: booking.tax, tax_rate: booking.tax_rate, tax_inclusive: booking.tax_inclusive, tax_label: booking.tax_label,
        addons: bookingAddons(booking.id).map(line => ({ name: line.name, quantity: line.quantity, subtotal: line.subtotal })),
      })),
    },
    payment: intent ? {
      order_id: intent.order_id, status: intent.status, amount: intent.amount, kind: intent.kind,
      redirect_url: intent.status === "pending" ? intent.redirect_url : null,
      snap_token: intent.status === "pending" ? intent.snap_token : null,
      expires_at: intent.expires_at, payment_type: intent.payment_type, updated_at: intent.updated_at,
    } : null,
  };
}
