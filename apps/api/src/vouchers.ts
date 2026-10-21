import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, isDuplicate, transaction } from "./store.js";
import { check, HttpError } from "./errors.js";
import { allocate } from "./bill.js";
import { localClock } from "./clock.js";

/**
 * Voucher dan kode promo.
 *
 * - Jenis `percent` menyimpan persen dalam basis poin (1000 = 10%) dan boleh punya batas potongan
 *   (`max_discount`); jenis `amount` adalah potongan rupiah tetap.
 * - `target` menentukan yang didiskon: seluruh belanja (lapangan + tambahan, tanpa biaya lain yang
 *   diketik kasir) atau sewa lapangan saja. `min_order` dibandingkan dengan subtotal sebelum potongan.
 * - `channel` membatasi tempat kode dipakai: situs pelanggan (`online`), kasir (`kasir`), atau keduanya.
 * - Satu pesanan online (berapa pun sesinya) dihitung satu kali pemakaian. Kuota dan batas per
 *   pelanggan dihitung dari pemakaian yang transaksinya masih hidup (lihat `liveUse`).
 * - Potongan dihitung sekali saat kode dipakai lalu disalin ke booking/transaksi. Bila tambahan atau
 *   jadwal booking berubah setelahnya, nilai potongannya tetap.
 *
 * Modul ini sengaja hanya bergantung pada store/bill agar payments.ts, operations.ts, dan counter.ts
 * bisa memakainya tanpa lingkaran impor.
 */
export interface Voucher {
  id: string; code: string; name: string; description: string; kind: "percent" | "amount"; value: number;
  max_discount: number | null; min_order: number; target: "all" | "court"; channel: "all" | "online" | "kasir";
  quota: number | null; per_customer: number | null; starts_on: string | null; ends_on: string | null;
  active: number; created_by: string | null; created_at: string; updated_at: string;
}
export type VoucherChannel = "online" | "kasir";

const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid."), z.literal(""), z.null()]).default(null).transform(value => value || null);
const optionalCount = (label: string) => z.union([z.number().int(`${label} harus bilangan bulat.`).min(1, `${label} minimal 1.`).max(1_000_000), z.null()]).default(null);
export const voucherSchema = z.object({
  code: z.string().trim().min(3, "Kode minimal 3 karakter.").max(32, "Kode maksimal 32 karakter.")
    .transform(value => value.toUpperCase()).refine(value => /^[A-Z0-9_-]+$/.test(value), "Kode hanya boleh huruf, angka, tanda hubung, dan garis bawah, tanpa spasi."),
  name: z.string().trim().min(3, "Nama promo minimal 3 karakter.").max(120, "Nama promo maksimal 120 karakter."),
  description: z.string().trim().max(500, "Keterangan maksimal 500 karakter.").default(""),
  kind: z.enum(["percent", "amount"], "Pilih jenis potongan."),
  /** Persen dalam basis poin (1000 = 10%), atau rupiah. */
  value: z.number("Isi besar potongan.").int().positive("Besar potongan harus lebih dari 0.").max(240_000_000),
  max_discount: z.union([z.number().int().positive("Batas potongan harus lebih dari 0.").max(240_000_000), z.null()]).default(null),
  min_order: z.number().int().min(0, "Minimal belanja tidak boleh negatif.").max(240_000_000).default(0),
  target: z.enum(["all", "court"]).default("all"),
  channel: z.enum(["all", "online", "kasir"]).default("all"),
  quota: optionalCount("Kuota"),
  per_customer: optionalCount("Batas per pelanggan"),
  starts_on: optionalDate,
  ends_on: optionalDate,
  active: z.boolean().default(true),
}).superRefine((value, ctx) => {
  // Potongan 100% membuat tagihan Rp0, yang tidak bisa dibayar maupun dijurnal sebagai penjualan.
  if (value.kind === "percent" && value.value > 9900) ctx.addIssue({ code: "custom", path: ["value"], message: "Potongan persen paling besar 99%." });
  if (value.kind === "amount" && value.max_discount !== null) value.max_discount = null;
  if (value.starts_on && value.ends_on && value.starts_on > value.ends_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "Tanggal selesai harus sama atau setelah tanggal mulai." });
});

