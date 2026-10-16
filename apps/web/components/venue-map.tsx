"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Layers } from "lucide-react";
import { featureName, type Floor, type VenueFeature } from "@/lib/venue";
import type { CourtAvailability, Venue } from "@/lib/shop";

/**
 * Denah venue yang disusun admin, diwarnai menurut ketersediaan tanggal yang dipilih.
 * Posisi memakai persen agar ikut menyesuaikan lebar layar tanpa perhitungan piksel.
 * Elemen informasi digambar di belakang lapangan dan tidak dapat diklik.
 * Venue bertingkat menampilkan tab per lantai lengkap dengan jumlah slot kosongnya.
 */
export function VenueMap({ venue, floors = [], courts, features = [], selected, onSelect }: {
  venue: Venue;
  floors?: Floor[];
  courts: CourtAvailability[];
  features?: VenueFeature[];
  selected?: string | null;
  onSelect?: (courtId: string) => void;

}) {
  const levels: Floor[] = floors.length ? floors : [{ id: "", name: "", width: venue.width, height: venue.height }];
  const first = levels[0].id;
  const floorOf = (floorId: string | null | undefined) => (floors.length ? floorId ?? first : first);
  const selectedFloor = courts.find(entry => entry.court.id === selected)?.court.floor_id;
  const [active, setActive] = useState(selectedFloor ?? first);
  const planId = useId();
  // Lapangan yang dipilih dari luar denah (mis. dari daftar jadwal) membawa denah ke lantainya.
  useEffect(() => { if (selectedFloor) setActive(selectedFloor); }, [selectedFloor]);

  if (!courts.length) return null;
  const floor = levels.find(item => item.id === active) ?? levels[0];
  const courtsOn = (floorId: string) => courts.filter(entry => floorOf(entry.court.floor_id) === floorId);
  const freeOn = (floorId: string) => courtsOn(floorId)
    .reduce((sum, entry) => sum + entry.slots.filter(slot => slot.state === "available").length, 0);
  const place = (item: { x: number; y: number; w: number; h: number }) => ({
    left: `${(item.x / floor.width) * 100}%`,
    top: `${(item.y / floor.height) * 100}%`,
    width: `${(item.w / floor.width) * 100}%`,
    height: `${(item.h / floor.height) * 100}%`,
  });

  return (
    <div className="venue-map-block">
      {levels.length > 1 && (
        <section className="venue-floor-switcher" aria-label="Pilihan lantai venue">
          <div className="venue-floor-switcher-head">
            <span className="venue-floor-switcher-icon"><Layers size={18} aria-hidden="true" /></span>
            <span>
              <strong>Pilih lantai</strong>
              <small>Denah dan lapangan berbeda di setiap lantai.</small>
            </span>
            <b>{levels.length} lantai</b>
          </div>
          <div className="venue-map-floors" role="tablist" aria-label="Pilih lantai yang ingin dilihat">
            {levels.map((item, index) => {
              const activeFloor = item.id === floor.id;
              const courtCount = courtsOn(item.id).length;
              const free = freeOn(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={activeFloor}
                  aria-controls={planId}
                  tabIndex={activeFloor ? 0 : -1}
                  onClick={() => setActive(item.id)}
                  onKeyDown={event => {
                    const last = levels.length - 1;
                    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % levels.length
                      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + last) % levels.length
                        : event.key === "Home" ? 0 : event.key === "End" ? last : index;
                    if (next === index) return;
                    event.preventDefault();
                    setActive(levels[next].id);
                    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]");
                    requestAnimationFrame(() => tabs?.[next]?.focus());
                  }}
                >
                  <span className="venue-floor-number" aria-hidden="true">{index + 1}</span>
                  <span className="venue-floor-copy">
                    <strong>{item.name}</strong>
                    <small>{courtCount} lapangan <i aria-hidden="true">&middot;</i> {free} slot kosong</small>
                  </span>
                  <span className="venue-floor-action">{activeFloor ? "Sedang dilihat" : "Lihat"}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div id={planId} className="venue-map" role={levels.length > 1 ? "tabpanel" : undefined} style={{ aspectRatio: `${floor.width} / ${floor.height}` }} aria-label={floor.name ? `Denah ${floor.name}` : undefined}>
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

/**
 * Denah di beranda. Halaman beranda digambar di server sehingga tidak dapat
 * mengoper fungsi `onSelect`; pembungkus kecil ini yang membawa pengunjung ke
 * jadwal lapangan yang diketuk.
 */
export function VenueMapNav({ date, ...props }: Omit<Parameters<typeof VenueMap>[0], "onSelect" | "selected"> & { date: string }) {
  const router = useRouter();
  return <VenueMap {...props} onSelect={courtId => router.push(`/ketersediaan?date=${date}#lapangan-${encodeURIComponent(courtId)}`)} />;
}
