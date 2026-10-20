import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, transaction } from "./store.js";
import { check } from "./errors.js";
import { clockLabel, localClock, minutes } from "./clock.js";
import { type Addon, addons, lineSchema, lineTotal, peakUse, recordMove } from "./addons.js";
import { billOf, taxSnapshot } from "./bill.js";
import { syncCounterSale } from "./finance.js";

/**
 * Transaksi langsung di kasir tanpa booking lapangan: pelanggan datang menyewa raket untuk
 * latihan sendiri, membeli bola atau minuman, atau memakai pelatih tanpa memesan lapangan.
 *
 * - Dibayar lunas saat dicatat (tunai, transfer, atau QRIS), jadi jurnalnya langsung masuk kas.
 * - Barang sewa memegang unit dari jam transaksi sampai `end_time`, dihitung bersama booking
 *   lapangan (lihat peakUse), dan dilepas lebih awal begitu ditandai kembali.
 * - Barang jual memotong stok seperti pada booking dan kembali bila transaksinya dibatalkan.
 */
export interface CounterSale {
  id: string; number: string; customer: string; phone: string; date: string; start_time: string; end_time: string;
  subtotal: number; discount: number; discount_note: string; tax: number; tax_rate: number; tax_inclusive: number; tax_label: string;
  total: number; method: string; tendered: number | null; status: "paid" | "void"; notes: string; void_reason: string;
  voided_at: string | null; created_by: string; created_at: string;
}
export interface CounterLine { id: string; sale_id: string; addon_id: string | null; name: string; type: Addon["type"] | "lainnya"; pricing: Addon["pricing"]; unit_price: number; quantity: number; subtotal: number; returned_at: string | null }

const columns = "s.id,s.number,s.customer,s.phone,s.date,s.start_time,s.end_time,s.subtotal,s.discount,s.discount_note,s.tax,s.tax_rate,s.tax_inclusive,s.tax_label,s.total,s.method,s.tendered,s.status,s.notes,s.void_reason,s.voided_at,s.created_by,s.created_at";
const rupiah = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
export const walkInName = "Pelanggan umum";

