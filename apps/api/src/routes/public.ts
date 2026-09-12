import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import * as ops from "../operations.js";

const router = Router();

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
  res.json({ venue: data.venue, features: data.features, timezone: data.timezone, today: data.today, courts: data.courts.map(entry => entry.court) });
});

router.get("/availability", (req, res) => res.json(ops.publicAvailability(requestedDate(req.query.date))));

export default router;
