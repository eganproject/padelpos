import { z } from "zod";
import { audit, db, readSetting, saveSetting, transaction } from "./store.js";
import { getBooking, payments } from "./operations.js";
import { bookingAddons } from "./addons.js";
import { bookingCode } from "./payments.js";
import { getInfo } from "./content.js";
import { detail } from "./counter.js";
import { publicBrand } from "./brand.js";

/**
 * Nota yang dicetak kasir dari panel admin, untuk booking di kasir maupun booking online.
 * Ukuran kertasnya bebas: printer thermal 58 mm atau 80 mm, kertas A5/A4, atau lebar lain
 * dalam milimeter. Pencetakannya lewat dialog cetak browser; server hanya menyimpan
 * ukuran bawaan dan teks tambahan, serta mengumpulkan data satu nota sekaligus.
 */
export const paperSizes = ["58mm", "80mm", "a5", "a4", "custom"] as const;

export const receiptSettingsSchema = z.object({
  paper: z.enum(paperSizes).default("80mm"),
  // Lebar kertas untuk ukuran "custom", dalam milimeter.
  custom_width: z.number().int().min(40, "Lebar kertas minimal 40 mm.").max(216, "Lebar kertas maksimal 216 mm.").default(76),
  header_note: z.string().trim().max(160, "Teks kepala nota maksimal 160 karakter.").default(""),
  footer_note: z.string().trim().max(300, "Teks kaki nota maksimal 300 karakter.").default("Terima kasih sudah bermain di tempat kami."),
  show_payments: z.boolean().default(true),
  show_cashier: z.boolean().default(true),
  // Logo dari Pengaturan > Brand di kepala nota. Printer thermal mencetaknya hitam-putih.
  show_logo: z.boolean().default(true),
});
export type ReceiptSettings = z.infer<typeof receiptSettingsSchema> & { updated_at: string | null };

export async function receiptSettings(): Promise<ReceiptSettings> {
  const stored = await readSetting<Record<string, unknown>>("receipt") ?? {};
  // Dokumen lama atau rusak tetap terbaca; kolom yang tidak sah memakai nilai bawaan.
  const parsed = receiptSettingsSchema.safeParse(stored);
  return { ...(parsed.success ? parsed.data : receiptSettingsSchema.parse({})), updated_at: typeof stored.updated_at === "string" ? stored.updated_at : null };
}

export async function saveReceiptSettings(input: unknown, actor: string) {
  const data = receiptSettingsSchema.parse(input);
  await transaction(async () => {
    await saveSetting("receipt", { ...data, updated_at: new Date().toISOString() });
    await audit(actor, "receipt.settings", "receipt", { paper: data.paper, custom_width: data.custom_width });
  });
  return await receiptSettings();
}

/** Profil venue, pengaturan nota, dan nama kasir yang mencetak: sama untuk semua jenis nota. */
async function receiptFrame(actor: string) {
  const cashier = await db.prepare("SELECT JSON_UNQUOTE(JSON_EXTRACT(document,'$.name')) name FROM users WHERE id=?").get(actor) as { name: string | null } | undefined;
  const [info, brand] = await Promise.all([getInfo(), publicBrand()]);
  return {
    venue: { name: info.name, address: info.address, phone: info.phone, whatsapp: info.whatsapp, email: info.email, instagram: info.instagram, logo: brand.logo, show_name: brand.show_name },
    settings: await receiptSettings(),
    cashier: cashier?.name ?? "",
    printed_at: new Date().toISOString(),
  };
}

/** Semua yang dibutuhkan satu nota: booking, rincian tambahan, pembayaran, profil venue, dan pengaturan nota. */
export async function bookingReceipt(id: string, actor: string) {
  const booking = await getBooking(id);
  const order = booking.order_id ? await db.prepare("SELECT code FROM orders WHERE id=?").get(booking.order_id) as { code: string } | undefined : undefined;
  return {
    booking: { ...booking, code: bookingCode(booking.id), order_code: order?.code ?? null },
    addons: await bookingAddons(booking.id),
    payments: await payments(booking.id),
    ...await receiptFrame(actor),
  };
}

/** Nota transaksi langsung di kasir (sewa atau beli barang tanpa booking lapangan). */
export async function saleReceipt(id: string, actor: string) {
  return { ...await detail(id), ...await receiptFrame(actor) };
}