export const saleSchema = z.object({
  /** Dibuat browser sekali per formulir, agar klik ganda tidak mencatat dua transaksi. */
  id: z.string().uuid().optional(),
  customer: z.string().trim().max(80, "Nama pelanggan maksimal 80 karakter.").default(""),
  phone: z.string().trim().max(18, "Nomor telepon maksimal 18 karakter.").default(""),
  /** Lama sewa dalam menit, kelipatan 30. Tidak berpengaruh bila tidak ada barang sewa atau harga per jam. */
  duration: z.number().int().min(30, "Lama sewa minimal 30 menit.").max(720, "Lama sewa maksimal 12 jam.").refine(value => value % 30 === 0, "Lama sewa harus kelipatan 30 menit.").default(60),
  lines: z.array(lineSchema.omit({ id: true })).min(1, "Pilih minimal satu barang.").max(30, "Maksimal 30 baris per transaksi."),
  method: z.enum(["cash", "transfer", "qris"]),
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
const detail = async (id: string) => ({ sale: await getSale(id), lines: await saleLines(id) });

/** Jam mulai sewa: sekarang dibulatkan ke bawah ke 30 menit, selesai paling lambat 24:00. */
function rentalWindow(duration: number) {
  const now = localClock();
  const start = Math.floor(minutes(now.time) / 30) * 30;
  return { date: now.date, start: clockLabel(start), end: clockLabel(Math.min(1440, start + duration)) };
}

/** Pilihan barang untuk transaksi kasir, dengan sisa stok pada jam sekarang sampai lama sewa yang dipilih. */
export async function saleOptions(input: unknown) {
  const { duration } = z.object({ duration: z.coerce.number().int().min(30).max(720).default(60) }).parse(input ?? {});
  const window = rentalWindow(duration);
  const list = [];
  for (const addon of (await addons()).filter(item => item.active)) {
    const available = addon.stock === null ? null : addon.type === "jual" ? addon.stock : Math.max(0, addon.stock - await peakUse(addon.id, window, ""));
    list.push({ id: addon.id, name: addon.name, category: addon.category, type: addon.type, pricing: addon.pricing, price: addon.price, description: addon.description, photo_id: addon.photo_id, max_per_booking: addon.max_per_booking, online: !!addon.online, available });
  }
  return { addons: list, window, tax: await taxSnapshot() };
}

export async function createSale(input: unknown, actor: string) {
  const data = saleSchema.parse(input);
  return await transaction(async () => {
    if (data.id && await db.prepare("SELECT 1 FROM counter_sales WHERE id=?").get(data.id)) return await detail(data.id);
    const window = rentalWindow(data.duration), duration = minutes(window.end) - minutes(window.start);
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
    // Barang sewa harus kembali, jadi pelanggannya perlu dikenali.
    const renting = plan.some(entry => entry.type === "sewa");
    check(!renting || data.customer.length >= 2, 400, "Isi nama penyewa agar barang sewa bisa ditagih kembali.");
    const subtotal = plan.reduce((sum, entry) => sum + entry.subtotal, 0);
    check(data.discount <= subtotal, 400, `Potongan lebih besar dari subtotal ${rupiah(subtotal)}.`);
    check(!data.discount || data.discount_note.length >= 3, 400, "Isi alasan potongan harga.");
    const snapshot = await taxSnapshot(), bill = billOf(subtotal, data.discount, snapshot);
    check(bill.total > 0, 400, "Total transaksi harus lebih dari Rp0.");
    if (data.method === "cash" && data.tendered !== null) check(data.tendered >= bill.total, 400, `Uang diterima kurang dari total ${rupiah(bill.total)}.`);

    const id = data.id ?? randomUUID(), now = new Date().toISOString();
    await db.prepare(`INSERT INTO counter_sales (id,number,customer,phone,date,start_time,end_time,subtotal,discount,discount_note,tax,tax_rate,tax_inclusive,tax_label,total,method,tendered,status,notes,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',?,?,?)`)
      .run(id, await nextNumber(window.date.slice(0, 4)), data.customer || walkInName, data.phone, window.date, window.start, window.end, subtotal, data.discount, data.discount ? data.discount_note : "",
        bill.tax, snapshot.tax_rate, snapshot.tax_inclusive, snapshot.tax_label, bill.total, data.method, data.method === "cash" ? data.tendered : null, data.notes, actor, now);
    for (const entry of plan) {
      await db.prepare("INSERT INTO counter_sale_lines (id,sale_id,addon_id,name,type,pricing,unit_price,quantity,subtotal,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), id, entry.addon?.id ?? null, entry.name, entry.type, entry.pricing, entry.unit_price, entry.quantity, entry.subtotal, now);
      if (entry.type === "jual" && entry.addon) await consume(entry.addon.id, entry.quantity, id, actor);
    }
    await syncCounterSale(id);
    await audit(actor, "counter.create", id, { total: bill.total, method: data.method });
    return await detail(id);
  });
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
  const sales = await db.prepare(`SELECT ${columns},(SELECT COUNT(*) FROM counter_sale_lines l WHERE l.sale_id=s.id AND l.type='sewa' AND l.returned_at IS NULL) open_rentals,
      (SELECT GROUP_CONCAT(CONCAT(l.quantity,'× ',l.name) ORDER BY l.seq SEPARATOR ', ') FROM counter_sale_lines l WHERE l.sale_id=s.id) items
    FROM counter_sales s WHERE s.date=? AND (?='' OR lower(s.customer) LIKE CONCAT('%',?,'%') OR lower(s.number) LIKE CONCAT('%',?,'%') OR s.phone LIKE CONCAT('%',?,'%'))
    ORDER BY s.created_at DESC LIMIT 300`).all(date, term, term, term, term) as (CounterSale & { open_rentals: number; items: string })[];
  const paid = sales.filter(sale => sale.status === "paid");
  const byMethod: Record<string, number> = {};
  for (const sale of paid) byMethod[sale.method] = (byMethod[sale.method] ?? 0) + sale.total;
  return { sales, summary: { count: paid.length, total: paid.reduce((sum, sale) => sum + sale.total, 0), by_method: byMethod }, date, today };
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
  return await transaction(async () => {
    const sale = await getSale(id);
    check(sale.status === "paid", 409, "Transaksi ini sudah dibatalkan.");
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
