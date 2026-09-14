"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { featureName, type Floor, type VenueFeature } from "@/lib/venue";
import type { CourtAvailability, Venue } from "@/lib/shop";

/**
 * Denah venue yang disusun admin, diwarnai menurut ketersediaan tanggal yang dipilih.
 * Posisi memakai persen agar ikut menyesuaikan lebar layar tanpa perhitungan piksel.
 * Elemen informasi digambar di belakang lapangan dan tidak dapat diklik.
 * Venue bertingkat menampilkan tab per lantai lengkap dengan jumlah slot kosongnya.
 */
export function VenueMap({ venue, floors = [], courts, features = [], selected, onSelect, compact = false }: {
  venue: Venue;
  floors?: Floor[];
  courts: CourtAvailability[];
  features?: VenueFeature[];
  selected?: string | null;
  onSelect?: (courtId: string) => void;
  compact?: boolean;
}) {
  const levels: Floor[] = floors.length ? floors : [{ id: "", name: "", width: venue.width, height: venue.height }];
  const first = levels[0].id;
  const floorOf = (floorId: string | null | undefined) => (floors.length ? floorId ?? first : first);
  const selectedFloor = courts.find(entry => entry.court.id === selected)?.court.floor_id;
  const [active, setActive] = useState(selectedFloor ?? first);
  // Lapangan yang dipilih dari luar denah (mis. dari daftar jadwal) membawa denah ke lantainya.
  useEffect(() => { if (selectedFloor) setActive(selectedFloor); }, [selectedFloor]);

  if (!courts.length) return null;
  const floor = levels.find(item => item.id === active) ?? levels[0];
  const freeOn = (floorId: string) => courts
    .filter(entry => floorOf(entry.court.floor_id) === floorId)
    .reduce((sum, entry) => sum + entry.slots.filter(slot => slot.state === "available").length, 0);
  const place = (item: { x: number; y: number; w: number; h: number }) => ({
    left: `${(item.x / floor.width) * 100}%`,
    top: `${(item.y / floor.height) * 100}%`,
    width: `${(item.w / floor.width) * 100}%`,
    height: `${(item.h / floor.height) * 100}%`,
  });

  return (
    <div className={`venue-map-block${compact ? " compact" : ""}`}>
      {levels.length > 1 && (
        <div className="venue-map-floors" role="tablist" aria-label="Pilih lantai">
          {levels.map(item => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === floor.id} onClick={() => setActive(item.id)}>
              <Layers size={14} aria-hidden="true" />
              <span>{item.name}</span>
              <small>{freeOn(item.id)} slot</small>
            </button>
          ))}
        </div>
      )}
      <div className={`venue-map${compact ? " compact" : ""}`} style={{ aspectRatio: `${floor.width} / ${floor.height}` }} aria-label={floor.name ? `Denah ${floor.name}` : undefined}>
        {features.filter(item => floorOf(item.floor_id) === floor.id).map(item => (
          <div key={item.id} className={`venue-map-feature kind-${item.kind}`} style={place(item)} title={featureName(item)}>
            <span>{featureName(item)}</span>
          </div>
        ))}
        {courts.filter(entry => floorOf(entry.court.floor_id) === floor.id).map(({ court, slots }) => {
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
              aria-label={`${court.name}${floor.name && levels.length > 1 ? `, ${floor.name}` : ""}, ${status}. Lihat jadwalnya.`}
            >
              <span className="net" aria-hidden="true" />
              <b>{court.name}</b>
              <small>{free === 0 ? "Penuh" : `${free} slot`}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
