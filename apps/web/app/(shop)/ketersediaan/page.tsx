"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { money } from "@/lib/api";
import { VenueMap } from "@/components/venue-map";
import { minute, timeSlots } from "@/lib/operations";
import {
  addDays, fetchAvailability, formatDay, priceFor, rangeIsFree, venueNow,
  type Availability, type ShopCourt,
} from "@/lib/shop";

const durations = [60, 90, 120];
type Selection = { courtId: string; start: string };

function AvailabilityView() {
  const router = useRouter();
  const params = useSearchParams();
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Selection | null>(null);
  const [duration, setDuration] = useState(60);
  const blocks = useRef(new Map<string, HTMLElement>());

  const focusCourt = (courtId: string) => blocks.current.get(courtId)?.scrollIntoView({ behavior: "smooth", block: "center" });

  useEffect(() => {
    const now = venueNow();
    setToday(now.date);
    const requested = params.get("date");
    setDate(requested && requested >= now.date ? requested : now.date);
  }, [params]);

  const load = useCallback(async (value: string) => {
    try { setData(await fetchAvailability(value)); setError(""); }
    catch (problem) { setError((problem as Error).message); }
  }, []);

  useEffect(() => { if (date) { setData(null); setPicked(null); void load(date); } }, [date, load]);

  const goto = (value: string) => { setDate(value); router.replace(`/ketersediaan?date=${value}`, { scroll: false }); };

  const pickedCourt = useMemo<ShopCourt | undefined>(
    () => data?.courts.find(entry => entry.court.id === picked?.courtId)?.court,
    [data, picked],
  );
  const pickedSlots = data?.courts.find(entry => entry.court.id === picked?.courtId)?.slots ?? [];
  const available = picked ? durations.filter(value => rangeIsFree(pickedSlots, picked.start, value)) : [];
  const effective = available.includes(duration) ? duration : available[0];
  const end = picked && effective ? timeSlots(minute(picked.start) + effective, minute(picked.start) + effective)[0] : "";
  const total = pickedCourt && picked && end ? priceFor(pickedCourt, picked.start, end) : 0;

  const covered = (courtId: string, start: string) => {
    if (!picked || !effective || picked.courtId !== courtId) return false;
    return minute(start) >= minute(picked.start) && minute(start) < minute(picked.start) + effective;
  };

  return (
    <section className="shop-section">
      <div className="shop-daybar">
        <button className="nav" aria-label="Hari sebelumnya" disabled={!date || date <= today} onClick={() => goto(addDays(date, -1))}><ChevronLeft size={20} /></button>
        <button className="nav" aria-label="Hari berikutnya" disabled={!date} onClick={() => goto(addDays(date, 1))}><ChevronRight size={20} /></button>
        <div className="today">
          {date ? formatDay(date) : "Memuat…"}
          <small>{date === today ? "Hari ini" : ""} {data ? `· waktu venue ${data.timezone}` : ""}</small>
        </div>
        <div className="shop-field">
          <input type="date" aria-label="Pilih tanggal" value={date} min={today} onChange={event => event.target.value && goto(event.target.value)} />
        </div>
      </div>

      {data && data.courts.length > 0 && (
        <>
          <VenueMap venue={data.venue} courts={data.courts} selected={picked?.courtId} onSelect={focusCourt} />
          <div className="venue-map-legend">
            <span><i className="open" />Banyak slot kosong</span>
            <span><i className="few" />Tinggal sedikit</span>
            <span><i className="full" />Penuh</span>
          </div>
        </>
      )}

      <div className="shop-legend">
        <span><i className="free" />Tersedia</span>
        <span><i className="pick" />Pilihan Anda</span>
        <span><i className="busy" />Sudah dipesan</span>
        <span><i className="care" />Perawatan</span>
      </div>

      {error && <p className="shop-note" role="alert">{error}</p>}

      {!data ? (
        <p className="shop-empty">Memuat jadwal…</p>
      ) : (
        data.courts.map(({ court, slots }) => {
          const free = slots.filter(slot => slot.state === "available").length;
          return (
            <article
              className="shop-court-block"
              key={court.id}
              ref={node => { if (node) blocks.current.set(court.id, node); else blocks.current.delete(court.id); }}
            >
              <header>
                <h3>{court.name}</h3>
                <span className="rate">{money(court.hourly_rate)} / jam</span>
              </header>
              {free === 0 ? (
                <p className="shop-empty" style={{ padding: "18px 0" }}>Tidak ada slot tersisa di tanggal ini.</p>
              ) : (
                <div className="shop-slots">
                  {slots.map(slot => {
                    const chosen = covered(court.id, slot.start);
                    const label = slot.state === "booked" ? "sudah dipesan" : slot.state === "maintenance" ? "perawatan" : slot.state === "past" ? "sudah lewat" : "tersedia";
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        className={`shop-slot ${chosen ? "picked" : slot.state}`}
                        disabled={slot.state !== "available"}
                        aria-pressed={chosen}
                        aria-label={`${slot.start} ${court.name}, ${label}`}
                        onClick={() => { setPicked({ courtId: court.id, start: slot.start }); setDuration(60); }}
                      >
                        {slot.start}
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })
      )}

      {picked && pickedCourt && (
        <div className="shop-summary">
          <div className="what">
            <b>{pickedCourt.name}</b>
            <small>{formatDay(date)} · {picked.start}{end ? ` – ${end}` : ""}</small>
          </div>
          <div className="shop-duration" role="group" aria-label="Durasi main">
            {durations.map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={effective === value}
                disabled={!available.includes(value)}
                onClick={() => setDuration(value)}
              >
                {value / 60 === 1 ? "1 jam" : `${value / 60} jam`}
              </button>
            ))}
          </div>
          <span className="total">{money(total)}</span>
          <button className="shop-cta" type="button" disabled title="Pembayaran online tersedia pada tahap berikutnya">
            Lanjut ke pembayaran
          </button>
        </div>
      )}
    </section>
  );
}

export default function AvailabilityPage() {
  return (
    <Suspense fallback={<section className="shop-section"><p className="shop-empty">Memuat jadwal…</p></section>}>
      <AvailabilityView />
    </Suspense>
  );
}