const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");
/** Nomor disimpan seragam 62xx agar pemakaian per pelanggan dikenali walau diketik 08xx atau +62. */
export function normalizedPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return "";
  return digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("62") ? digits : "62" + digits;
}

/**
 * Pemakaian yang masih dihitung: booking yang aktif, selesai, atau masih memegang slot, dan transaksi
 * kasir yang lunas atau menunggu bayar. Pesanan yang kedaluwarsa atau dibatalkan otomatis lepas.
 */
const liveUse = `(
  (r.sale_id IS NOT NULL AND EXISTS (SELECT 1 FROM counter_sales s WHERE s.id=r.sale_id AND s.status IN ('paid','pending')))
  OR (r.sale_id IS NULL AND EXISTS (SELECT 1 FROM bookings b WHERE (b.id=r.booking_id OR (r.order_id IS NOT NULL AND b.order_id=r.order_id))
    AND b.voucher_id=r.voucher_id AND (b.status IN ('confirmed','completed') OR (b.status='pending' AND b.hold_expires_at>UNIX_TIMESTAMP()))))
)`;
async function usedCount(voucherId: string) {
  return Number((await db.prepare(`SELECT COUNT(*) n FROM voucher_redemptions r WHERE r.voucher_id=? AND ${liveUse}`).get(voucherId) as { n: number }).n);
}
async function usedBy(voucherId: string, phone: string, accountId: string | null) {
  return Number((await db.prepare(`SELECT COUNT(*) n FROM voucher_redemptions r WHERE r.voucher_id=? AND (r.phone=? OR (? IS NOT NULL AND r.account_id=?)) AND ${liveUse}`)
    .get(voucherId, phone, accountId, accountId) as { n: number }).n);
}

