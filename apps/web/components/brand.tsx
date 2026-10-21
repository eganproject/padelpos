"use client";

import { Orbit } from "lucide-react";
import { useBrand } from "./brand-provider";
import { assetUrl, brandName } from "@/lib/brand";

/**
 * Logo dan nama di panel staf. Logo gelap (bila ada) dipakai saat tema gelap; tanpa logo,
 * ikon bawaan ditampilkan. `compact` hanya menampilkan tanda/logo, untuk sidebar yang diciutkan.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  const brand = useBrand();
  const name = brandName(brand);
  const logo = brand.logo ?? brand.logo_dark;
  return (
    <div className={`brand${logo ? " has-logo" : ""}`}>
      {logo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- logo kecil dari API sendiri */}
          <img className={`brand-logo${brand.logo && brand.logo_dark ? " light" : ""}`} src={assetUrl(logo)} alt={brand.show_name && !compact ? "" : name} />
          {brand.logo && brand.logo_dark && (
            // eslint-disable-next-line @next/next/no-img-element -- logo kecil dari API sendiri
            <img className="brand-logo dark" src={assetUrl(brand.logo_dark)} alt={brand.show_name && !compact ? "" : name} />
          )}
        </>
      ) : <span className="brand-mark"><Orbit strokeWidth={2.2} aria-hidden="true" /></span>}
      {!compact && (brand.show_name || !logo) && <span className="brand-name">{name}</span>}
    </div>
  );
}
