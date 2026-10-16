import { z } from "zod";
import { audit, db, transaction } from "./store.js";

/**
 * Informasi yang membangun kepercayaan pelanggan: profil dan kontak venue,
 * fasilitas, kebijakan pembatalan, syarat & ketentuan, serta FAQ.
 * Semuanya memang untuk publik dan disimpan sebagai dokumen di tabel settings.
 */
export const facilityKinds = ["parkir", "toilet", "kamar-bilas", "musala", "kantin", "ruang-tunggu", "wifi", "loker", "sewa-raket", "sewa-bola", "pelatih", "p3k"] as const;

const text = (max: number, label: string) => z.string().trim().max(max, `${label} maksimal ${max} karakter.`).default("");

/** 0812…, +62 812…, dan 62812… disimpan seragam sebagai 62812… agar langsung dapat dipakai tautan wa.me. */
export function normalizeWhatsapp(value: string) {
  const digits = value.replace(/[\s().-]/g, "");
  if (digits.startsWith("+62")) return digits.slice(1);
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

const httpsUrl = (value: string) => {
  if (!value) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

export const infoSchema = z.object({
  name: text(60, "Nama venue"),
  tagline: text(120, "Tagline"),
  about: text(1500, "Deskripsi venue"),
  address: text(240, "Alamat"),
  maps_url: z.string().trim().max(500).refine(httpsUrl, "Tautan Google Maps harus diawali https://.").default(""),
  show_map: z.boolean().default(true),
  whatsapp: z.string().trim().max(24).transform(normalizeWhatsapp)
    .refine(value => value === "" || /^628\d{7,12}$/.test(value), "Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.").default(""),
  phone: z.string().trim().max(24).refine(value => value === "" || /^\+?[0-9 ()-]{8,24}$/.test(value), "Nomor telepon tidak valid.").default(""),
  email: z.string().trim().max(120).refine(value => value === "" || z.email().safeParse(value).success, "Email tidak valid.").default(""),
  // Terima @nama, nama, atau tautan profil lengkap; simpan nama penggunanya saja.
  instagram: z.string().trim().max(120)
    .transform(value => value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, ""))
    .refine(value => /^[A-Za-z0-9._]{0,30}$/.test(value), "Nama pengguna Instagram tidak valid.").default(""),
  hours_note: text(120, "Keterangan jam buka"),
  // Batas lama satu booking online, dalam jam. 0 berarti boleh sampai jam tutup lapangan.
  max_booking_hours: z.number().int().min(0).max(24, "Batas durasi maksimal 24 jam.").default(0),
  facilities: z.array(z.enum(facilityKinds)).max(facilityKinds.length).transform(list => [...new Set(list)]).default([]),
  extra_facilities: z.array(z.string().trim().min(2, "Nama fasilitas minimal 2 karakter.").max(40, "Nama fasilitas maksimal 40 karakter.")).max(10, "Maksimal 10 fasilitas tambahan.").default([]),
});

/**
 * Tingkat pengembalian dana: batal paling lambat `hours` jam sebelum main, dana kembali `percent` persen.
 * Disimpan terstruktur (bukan teks bebas) agar kelak dapat dipakai menghitung refund otomatis saat checkout online.
 */
export const policiesSchema = z.object({
  refund_tiers: z.array(z.object({
    hours: z.number().int().min(0).max(720, "Batas pembatalan maksimal 720 jam (30 hari)."),
    percent: z.number().int().min(1, "Persentase pengembalian minimal 1%.").max(100, "Persentase pengembalian maksimal 100%."),
  })).max(4, "Maksimal 4 tingkat pengembalian dana.")
    .transform(tiers => [...tiers].sort((a, b) => b.hours - a.hours))
    .refine(tiers => tiers.every((tier, index) => index === 0 || tier.hours < tiers[index - 1].hours), "Setiap tingkat pengembalian harus memakai batas jam yang berbeda.")
    .refine(tiers => tiers.every((tier, index) => index === 0 || tier.percent <= tiers[index - 1].percent), "Persentase pengembalian tidak boleh naik saat pembatalan makin dekat ke jam main.")
    .default([]),
  refund_days: z.number().int().min(0).max(60).default(0),
  reschedule: z.enum(["unset", "no", "yes"]).default("unset"),
  reschedule_hours: z.number().int().min(0).max(720).default(0),
  cancellation_note: text(1500, "Catatan pembatalan"),
  terms: text(10000, "Syarat & ketentuan"),
});

export const faqsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(64),
    question: z.string().trim().min(5, "Pertanyaan minimal 5 karakter.").max(160, "Pertanyaan maksimal 160 karakter."),
    answer: z.string().trim().min(2, "Setiap pertanyaan perlu jawaban.").max(1500, "Jawaban maksimal 1500 karakter."),
  })).max(30, "Maksimal 30 pertanyaan.").default([]),
});

function read<T extends object>(key: string, schema: z.ZodType<T>): T & { updated_at: string | null } {
  const row = db.prepare("SELECT document FROM settings WHERE key = ?").get(key) as { document: string } | undefined;
  const stored = row ? JSON.parse(row.document) as Record<string, unknown> : {};
  // Bila skema kelak bertambah kolom, dokumen lama tetap terbaca dan kolom baru memakai nilai bawaan.
  const parsed = schema.safeParse(stored);
  return { ...(parsed.success ? parsed.data : schema.parse({})), updated_at: typeof stored.updated_at === "string" ? stored.updated_at : null };
}

function write<T extends object>(key: string, schema: z.ZodType<T>, input: unknown, actor: string) {
  const document = { ...schema.parse(input), updated_at: new Date().toISOString() };
  transaction(() => {
    db.prepare("INSERT INTO settings (key, document) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET document = excluded.document").run(key, JSON.stringify(document));
    audit(actor, `content.${key}.update`, key);
  });
  return document;
}

export const getInfo = () => read("info", infoSchema);
/** Batas durasi satu sesi booking online dalam menit; null bila hanya dibatasi jam tutup. */
export const maxBookingMinutes = () => { const hours = getInfo().max_booking_hours; return hours > 0 ? hours * 60 : null; };
/** Pesan galat bila durasi di luar batas, atau string kosong bila sah. */
export function durationProblem(duration: number) {
  const max = maxBookingMinutes();
  if (duration < 60) return "Durasi main minimal 1 jam.";
  if (duration % 30 !== 0) return "Durasi main harus kelipatan 30 menit.";
  if (max !== null && duration > max) return `Durasi main maksimal ${(max / 60).toLocaleString("id-ID")} jam per booking.`;
  return "";
}
export const getPolicies = () => read("policies", policiesSchema);
export const getFaqs = () => read("faqs", faqsSchema);
export const saveInfo = (input: unknown, actor: string) => write("info", infoSchema, input, actor);
export const savePolicies = (input: unknown, actor: string) => write("policies", policiesSchema, input, actor);
export const saveFaqs = (input: unknown, actor: string) => write("faqs", faqsSchema, input, actor);
export const content = () => ({ info: getInfo(), policies: getPolicies(), faqs: getFaqs() });