const rupiah = (value: number) => "Rp" + value.toLocaleString("id-ID");
export const percentLabel = (basisPoints: number) => `${(basisPoints / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
/** Ringkasan satu baris, mis. "10% s.d. Rp50.000 · min. Rp200.000". */
export function voucherSummary(voucher: Pick<Voucher, "kind" | "value" | "max_discount" | "min_order" | "target">) {
  const amount = voucher.kind === "percent" ? `${percentLabel(voucher.value)}${voucher.max_discount ? ` s.d. ${rupiah(voucher.max_discount)}` : ""}` : rupiah(voucher.value);
  return [`Potongan ${amount}${voucher.target === "court" ? " sewa lapangan" : ""}`, voucher.min_order ? `min. belanja ${rupiah(voucher.min_order)}` : ""].filter(Boolean).join(" · ");
}

/** Sisa tagihan paling kecil setelah voucher; sama dengan nominal terkecil yang diterima Midtrans. */
export const minimumLeft = 1000;
/** Bagian tiap sesi/transaksi yang dihitung untuk voucher. `cap` = sisa tagihan setelah potongan lain. */
export interface VoucherPart { court: number; extras: number; subtotal: number; cap: number }
export interface VoucherContext {
  channel: VoucherChannel;
  phone?: string | null;
  accountId?: string | null;
  /** Lewati pemeriksaan kuota dan batas per pelanggan. */
  ignoreLimits?: boolean;
  /**
   * Keranjang yang nomor HP-nya belum diisi: batas per pelanggan baru diperiksa saat checkout,
   * agar pelanggan tidak diminta mengisi data diri hanya untuk melihat potongannya.
   */
  deferCustomerCheck?: boolean;
}

/**
 * Cari voucher yang boleh dipakai untuk belanja ini dan hitung potongan per bagian. Melempar galat
 * berbahasa pelanggan bila kode tidak berlaku. Dipanggil di dalam transaksi saat kode benar-benar
 * dipakai, sehingga kuota tidak bisa terlampaui oleh dua pesanan bersamaan.
 */
export async function resolveVoucher(code: string, parts: VoucherPart[], context: VoucherContext) {
  const normalized = normalizeCode(code);
  check(normalized, 400, "Isi kode voucher.");
  const voucher = await db.prepare("SELECT * FROM vouchers WHERE code=?").get(normalized) as Voucher | undefined;
  check(voucher && voucher.active, 404, `Kode voucher ${normalized} tidak ditemukan atau sudah tidak aktif.`);
  const today = localClock().date;
  if (voucher.starts_on && voucher.starts_on > today) check(false, 409, `Voucher ${voucher.code} baru bisa dipakai mulai ${formatDate(voucher.starts_on)}.`);
  if (voucher.ends_on && today > voucher.ends_on) check(false, 409, `Voucher ${voucher.code} sudah berakhir pada ${formatDate(voucher.ends_on)}.`);
  check(voucher.channel === "all" || voucher.channel === context.channel, 409,
    voucher.channel === "online" ? `Voucher ${voucher.code} hanya berlaku untuk pemesanan lewat situs.` : `Voucher ${voucher.code} hanya berlaku di kasir venue.`);
  const subtotal = parts.reduce((sum, part) => sum + part.subtotal, 0);
  check(subtotal >= voucher.min_order, 409, `Voucher ${voucher.code} berlaku untuk belanja minimal ${rupiah(voucher.min_order)}. Belanja Anda ${rupiah(subtotal)}.`);
  const bases = parts.map(part => Math.max(0, Math.min(voucher.target === "court" ? part.court : part.court + part.extras, part.cap)));
  const base = bases.reduce((sum, value) => sum + value, 0);
  check(base > 0, 409, voucher.target === "court" ? `Voucher ${voucher.code} hanya untuk sewa lapangan.` : `Tidak ada belanja yang bisa dipotong voucher ${voucher.code}.`);
  if (!context.ignoreLimits) {
    if (voucher.quota !== null) check(await usedCount(voucher.id) < voucher.quota, 409, `Kuota voucher ${voucher.code} sudah habis.`);
    const phone = normalizedPhone(context.phone);
    if (voucher.per_customer !== null && (phone || context.accountId || !context.deferCustomerCheck)) {
      check(phone || context.accountId, 400, `Voucher ${voucher.code} dibatasi per pelanggan. Isi nomor HP pelanggan terlebih dahulu.`);
      check(await usedBy(voucher.id, phone, context.accountId ?? null) < voucher.per_customer, 409,
        voucher.per_customer === 1 ? `Voucher ${voucher.code} sudah pernah dipakai nomor ini.` : `Voucher ${voucher.code} sudah dipakai ${voucher.per_customer} kali oleh nomor ini.`);
    }
  }
  let amount = voucher.kind === "percent" ? Math.round(base * voucher.value / 10000) : voucher.value;
  if (voucher.max_discount) amount = Math.min(amount, voucher.max_discount);
  amount = Math.min(amount, base);
  // Tagihan tidak boleh menjadi Rp0 (tidak bisa dibayar maupun dijurnal): sisanya paling sedikit
  // `minimumLeft` untuk seluruh belanja, dan setiap sesi tetap punya tagihan.
  const limits = parts.map((part, index) => Math.min(bases[index], Math.max(0, part.cap - 1)));
  const room = Math.min(limits.reduce((sum, value) => sum + value, 0), parts.reduce((sum, part) => sum + part.cap, 0) - minimumLeft);
  check(room > 0, 409, `Voucher ${voucher.code} tidak dapat dipakai: sisa tagihan setelah voucher minimal ${rupiah(minimumLeft)}.`);
  const shares = allocate(Math.min(amount, room), bases).map((share, index) => Math.min(share, limits[index]));
  const total = shares.reduce((sum, value) => sum + value, 0);
  return { voucher, shares, amount: total };
}

/** Pratinjau tanpa galat: dipakai keranjang dan formulir kasir sebelum transaksi dibuat. */
export async function previewVoucher(code: string, parts: VoucherPart[], context: VoucherContext) {
  try {
    const result = await resolveVoucher(code, parts, context);
    return { ok: true as const, code: result.voucher.code, name: result.voucher.name, summary: voucherSummary(result.voucher), amount: result.amount, shares: result.shares, message: "" };
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Voucher belum dapat diperiksa. Coba lagi.";
    if (!(error instanceof HttpError)) console.error("Pratinjau voucher gagal", error);
    return { ok: false as const, code: normalizeCode(code), name: "", summary: "", amount: 0, shares: parts.map(() => 0), message };
  }
}

/** Catat pemakaian; dipanggil di transaksi yang sama dengan pembuatan booking/transaksi. */
export async function recordRedemption(input: {
  voucher: Voucher; amount: number; channel: VoucherChannel; order_id?: string | null; booking_id?: string | null; sale_id?: string | null;
  customer_id?: string | null; account_id?: string | null; customer: string; phone: string; actor: string | null;
}) {
  await db.prepare(`INSERT INTO voucher_redemptions (id,voucher_id,code,order_id,booking_id,sale_id,customer_id,account_id,customer,phone,channel,amount,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), input.voucher.id, input.voucher.code, input.order_id ?? null, input.booking_id ?? null, input.sale_id ?? null,
    input.customer_id ?? null, input.account_id ?? null, input.customer.slice(0, 255), normalizedPhone(input.phone), input.channel, input.amount, input.actor, new Date().toISOString());
}

