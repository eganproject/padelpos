import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, db, readSetting, saveSetting, transaction } from "./store.js";
import { check } from "./errors.js";
import { checkImage } from "./photos.js";
import { getInfo, infoSchema } from "./content.js";

/**
 * Identitas merek satu instalasi (white-label): nama, tagline, logo, favicon, warna, kontak, dan
 * teks kaki halaman. Nama, tagline, dan kontak tetap disimpan di dokumen `info` karena sudah dipakai
 * situs, email, WhatsApp, dan nota; yang khusus tampilan disimpan di dokumen `brand`. Logo dan
 * favicon disimpan di tabel `brand_assets` dan disajikan lewat /api/public/photos/:id.
 */
export const brandAssetKinds = ["logo", "logo_dark", "favicon"] as const;
export type BrandAssetKind = typeof brandAssetKinds[number];
export const maxBrandAssetSize = "1mb";

const color = (label: string) => z.string().trim().toLowerCase()
  .refine(value => value === "" || /^#[0-9a-f]{6}$/.test(value), `${label} harus berupa kode warna, mis. #0f3326.`).default("");

export const brandSchema = z.object({
  primary_color: color("Warna utama"),
  accent_color: color("Warna aksen"),
  /** Tampilkan nama di samping logo. Matikan bila logonya sudah berisi tulisan nama. */
  show_name: z.boolean().default(true),
  footer_text: z.string().trim().max(300, "Teks kaki halaman maksimal 300 karakter.").default(""),
  /** Pengganti "© tahun nama" di kaki halaman; kosong berarti otomatis. */
  copyright: z.string().trim().max(120, "Teks hak cipta maksimal 120 karakter.").default(""),
});
export type BrandSettings = z.infer<typeof brandSchema>;

/** Kolom `info` yang diatur dari halaman Brand. */
export const brandInfoKeys = ["name", "tagline", "whatsapp", "phone", "email", "instagram", "tiktok", "facebook", "youtube", "website"] as const;

async function settings(): Promise<BrandSettings & { updated_at: string | null }> {
  const stored = await readSetting<Record<string, unknown>>("brand") ?? {};
  const parsed = brandSchema.safeParse(stored);
  return { ...(parsed.success ? parsed.data : brandSchema.parse({})), updated_at: typeof stored.updated_at === "string" ? stored.updated_at : null };
}

async function assets() {
  const rows = await db.prepare("SELECT kind,id FROM brand_assets").all() as { kind: BrandAssetKind; id: string }[];
  const found = Object.fromEntries(rows.map(row => [row.kind, row.id]));
  return Object.fromEntries(brandAssetKinds.map(kind => [kind, found[kind] ?? null])) as Record<BrandAssetKind, string | null>;
}

/** Semua yang dibutuhkan untuk menggambar merek di situs, panel staf, email, dan nota. Aman untuk publik. */
export async function publicBrand() {
  const [info, brand, files] = await Promise.all([getInfo(), settings(), assets()]);
  const { updated_at, ...rest } = brand;
  return { name: info.name, tagline: info.tagline, ...rest, ...files, updated_at };
}
export type PublicBrand = Awaited<ReturnType<typeof publicBrand>>;

/** Halaman admin: merek beserta kontak yang sedang tersimpan. */
export async function brandForAdmin() {
  const info = await getInfo();
  return { brand: await publicBrand(), contact: Object.fromEntries(brandInfoKeys.map(key => [key, info[key]])) };
}

/** Simpan nama, kontak, dan tampilan sekaligus. Kolom info lain (alamat, fasilitas, dll.) tidak tersentuh. */
export async function saveBrand(input: unknown, actor: string) {
  const body = z.object({}).passthrough().parse(input);
  const brand = brandSchema.parse(body);
  const name = z.string().trim().min(2, "Nama brand minimal 2 karakter.").max(60, "Nama brand maksimal 60 karakter.").parse(body.name ?? "");
  await transaction(async () => {
    const current = await getInfo();
    const { updated_at: _, ...rest } = current;
    const changes = Object.fromEntries(brandInfoKeys.filter(key => key in body).map(key => [key, body[key]]));
    const info = infoSchema.parse({ ...rest, ...changes, name });
    const stamp = new Date().toISOString();
    await saveSetting("info", { ...info, updated_at: stamp });
    await saveSetting("brand", { ...brand, updated_at: stamp });
    await audit(actor, "brand.update", "brand", { name: info.name, primary_color: brand.primary_color, accent_color: brand.accent_color });
  });
  return await brandForAdmin();
}

export const isBrandAsset = (kind: string): kind is BrandAssetKind => (brandAssetKinds as readonly string[]).includes(kind);

export async function setBrandAsset(kind: string, contentType: string | undefined, body: unknown, actor: string) {
  check(isBrandAsset(kind), 404, "Jenis berkas merek tidak dikenal.");
  const type = checkImage(contentType, body);
  await transaction(async () => {
    await db.prepare("DELETE FROM brand_assets WHERE kind=?").run(kind);
    await db.prepare("INSERT INTO brand_assets (kind,id,mime,data,bytes,created_at) VALUES (?,?,?,?,?,?)")
      .run(kind, randomUUID(), type, body as Buffer, (body as Buffer).length, new Date().toISOString());
    await audit(actor, "brand.asset.set", kind);
  });
  return await brandForAdmin();
}

export async function removeBrandAsset(kind: string, actor: string) {
  check(isBrandAsset(kind), 404, "Jenis berkas merek tidak dikenal.");
  await transaction(async () => {
    await db.prepare("DELETE FROM brand_assets WHERE kind=?").run(kind);
    await audit(actor, "brand.asset.delete", kind);
  });
  return await brandForAdmin();
}
