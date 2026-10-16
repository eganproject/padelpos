import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as ops from "../operations.js";
import { content } from "../content.js";
import { photoFile } from "../photos.js";
import { publicAddons } from "../addons.js";
import { publicPayment } from "../midtrans.js";
import { createCheckout, expireHolds, handleNotification, orderView, quoteCart, refreshOrder } from "../payments.js";
import { check } from "../errors.js";
import { customerAccountId } from "../auth.js";
import { publicLogin } from "../customers.js";

const router = Router();

/**
 * Webhook Midtrans. Diletakkan sebelum rate limit umum karena pengirimnya server Midtrans,
 * bukan pengunjung, dan notifikasi yang tertolak akan dikirim ulang berkali-kali.
 * Keasliannya dijaga oleh tanda tangan SHA512, bukan oleh alamat pengirim.
 */
router.post("/payments/midtrans/notification", rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Terlalu banyak notifikasi." } }), (req, res) => {
  const result = handleNotification(req.body);
  res.json({ status: "ok", handled: result.handled, outcome: result.outcome });
});

// Foto memakai id acak yang tidak pernah berubah isinya, jadi aman di-cache selamanya oleh browser.
// Batasnya dipisah karena satu halaman bisa memuat banyak foto sekaligus.
router.get("/photos/:id", rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Terlalu banyak permintaan." } }), (req, res) => {
  const photo = photoFile(String(req.params.id));
  check(photo, 404, "Foto tidak ditemukan.");
  res.set("Cache-Control", "public, max-age=31536000, immutable").type(photo.mime).send(Buffer.from(photo.data));
});

// Endpoint publik tanpa autentikasi: batasi lalu lintasnya sendiri. Bacaan (GET) diberi kuota lebih
// longgar karena setiap halaman yang digambar server Next.js memanggil /info dan /availability dari
// alamat yang sama (127.0.0.1); dengan kuota 60 per menit beranda sudah tampil "API mati" saat ramai.
const publicLimit = (limit: number) => rateLimit({ windowMs: 60 * 1000, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Terlalu banyak permintaan. Coba lagi sebentar lagi." } });
const readLimit = publicLimit(600), writeLimit = publicLimit(60);
router.use((req, res, next) => (req.method === "GET" || req.method === "HEAD" ? readLimit : writeLimit)(req, res, next));

/** Batasi jendela yang dapat dilihat publik agar jadwal jauh ke depan tidak dapat dipanen. */
const horizonDays = 90;
const requestedDate = (value: unknown) => {
  const today = ops.localClock().date;
  if (value === undefined) return today;
  const date = ops.dateSchema.parse(value);
  const limit = new Date(today + "T12:00:00Z");
  limit.setUTCDate(limit.getUTCDate() + horizonDays);
  if (date < today) throw new z.ZodError([{ code: "custom", path: ["date"], message: "Tanggal sudah lewat." }]);
  if (date > limit.toISOString().slice(0, 10)) throw new z.ZodError([{ code: "custom", path: ["date"], message: `Jadwal hanya tersedia sampai ${horizonDays} hari ke depan.` }]);
  return date;
};

router.get("/venue", (_req, res) => {
  expireHolds();
  const data = ops.publicAvailability(ops.localClock().date);
  res.json({ venue: data.venue, floors: data.floors, features: data.features, timezone: data.timezone, today: data.today, courts: data.courts.map(entry => entry.court) });
});

router.get("/availability", (req, res) => {
  // Booking yang batas bayarnya lewat dilepas dulu agar slotnya tampil kosong lagi.
  expireHolds();
  res.json(ops.publicAvailability(requestedDate(req.query.date)));
});

/** Profil, kontak, fasilitas, kebijakan, FAQ, dan katalog sewa & tambahan. */
router.get("/info", (_req, res) => {
  const { info, policies, faqs } = content();
  res.json({ info, policies, faqs: faqs.items, courts: ops.publicCourts(), addons: publicAddons(), payment: publicPayment(), login: publicLogin() });
});

/** Sewa & tambahan. Dengan tanggal dan jam, `available` menghitung barang yang dipakai booking lain. */
router.get("/addons", (req, res) => {
  if (req.query.date === undefined) return res.json({ addons: publicAddons() });
  const date = requestedDate(req.query.date);
  const { start, end } = z.object({ start: ops.timeSchema, end: z.union([ops.timeSchema, z.literal("24:00")]) })
    .refine(v => v.start < v.end, "Jam selesai harus setelah jam mulai.").parse(req.query);
  res.json({ addons: publicAddons({ date, start, end }) });
});

/** Periksa isi keranjang: harga terbaru, ketersediaan slot, dan stok tambahan. */
router.post("/cart/quote", (req, res) => res.json(quoteCart(req.body)));

/** Pesan dan bayar online. Dibatasi lebih ketat karena setiap panggilan mengunci satu slot. */
router.post("/checkout", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Terlalu banyak percobaan pemesanan. Coba lagi sebentar lagi." } }), async (req, res) => {
  // Pelanggan yang sedang masuk otomatis mendapatkan pesanan ini di riwayat akunnya.
  res.status(201).json(await createCheckout(req.body, customerAccountId(req)));
});

/** Halaman status pesanan. Id booking berupa UUID acak, jadi tautannya tidak dapat ditebak. */
router.get("/orders/:id", (req, res) => res.json(orderView(String(req.params.id))));
router.post("/orders/:id/refresh", async (req, res) => {
  await refreshOrder(String(req.params.id));
  res.json(orderView(String(req.params.id)));
});

export default router;
