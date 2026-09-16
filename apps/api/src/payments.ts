import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, transaction } from "./store.js";
import { check } from "./errors.js";
import { minutes } from "./clock.js";
import { applyLines, bookingAddons, releaseAddons } from "./addons.js";
import { closeSchema, dateSchema, ensureSlot, getBooking, priceRules, quote, timeSchema, type Booking } from "./operations.js";
import {
  createSnapTransaction, fetchTransactionStatus, outcomeOf, paymentConfig, paymentMethod,
  payableAmount, signatureFor, signatureMatches, type MidtransStatus, type Outcome,
} from "./midtrans.js";
import { publicUrl } from "./config.js";

/**
 * Pembayaran online lewat Midtrans Snap.
 *
 * Alur pelanggan: pilih jadwal -> booking berstatus `pending` dengan `hold_expires_at`, sehingga
 * slotnya terkunci oleh trigger jadwal -> halaman pembayaran Snap -> webhook Midtrans mengubah
 * booking menjadi `confirmed` dan mencatat pembayaran. Bila tidak dibayar sampai batas waktu,
 * booking menjadi `expired`, slot terbuka lagi, dan stok barang jual kembali.
 *
 * Staf juga dapat membuat link tagihan untuk booking yang sudah berjalan (kind `tagihan`);
 * link itu hanya mencatat pembayaran, tidak mengubah status booking.
 */
export interface PaymentIntent {
  order_id: string; booking_id: string; amount: number; kind: "booking" | "tagihan"; status: Outcome;
  snap_token: string | null; redirect_url: string | null; payment_type: string | null; transaction_id: string | null;
  environment: string; expires_at: number; created_by: string | null; created_at: string; updated_at: string; raw_status: string | null;
}
export const bookingCode = (id: string) => id.slice(0, 8).toUpperCase();
const intentOf = (orderId: string) => db.prepare("SELECT * FROM payment_intents WHERE order_id=?").get(orderId) as unknown as PaymentIntent | undefined;
export const bookingIntents = (bookingId: string) =>
  db.prepare("SELECT * FROM payment_intents WHERE booking_id=? ORDER BY created_at DESC").all(bookingId) as unknown as PaymentIntent[];
/** Transaksi terbaru untuk panel admin, lengkap dengan data booking-nya. */
export const recentIntents = (limit = 30) =>
  db.prepare(`SELECT i.*,b.customer,b.date,b.start_time,b.end_time,b.status booking_status,c.name court_name
    FROM payment_intents i JOIN bookings b ON b.id=i.booking_id JOIN courts c ON c.id=b.court_id
    ORDER BY i.created_at DESC LIMIT ?`).all(limit) as unknown as (PaymentIntent & { customer: string; date: string; start_time: string; end_time: string; booking_status: string; court_name: string })[];

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
      db.prepare("UPDATE payment_intents SET status='expired',updated_at=? WHERE booking_id=? AND status='pending'").run(stamp, booking.id);
      audit("sistem", "booking.expired", booking.id);
    }
    return stale.length;
  });
}

export const checkoutSchema = z.object({
  court_id: z.string().min(1),
  date: dateSchema, start_time: timeSchema, end_time: closeSchema,
  customer: z.string().trim().min(2, "Isi nama pemesan.").max(80),
  phone: z.string().trim().min(9, "Nomor telepon tidak valid.").max(18),
  email: z.union([z.email("Email tidak valid."), z.literal("")]).default(""),
  notes: z.string().trim().max(300, "Catatan maksimal 300 karakter.").default(""),
  addons: z.array(z.object({ addon_id: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) })).max(20).default([]),
});

