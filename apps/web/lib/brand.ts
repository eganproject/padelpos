/**
 * Merek satu instalasi (white-label), diatur di Pengaturan > Brand. Sama dengan apps/api/src/brand.ts.
 *
 * Nama produk bawaan dipakai hanya bila venue belum mengisi nama brand; ganti di sini bila aplikasi
 * dijual dengan nama lain.
 */
export const defaultBrandName = "Padelix";
export const defaultTagline = "Booking lapangan padel dengan jadwal yang selalu terbaru.";

export type BrandAssetKind = "logo" | "logo_dark" | "favicon";
export type PublicBrand = {
  name: string; tagline: string;
  primary_color: string; accent_color: string; show_name: boolean; footer_text: string; copyright: string;
  logo: string | null; logo_dark: string | null; favicon: string | null; updated_at: string | null;
};
export const emptyBrand: PublicBrand = {
  name: "", tagline: "", primary_color: "", accent_color: "", show_name: true, footer_text: "", copyright: "",
  logo: null, logo_dark: null, favicon: null, updated_at: null,
};

type Named = { name?: string | null; copyright?: string | null } | null | undefined;
export const brandName = (brand: Named) => brand?.name?.trim() || defaultBrandName;
export const assetUrl = (id: string) => `/api/public/photos/${encodeURIComponent(id)}`;
export const copyrightLine = (brand: Named, year = new Date().getFullYear()) =>
  brand?.copyright?.trim() || `© ${year} ${brandName(brand)}`;

/* ---- Warna ---- */

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => "#" + rgb.map(value => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("");
/** Campur `hex` dengan `other` sebanyak `amount` (0–1). */
const mix = (hex: string, other: string, amount: number) => {
  const a = toRgb(hex), b = toRgb(other);
  return toHex(a.map((value, index) => value + (b[index] - value) * amount) as Rgb);
};
const channel = (value: number) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex: string) => { const [r, g, b] = toRgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** Gelapkan sampai kontras dengan latar terang mencapai `target` (untuk teks berwarna aksen). */
function readableOnLight(hex: string, target = 4.5) {
  let color = hex;
  for (let step = 0; step < 20 && contrast(color, "#ffffff") < target; step++) color = mix(color, "#000000", 0.12);
  return color;
}

/**
 * Variabel CSS --brand-* yang dibaca shop.css. Warna turunan (tombol hover, latar tipis, teks di atas
 * warna utama) dihitung dari dua warna pilihan admin. Kosong bila admin memakai warna bawaan.
 */
export function brandCss(brand: Pick<PublicBrand, "primary_color" | "accent_color"> | null | undefined) {
  const vars: string[] = [];
  const primary = brand?.primary_color, accent = brand?.accent_color;
  if (primary && isHex(primary)) {
    const dark = luminance(primary) < 0.4;
    vars.push(
      `--brand-primary:${primary}`,
      `--brand-primary-2:${mix(primary, "#ffffff", 0.12)}`,
      `--brand-primary-wash:${mix(primary, "#ffffff", 0.9)}`,
      `--brand-primary-glow:${mix(primary, "#ffffff", 0.22)}`,
      `--brand-primary-deep:${mix(primary, "#000000", 0.35)}`,
      `--brand-on-primary:${dark ? mix(primary, "#ffffff", 0.9) : "#111111"}`,
      `--brand-on-primary-soft:${dark ? mix(primary, "#ffffff", 0.78) : "#2b2b2b"}`,
      `--brand-on-primary-faint:${dark ? mix(primary, "#ffffff", 0.62) : "#444444"}`,
      `--brand-focus:${readableOnLight(mix(primary, "#ffffff", 0.25), 3)}`,
    );
  }
  if (accent && isHex(accent)) {
    vars.push(
      `--brand-accent:${accent}`,
      `--brand-accent-ink:${contrast(accent, "#111111") >= contrast(accent, "#ffffff") ? mix(accent, "#000000", 0.85) : "#ffffff"}`,
      `--brand-accent-deep:${readableOnLight(accent)}`,
      `--brand-accent-wash:${mix(accent, "#ffffff", 0.85)}`,
      `--brand-accent-edge:${mix(accent, "#ffffff", 0.35)}`,
    );
  }
  return vars.length ? `:root{${vars.join(";")}}` : "";
}
