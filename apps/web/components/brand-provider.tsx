"use client";

import { createContext, useContext } from "react";
import { emptyBrand, type PublicBrand } from "@/lib/brand";

/**
 * Merek diambil sekali di server (rangka halaman utama) lalu dibagikan ke komponen browser, sehingga
 * logo dan nama sudah benar pada gambar pertama tanpa permintaan tambahan.
 */
const BrandContext = createContext<PublicBrand>(emptyBrand);

export function BrandProvider({ brand, children }: { brand: PublicBrand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export const useBrand = () => useContext(BrandContext);
