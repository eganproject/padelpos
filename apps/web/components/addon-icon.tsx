import type { ComponentType } from "react";
import { Bath, CircleDot, CupSoda, Footprints, GraduationCap, Package, Sparkles, Video, Volleyball, type LucideProps } from "lucide-react";
import type { AddonCategory } from "@/lib/addons";
import { photoUrl } from "@/lib/venue-info";

const icons: Record<AddonCategory, ComponentType<LucideProps>> = {
  raket: Volleyball, bola: CircleDot, sepatu: Footprints, handuk: Bath, minuman: CupSoda,
  pelatih: GraduationCap, dokumentasi: Video, perlengkapan: Package, lainnya: Sparkles,
};

export function AddonIcon({ category, size = 18 }: { category: AddonCategory; size?: number }) {
  const Icon = icons[category] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}

/** Foto item bila ada; tanpa foto tampil ikon kategorinya. */
export function AddonThumb({ category, photoId, className = "" }: { category: AddonCategory; photoId: string | null; className?: string }) {
  return (
    <span className={`addon-thumb ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photoId ? <img src={photoUrl(photoId)} alt="" loading="lazy" /> : <AddonIcon category={category} size={20} />}
    </span>
  );
}