/** 08xx dan +62xx disimpan seragam sebagai 62xx agar pelanggan lama dikenali. */
function normalizePhone(value: string) {
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

/** Rincian item untuk halaman Midtrans; jumlahnya wajib sama persis dengan nominal tagihan. */
function itemsFor(booking: Booking, amount: number) {
  if (amount !== booking.total)
    return [{ id: "dp", price: amount, quantity: 1, name: `DP ${booking.court_name}`.slice(0, 50) }];
  const items = [
    { id: "lapangan", price: booking.court_total, quantity: 1, name: `Sewa ${booking.court_name}`.slice(0, 50) },
    ...bookingAddons(booking.id).map(line => ({
      id: line.id.slice(0, 50), price: Math.round(line.subtotal / line.quantity), quantity: line.quantity, name: line.name.slice(0, 50),
    })),
  ];
  // Harga per jam yang dibagi rata bisa menyisakan selisih rupiah; catat sebagai penyesuaian.
  const sum = items.reduce((total, item) => total + item.price * item.quantity, 0);
  if (sum !== amount) items.push({ id: "penyesuaian", price: amount - sum, quantity: 1, name: "Penyesuaian pembulatan" });
  return items;
}
async function openSnap(booking: Booking, intent: PaymentIntent, email: string, expiryMinutes: number) {
  const snap = await createSnapTransaction({
    transaction_details: { order_id: intent.order_id, gross_amount: intent.amount },
    item_details: itemsFor(booking, intent.amount),
    customer_details: { first_name: booking.customer.slice(0, 20), phone: booking.phone.slice(0, 19), ...(email ? { email: email.slice(0, 45) } : {}) },
    // Tanpa start_time, Midtrans memakai waktu transaksi sebagai awal hitungan.
    expiry: { unit: "minute", duration: expiryMinutes },
    callbacks: { finish: `${publicUrl}/pesanan/${booking.id}` },
  });
  db.prepare("UPDATE payment_intents SET snap_token=?,redirect_url=?,updated_at=? WHERE order_id=?")
    .run(snap.token, snap.redirect_url, new Date().toISOString(), intent.order_id);
  return snap;
}
const newOrderId = (bookingId: string) => `PDX-${bookingCode(bookingId)}-${Date.now().toString(36).toUpperCase()}`;
function insertIntent(bookingId: string, amount: number, kind: "booking" | "tagihan", expiresAt: number, actor: string | null) {
  const stamp = new Date().toISOString(), orderId = newOrderId(bookingId);
  db.prepare("INSERT INTO payment_intents (order_id,booking_id,amount,kind,status,environment,expires_at,created_by,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?,?,?,?)")
    .run(orderId, bookingId, amount, kind, paymentConfig().environment, expiresAt, actor, stamp, stamp);
  return intentOf(orderId)!;
}

/** Pelanggan memesan dan membayar sendiri. Slot terkunci begitu booking pending tersimpan. */
export async function createCheckout(input: unknown) {
  const data = checkoutSchema.parse(input);
  const config = paymentConfig();
  check(config.enabled && config.serverKey, 409, "Pembayaran online belum aktif. Silakan hubungi venue lewat WhatsApp.");
  const duration = minutes(data.end_time) - minutes(data.start_time);
  check(duration >= 60 && duration <= 180, 400, "Durasi main antara 1 sampai 3 jam.");
  expireHolds();

  const booking = transaction(() => {
    const court = ensureSlot(data.court_id, data.date, data.start_time, data.end_time);
    const total = quote(court, priceRules(), data.date, data.start_time, data.end_time);
    const customerId = upsertCustomer(data.customer, data.phone, data.email);
    const id = randomUUID();
    db.prepare(`INSERT INTO bookings (id,court_id,customer_id,customer,phone,date,start_time,end_time,total,court_total,status,source,hold_expires_at,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'pending','online',unixepoch()+?,?,?)`)
      .run(id, data.court_id, customerId, data.customer, data.phone, data.date, data.start_time, data.end_time, total, total, config.hold_minutes * 60, data.notes, new Date().toISOString());
    if (data.addons.length) applyLines(getBooking(id), data.addons, customerId);
    audit(customerId, "booking.checkout", id);
    return getBooking(id);
  });

  const intent = insertIntent(booking.id, payableAmount(booking.total, config), "booking", booking.hold_expires_at!, null);
  try {
    const snap = await openSnap(booking, intent, data.email, config.hold_minutes);
    return {
      booking_id: booking.id, code: bookingCode(booking.id), order_id: intent.order_id,
      amount: intent.amount, total: booking.total, expires_at: booking.hold_expires_at,
      redirect_url: snap.redirect_url, token: snap.token,
    };
  } catch (error) {
    // Halaman pembayaran gagal dibuat: slot tidak boleh ikut tertahan.
    transaction(() => {
      db.prepare("UPDATE payment_intents SET status='failed',updated_at=? WHERE order_id=?").run(new Date().toISOString(), intent.order_id);
      db.prepare("UPDATE bookings SET status='expired' WHERE id=? AND status='pending'").run(booking.id);
      releaseAddons(booking.id, "sistem");
    });
    throw error;
  }
}

/** Staf membuat link pembayaran untuk sisa tagihan booking yang sudah ada. */
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
  const intent = insertIntent(booking.id, amount, "tagihan", Math.floor(Date.now() / 1000) + hours * 3600, actor);
  const snap = await openSnap(booking, intent, "", hours * 60);
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

/** Terapkan status dari Midtrans ke intent dan booking-nya. Idempoten: notifikasi ganda aman. */
function applyStatus(intent: PaymentIntent, status: MidtransStatus) {
  const outcome = outcomeOf(status);
  return transaction(() => {
    const stamp = new Date().toISOString();
    db.prepare("UPDATE payment_intents SET status=?,payment_type=?,transaction_id=?,raw_status=?,updated_at=? WHERE order_id=?")
      .run(outcome, status.payment_type ?? intent.payment_type, status.transaction_id ?? intent.transaction_id, status.transaction_status ?? intent.raw_status, stamp, intent.order_id);
    const booking = getBooking(intent.booking_id);
    if (outcome === "paid") {
      const reference = status.transaction_id ?? intent.order_id;
      if (!db.prepare("SELECT 1 FROM payments WHERE gateway_ref=?").get(reference)) {
        db.prepare("INSERT INTO payments (id,booking_id,amount,kind,method,source,gateway_ref,note,created_at) VALUES (?,?,?,'payment',?,'gateway',?,?,?)")
          .run(randomUUID(), booking.id, intent.amount, paymentMethod(status.payment_type), reference, `Midtrans ${status.payment_type ?? ""}`.trim(), stamp);
      }
      if (booking.status === "pending") {
        try {
          db.prepare("UPDATE bookings SET status='confirmed',hold_expires_at=NULL WHERE id=?").run(booking.id);
        } catch {
          // Slot keburu terisi booking lain: pembayaran tetap tercatat agar staf bisa mengembalikannya.
          db.prepare("UPDATE bookings SET status='cancelled',cancel_reason=? WHERE id=?")
            .run("Slot keburu terisi setelah pembayaran masuk. Dana perlu dikembalikan.", booking.id);
          releaseAddons(booking.id, "midtrans");
        }
      }
      audit("midtrans", "payment.settled", booking.id);
    } else if (outcome !== "pending" && intent.kind === "booking" && booking.status === "pending") {
      db.prepare("UPDATE bookings SET status='expired' WHERE id=?").run(booking.id);
      releaseAddons(booking.id, "midtrans");
      audit("midtrans", "payment." + outcome, booking.id);
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
export async function refreshOrder(bookingId: string) {
  const [latest] = bookingIntents(bookingId);
  check(latest, 404, "Pesanan tidak ditemukan.");
  return refreshIntent(latest.order_id);
}

/** Halaman status pesanan pelanggan. Nomor telepon disamarkan karena tautannya bisa diteruskan. */
export function orderView(bookingId: string) {
  expireHolds();
  const booking = getBooking(bookingId);
  check(booking.source === "online", 404, "Pesanan tidak ditemukan.");
  const [intent] = bookingIntents(bookingId);
  const phone = booking.phone.replace(/\d(?=\d{3})/g, "•");
  return {
    order: {
      id: booking.id, code: bookingCode(booking.id), court_name: booking.court_name, date: booking.date,
      start_time: booking.start_time, end_time: booking.end_time, customer: booking.customer, phone,
      status: booking.status, total: booking.total, court_total: booking.court_total, paid: booking.paid,
      notes: booking.notes, cancel_reason: booking.cancel_reason, created_at: booking.created_at,
      addons: bookingAddons(bookingId).map(line => ({ name: line.name, quantity: line.quantity, subtotal: line.subtotal })),
    },
    payment: intent ? {
      order_id: intent.order_id, status: intent.status, amount: intent.amount, kind: intent.kind,
      redirect_url: intent.status === "pending" ? intent.redirect_url : null,
      expires_at: intent.expires_at, payment_type: intent.payment_type, updated_at: intent.updated_at,
    } : null,
  };
}
