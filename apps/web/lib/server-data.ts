import { cache } from "react";
import type { Availability } from "./shop";
import type { PublicInfo } from "./venue-info";
import type { PublicBrand } from "./brand";

/**
 * Pengambilan data untuk halaman yang digambar di server: beranda, FAQ, kebijakan,
 * dan rangka halaman. Browser memanggil API lewat penulisan ulang `/api` di
 * next.config.ts, tetapi server tidak melewati penulisan ulang itu sehingga
 * alamat API dipanggil langsung.
 *
 * Setiap kegagalan menghasilkan null, bukan lemparan: bila API sedang mati,
 * halaman tetap tampil dengan pesan yang jelas alih-alih layar galat.
 */
const base = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";

async function get<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${base}/api/public${path}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Profil venue, kebijakan, FAQ, katalog tambahan, dan status pembayaran online.
 * `cache` membuat rangka halaman dan isinya berbagi satu permintaan yang sama.
 */
export const venueInfo = cache(() => get<PublicInfo>("/info"));

/** Jadwal satu tanggal, lengkap dengan denah dan tarif tiap slot. */
export const availability = cache((date: string) => get<Availability>(`/availability?date=${encodeURIComponent(date)}`));

/** Nama, logo, favicon, dan warna merek untuk rangka semua halaman. Ringan: dua baris pengaturan. */
export const brandInfo = cache(() => get<PublicBrand>("/brand"));