const formatDate = (value: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));

// --- Kelola voucher (admin) --------------------------------------------------------------

/** Daftar voucher beserta pemakaian dan total potongan yang sudah diberikan. */
export async function listVouchers() {
  const rows = await db.prepare("SELECT * FROM vouchers ORDER BY active DESC, created_at DESC").all() as Voucher[];
  const today = localClock().date;
  const list = [];
  for (const voucher of rows) list.push({ ...voucher, ...await usage(voucher.id), state: stateOf(voucher, today), summary: voucherSummary(voucher) });
  return { vouchers: list, today };
}
function stateOf(voucher: Voucher, today: string) {
  if (!voucher.active) return "inactive" as const;
  if (voucher.starts_on && voucher.starts_on > today) return "scheduled" as const;
  if (voucher.ends_on && voucher.ends_on < today) return "ended" as const;
  return "running" as const;
}
/** Pemakaian hidup dan nilai potongannya, dihitung dari booking dan transaksi kasir yang memakainya. */
async function usage(voucherId: string) {
  const used = await usedCount(voucherId);
  const bookings = Number((await db.prepare("SELECT COALESCE(SUM(voucher_discount),0) n FROM bookings WHERE voucher_id=? AND status IN ('confirmed','completed')").get(voucherId) as { n: number }).n);
  const sales = Number((await db.prepare("SELECT COALESCE(SUM(voucher_discount),0) n FROM counter_sales WHERE voucher_id=? AND status='paid'").get(voucherId) as { n: number }).n);
  return { used, discount_given: bookings + sales };
}

export async function voucherDetail(id: string) {
  const voucher = await db.prepare("SELECT * FROM vouchers WHERE id=?").get(id) as Voucher | undefined;
  check(voucher, 404, "Voucher tidak ditemukan.");
  const redemptions = await db.prepare(`SELECT r.id,r.code,r.order_id,r.booking_id,r.sale_id,r.customer,r.phone,r.channel,r.amount,r.created_at,
      ${liveUse} live,
      o.code order_code, s.number sale_number,
      (SELECT GROUP_CONCAT(DISTINCT b.status) FROM bookings b WHERE b.id=r.booking_id OR (r.order_id IS NOT NULL AND b.order_id=r.order_id)) booking_status,
      s.status sale_status
    FROM voucher_redemptions r LEFT JOIN orders o ON o.id=r.order_id LEFT JOIN counter_sales s ON s.id=r.sale_id
    WHERE r.voucher_id=? ORDER BY r.created_at DESC LIMIT 100`).all(id) as Record<string, unknown>[];
  return {
    voucher: { ...voucher, ...await usage(voucher.id), state: stateOf(voucher, localClock().date), summary: voucherSummary(voucher) },
    redemptions: redemptions.map(row => ({ ...row, live: !!Number(row.live) })),
  };
}

