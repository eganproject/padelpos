"use client";

import { featureName, type VenueFeature } from "@/lib/venue";
import type { CourtAvailability, Venue } from "@/lib/shop";

/**
 * Denah venue yang disusun admin, diwarnai menurut ketersediaan tanggal yang dipilih.
 * Posisi memakai persen agar ikut menyesuaikan lebar layar tanpa perhitungan piksel.
 * Elemen informasi digambar di belakang lapangan dan tidak dapat diklik.
 */
export function VenueMap({ venue, courts, features = [], selected, onSelect, compact = false }: {
  venue: Venue;
  courts: CourtAvailability[];
  features?: VenueFeature[];
  selected?: string | null;
  onSelect?: (courtId: string) => void;
  compact?: boolean;
}) {
  if (!courts.length) return null;
  const place = (item: { x: number; y: number; w: number; h: number }) => ({
    left: `${(item.x / venue.width) * 100}%`,
    top: `${(item.y / venue.height) * 100}%`,
    width: `${(item.w / venue.width) * 100}%`,
    height: `${(item.h / venue.height) * 100}%`,
  });
  return (
    <div className={`venue-map${compact ? " compact" : ""}`} style={{ aspectRatio: `${venue.width} / ${venue.height}` }}>
      {features.map(feature => (
        <div key={feature.id} className={`venue-map-feature kind-${feature.kind}`} style={place(feature)} title={featureName(feature)}>
          <span>{featureName(feature)}</span>
        </div>
      ))}
      {courts.map(({ court, slots }) => {
        const free = slots.filter(slot => slot.state === "available").length;
        const tone = free === 0 ? "full" : free <= 3 ? "few" : "open";
        const status = free === 0 ? "penuh" : `${free} slot kosong`;
        return (
          <button
            key={court.id}
            type="button"
            className={`venue-map-court ${tone}${selected === court.id ? " selected" : ""}`}
            style={place(court.layout)}
            onClick={() => onSelect?.(court.id)}
            title={`${court.name} · ${status}`}
            aria-label={`${court.name}, ${status}. Lihat jadwalnya.`}
          >
            <span className="net" aria-hidden="true" />
            <b>{court.name}</b>
            <small>{free === 0 ? "Penuh" : `${free} slot`}</small>
          </button>
        );
      })}
    </div>
  );
}
