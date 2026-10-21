import type { MetadataRoute } from "next";
import { brandInfo } from "@/lib/server-data";
import { assetUrl, brandName } from "@/lib/brand";

/** Manifest aplikasi (Tambahkan ke layar utama): nama, warna, dan ikon dari Pengaturan > Brand. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await brandInfo();
  const name = brandName(brand);
  return {
    name, short_name: name.length > 12 ? name.split(/\s+/)[0].slice(0, 12) : name,
    description: brand?.tagline || "Booking lapangan padel secara online.",
    start_url: "/", display: "standalone", lang: "id",
    background_color: "#f5f6f2", theme_color: brand?.primary_color || "#0f3326",
    icons: brand?.favicon
      ? [{ src: assetUrl(brand.favicon), sizes: "512x512", type: "image/png", purpose: "any" }]
      : [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
