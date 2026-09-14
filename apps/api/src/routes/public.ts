import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as ops from "../operations.js";
import { content } from "../content.js";
import { photoFile } from "../photos.js";
import { check } from "../errors.js";

const router = Router();

// Foto memakai id acak yang tidak pernah berubah isinya, jadi aman di-cache selamanya oleh browser.
// Batasnya dipisah karena satu halaman bisa memuat banyak foto sekaligus.
router.get("/photos/:id", rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Terlalu banyak permintaan." } }), (req, res) => {
  const photo = photoFile(String(req.params.id));
  check(photo, 404, "Foto tidak ditemukan.");
  res.set("Cache-Control", "public, max-age=31536000, immutable").type(photo.mime).send(Buffer.from(photo.data));
});

// Endpoint publik tanpa autentikasi: batasi lalu lintasnya sendiri.
router.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Terlalu banyak permintaan. Coba lagi sebentar lagi." } }));

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
  const data = ops.publicAvailability(ops.localClock().date);
  res.json({ venue: data.venue, floors: data.floors, features: data.features, timezone: data.timezone, today: data.today, courts: data.courts.map(entry => entry.court) });
});

router.get("/availability", (req, res) => res.json(ops.publicAvailability(requestedDate(req.query.date))));

/** Profil, kontak, fasilitas, kebijakan, dan FAQ venue. */
router.get("/info", (_req, res) => {
  const { info, policies, faqs } = content();
  res.json({ info, policies, faqs: faqs.items, courts: ops.publicCourts() });
});

export default router;