export async function saveVoucher(input: unknown, actor: string, id?: string) {
  const data = voucherSchema.parse(input);
  try {
    return await transaction(async () => {
      const now = new Date().toISOString();
      if (id) {
        const before = await db.prepare("SELECT * FROM vouchers WHERE id=?").get(id) as Voucher | undefined;
        check(before, 404, "Voucher tidak ditemukan.");
        // Kode yang sudah dipakai pelanggan tidak boleh diganti: riwayat dan nota menyebut kode lama.
        if (before.code !== data.code) check(!await db.prepare("SELECT 1 FROM voucher_redemptions WHERE voucher_id=? LIMIT 1").get(id), 409, "Kode voucher yang sudah pernah dipakai tidak dapat diganti. Buat voucher baru atau nonaktifkan yang ini.");
        await db.prepare(`UPDATE vouchers SET code=?,name=?,description=?,kind=?,value=?,max_discount=?,min_order=?,target=?,channel=?,quota=?,per_customer=?,starts_on=?,ends_on=?,active=?,updated_at=? WHERE id=?`)
          .run(data.code, data.name, data.description, data.kind, data.value, data.max_discount, data.min_order, data.target, data.channel, data.quota, data.per_customer, data.starts_on, data.ends_on, data.active ? 1 : 0, now, id);
        await audit(actor, "voucher.update", id, { before: pick(before), after: pick({ ...data, active: data.active ? 1 : 0 }) });
      } else {
        id = randomUUID();
        await db.prepare(`INSERT INTO vouchers (id,code,name,description,kind,value,max_discount,min_order,target,channel,quota,per_customer,starts_on,ends_on,active,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, data.code, data.name, data.description, data.kind, data.value, data.max_discount, data.min_order, data.target, data.channel, data.quota, data.per_customer, data.starts_on, data.ends_on, data.active ? 1 : 0, actor, now, now);
        await audit(actor, "voucher.create", id, pick({ ...data, active: data.active ? 1 : 0 }));
      }
      return (await voucherDetail(id!)).voucher;
    });
  } catch (error) {
    if (isDuplicate(error)) check(false, 409, `Kode ${data.code} sudah dipakai voucher lain.`);
    throw error;
  }
}
const pick = (value: Partial<Voucher>) => ({ code: value.code, kind: value.kind, value: value.value, max_discount: value.max_discount, min_order: value.min_order, target: value.target, channel: value.channel, quota: value.quota, per_customer: value.per_customer, starts_on: value.starts_on, ends_on: value.ends_on, active: value.active });

/** Voucher yang belum pernah dipakai boleh dihapus; yang sudah dipakai cukup dinonaktifkan agar riwayatnya utuh. */
export async function removeVoucher(id: string, actor: string) {
  await transaction(async () => {
    const voucher = await db.prepare("SELECT code FROM vouchers WHERE id=?").get(id) as { code: string } | undefined;
    check(voucher, 404, "Voucher tidak ditemukan.");
    check(!await db.prepare("SELECT 1 FROM voucher_redemptions WHERE voucher_id=? LIMIT 1").get(id), 409, `Voucher ${voucher.code} sudah pernah dipakai, jadi tidak dapat dihapus. Nonaktifkan saja agar riwayatnya tetap tersimpan.`);
    await db.prepare("DELETE FROM vouchers WHERE id=?").run(id);
    await audit(actor, "voucher.delete", id, { code: voucher.code });
  });
}
