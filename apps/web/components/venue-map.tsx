"use client";

import { featureName, type VenueFeature } from "@/lib/venue";
import type { CourtAvailability, Venue } from "@/lib/shop";

/**
 * Denah venue yang disusun admin, diwarnai menurut ketersediaan hari yang dipilih.
 * Posisi dipakai dalam persen agar ikut menyesuaikan lebar layar tanpa perhitungan piksel.
 * Elemen informasi digambar di belakang dan tidak dapat diklik.
 */
export function VenueMap({ venue, courts, features = [], selected, onSelect }: {
  venue: Venue;
  courts: CourtAvailability[];
  features?: VenueFeature[];
  selected?: string | null;
  onSelect?: (courtId: string) => void;
}) {
  if (!courts.length) return null;
  return (
    <div className="venue-map" style={{ aspectRatio: `${venue.width} / ${venue.height}` }}>
      {features.map(feature => (
        <div
          key={feature.id}
          className={`venue-map-feature kind-${feature.kind}`}
          style={{
            left: `${(feature.x / venue.width) * 100}%`,
            top: `${(feature.y / venue.height) * 100}%`,
            width: `${(feature.w / venue.width) * 100}%`,
            height: `${(feature.h / venue.height) * 100}%`,
          }}
        >
          <span>{featureName(feature)}</span>
        </div>
      ))}
      {courts.map(({ court, slots }) => {
        const free = slots.filter(slot => slot.state === "available").length;
        const tone = free === 0 ? "full" : free <= 3 ? "few" : "open";
        return (
          <button
            key={court.id}
            type="button"
            className={`venue-map-court ${tone}${selected === court.id ? " selected" : ""}`}
            style={{
              left: `${(court.layout.x / venue.width) * 100}%`,
              top: `${(court.layout.y / venue.height) * 100}%`,
              width: `${(court.layout.w / venue.width) * 100}%`,
              height: `${(court.layout.h / venue.height) * 100}%`,
            }}
            onClick={() => onSelect?.(court.id)}
            aria-label={`${court.name}, ${free === 0 ? "penuh" : `${free} slot tersedia`}. Pilih untuk melihat jamnya.`}
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
