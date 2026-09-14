"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Info, Layers, MessageCircle, PackagePlus, RefreshCw, X } from "lucide-react";
import { money } from "@/lib/api";
import { VenueMap } from "@/components/venue-map";
import { CourtCover } from "@/components/photo-gallery";
import { ShopAddonPicker } from "@/components/shop-addons";
import { type AddonOption, fetchAddonOptions, lineTotal, maxFor } from "@/lib/addons";
import { minute, timeSlots } from "@/lib/operations";
import { useVenueInfo } from "@/lib/use-venue-info";
import { environmentLabel, policySummary, whatsappLink } from "@/lib/venue-info";
import {
  addDays, fetchAvailability, floorLabel, formatDay, formatShortDay, priceFor, rangeIsFree, rulesFor, venueNow,
  type Availability, type ShopCourt,
} from "@/lib/shop";

const durations = [60, 90, 120];
/** Sama dengan batas jendela jadwal di API publik. */
const horizonDays = 90;
const refreshMs = 60_000;
type Selection = { courtId: string; start: string };
const durationLabel = (value: number) => `${(value / 60).toLocaleString("id-ID")} jam`;

function AvailabilityView() {
  const router = useRouter();
  const params = useSearchParams();
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Selection | null>(null);
  const [duration, setDuration] = useState(60);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const blocks = useRef(new Map<string, HTMLElement>());
  const jumped = useRef(false);
  const { data: venue } = useVenueInfo();
  /** Pilihan tambahan untuk jam yang dipilih; null selama stoknya belum diperiksa. */
  const [addonOptions, setAddonOptions] = useState<AddonOption[] | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [addonsOpen, setAddonsOpen] = useState(false);

  const focusCourt = useCallback((courtId: string) => {
    blocks.current.get(courtId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const now = venueNow();
    setToday(now.date);
    const requested = params.get("date");
    const limit = addDays(now.date, horizonDays);
    setDate(requested && requested >= now.date && requested <= limit ? requested : now.date);
  }, [params]);

  const load = useCallback(async (value: string, quiet = false) => {
    if (quiet) setRefreshing(true);
    try { setData(await fetchAvailability(value)); setError(""); }
    catch (problem) { setError((problem as Error).message); }
    finally { setRefreshing(false); }
  }, []);

  // Jadwal dapat berubah kapan saja, jadi dimuat ulang berkala dan saat tab kembali aktif.
  useEffect(() => {
    if (!date) return;
    setData(null); setPicked(null); setNotice("");
    void load(date);
    const timer = window.setInterval(() => void load(date, true), refreshMs);
    const onFocus = () => void load(date, true);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [date, load]);

  // Setelah pembaruan, lepaskan pilihan yang ternyata sudah diambil orang lain.
  useEffect(() => {
    if (!data || !picked) return;
    const entry = data.courts.find(item => item.court.id === picked.courtId);
    if (entry && durations.some(value => rangeIsFree(entry.slots, picked.start, value))) return;
    setPicked(null);
    setNotice(`Slot ${picked.start}${entry ? ` di ${entry.court.name}` : ""} baru saja tidak tersedia. Silakan pilih jam lain.`);
  }, [data, picked]);

  // Tautan dari beranda (#lapangan-<id>) langsung membawa ke lapangan yang dipilih.
  useEffect(() => {
    if (!data || jumped.current || !window.location.hash.startsWith("#lapangan-")) return;
    jumped.current = true;
    const id = decodeURIComponent(window.location.hash.slice("#lapangan-".length));
    requestAnimationFrame(() => focusCourt(id));
  }, [data, focusCourt]);

  const goto = (value: string) => { setDate(value); router.replace(`/ketersediaan?date=${value}`, { scroll: false }); };

  const lastDay = today ? addDays(today, horizonDays) : "";
  const stripStart = today && date > addDays(today, 6) ? addDays(date, -3) : today;
  const days = today ? Array.from({ length: 7 }, (_, index) => addDays(stripStart, index)).filter(value => value <= lastDay) : [];
  const nextDay = date ? addDays(date, 1) : "";
  const totalFree = data ? data.courts.reduce((sum, entry) => sum + entry.slots.filter(slot => slot.state === "available").length, 0) : 0;
  const anySpecial = !!data?.courts.some(entry => entry.slots.some(slot => slot.rule && slot.state === "available"));

  const pickedCourt = useMemo<ShopCourt | undefined>(
    () => data?.courts.find(entry => entry.court.id === picked?.courtId)?.court,
    [data, picked],
  );
  const pickedSlots = data?.courts.find(entry => entry.court.id === picked?.courtId)?.slots ?? [];
  const available = picked ? durations.filter(value => rangeIsFree(pickedSlots, picked.start, value)) : [];
  const effective = available.includes(duration) ? duration : available[0];
  const end = picked && effective ? timeSlots(minute(picked.start) + effective, minute(picked.start) + effective)[0] : "";
  const total = picked && effective ? priceFor(pickedSlots, picked.start, effective) : 0;
  const appliedRules = picked && effective ? rulesFor(pickedSlots, picked.start, effective) : [];
  const covered = (courtId: string, start: string) =>
    !!picked && !!effective && picked.courtId === courtId && minute(start) >= minute(picked.start) && minute(start) < minute(picked.start) + effective;

  // Stok raket sewa bergantung pada jam main, jadi diperiksa ulang setiap jam, durasi, atau jadwal berubah.
  useEffect(() => {
    if (!picked || !end) { setAddonOptions(null); return; }
    let active = true;
    fetchAddonOptions(date, picked.start, end).then(result => {
      if (!active) return;
      setAddonOptions(result.addons);
      setPicks(current => {
        const next: Record<string, number> = {};
        for (const [id, quantity] of Object.entries(current)) {
          const option = result.addons.find(item => item.id === id);
          const allowed = option ? Math.min(quantity, maxFor(option)) : 0;
          if (allowed > 0) next[id] = allowed;
        }
        return next;
      });
    }).catch(() => { if (active) setAddonOptions([]); });
    return () => { active = false; };
  }, [date, picked, end, data]);
  useEffect(() => { if (!picked) { setPicks({}); setAddonsOpen(false); } }, [picked]);
  const catalog = addonOptions ?? venue?.addons ?? [];
  const chosenAddons = effective
    ? catalog.flatMap(option => {
      const quantity = picks[option.id] ?? 0;
      return quantity > 0 ? [{ option, quantity, subtotal: lineTotal(option.price, quantity, option.pricing, effective) }] : [];
    })
    : [];
  const extras = chosenAddons.reduce((sum, item) => sum + item.subtotal, 0);
  const pickedCount = chosenAddons.reduce((sum, item) => sum + item.quantity, 0);

  const info = venue?.info;
  const policyLine = venue ? policySummary(venue.policies) : null;
  const floors = data?.floors ?? [];
  const pickedFloor = pickedCourt ? floorLabel(floors, pickedCourt.floor_id) : undefined;
  // Venue bertingkat: jadwal dikelompokkan per lantai sesuai urutan lantai di denah.
  const groups = data
    ? floors.length > 1
      ? floors.map(floor => ({ floor, entries: data.courts.filter(entry => (entry.court.floor_id ?? floors[0].id) === floor.id) })).filter(group => group.entries.length)
      : [{ floor: null, entries: data.courts }]
    : [];
  const message = pickedCourt && picked && end ? [
    `Halo${info?.name ? ` ${info.name}` : ""}, saya ingin memesan lapangan padel:`,
    "",
    `Lapangan: ${pickedCourt.name}${pickedFloor ? ` (${pickedFloor})` : ""}`,
    `Tanggal: ${formatDay(date)}`,
    `Jam: ${picked.start}–${end} (${durationLabel(effective)})`,
    ...(chosenAddons.length ? [
      `Sewa lapangan: ${money(total)}`,
      "",
      "Tambahan:",
      ...chosenAddons.map(item => `- ${item.quantity}× ${item.option.name}: ${money(item.subtotal)}`),
      "",
    ] : []),
    `Total: ${money(total + extras)}`,
    "",
    chosenAddons.length ? "Apakah slot dan tambahan ini masih tersedia?" : "Apakah slot ini masih tersedia?",
  ].join("\n") : "";

  return (
    <section className="shop-section shop-availability-page">
      <div className="shop-page-head">
        <div>
          <h1>Cek ketersediaan</h1>
          <p>{date ? formatDay(date) : "Memuat tanggal…"}{data ? ` · ${totalFree} slot kosong` : ""}</p>
        </div>
        <button type="button" className="shop-refresh" onClick={() => date && void load(date, true)} disabled={!date || refreshing} aria-label="Perbarui jadwal">
          <RefreshCw size={16} className={refreshing ? "spin" : ""} aria-hidden="true" />
          <span>{refreshing ? "Memperbarui…" : "Perbarui"}</span>
        </button>
      </div>

      <div className="shop-days" role="group" aria-label="Pilih tanggal">
        {days.map(value => {
          const [weekday, dayMonth] = formatShortDay(value).split(", ");
          return (
            <button key={value} type="button" aria-pressed={value === date} onClick={() => goto(value)}>
              <small>{value === today ? "Hari ini" : value === addDays(today, 1) ? "Besok" : weekday}</small>
              <b>{dayMonth}</b>
            </button>
          );
        })}
        <label className="shop-days-other">
          <CalendarDays size={16} aria-hidden="true" />
          <span>Tanggal lain</span>
          <input type="date" value={date} min={today} max={lastDay} onChange={event => event.target.value && goto(event.target.value)} />
        </label>
      </div>

      {error && (
        <p className="shop-note error" role="alert">
          {error} <button type="button" onClick={() => date && void load(date)}>Coba lagi</button>
        </p>
      )}
      {notice && <p className="shop-note" role="status">{notice}</p>}

      {!data ? (
        !error && (
          <div aria-busy="true" aria-label="Memuat jadwal">
            <div className="shop-court-block skeleton" />
            <div className="shop-court-block skeleton" />
          </div>
        )
      ) : data.courts.length === 0 ? (
        <p className="shop-empty">Belum ada lapangan yang dibuka untuk pemesanan.</p>
      ) : (
        <>
          <div className="shop-map-card">
            <header>
              <h2>Denah venue</h2>
              <p>Ketuk lapangan untuk melompat ke jadwalnya.</p>
            </header>
            <div className="venue-map-scroll">
              <VenueMap venue={data.venue} floors={data.floors} courts={data.courts} features={data.features} selected={picked?.courtId} onSelect={focusCourt} />
            </div>
            <div className="venue-map-legend">
              <span><i className="open" />Banyak slot kosong</span>
              <span><i className="few" />Tinggal sedikit</span>
              <span><i className="full" />Penuh</span>
            </div>
          </div>

          <div className="shop-legend" aria-label="Keterangan warna slot">
            <span><i className="free" />Tersedia</span>
            <span><i className="pick" />Pilihan Anda</span>
            <span><i className="busy" />Sudah dipesan</span>
            <span><i className="care" />Perawatan</span>
            {anySpecial && <span><i className="special" />Tarif khusus</span>}
          </div>

          {groups.map(group => (
            <Fragment key={group.floor?.id ?? "semua"}>
              {group.floor && (
                <h2 className="shop-floor-title">
                  <Layers size={18} aria-hidden="true" /> {group.floor.name}
                  <small>{group.entries.length} lapangan</small>
                </h2>
              )}
          {group.entries.map(({ court, slots }) => {
            // Slot yang sudah lewat hanya memenuhi layar; cukup sebutkan jumlahnya.
            const shown = date === data.today ? slots.filter(slot => slot.state !== "past") : slots;
            const passed = slots.length - shown.length;
            const free = slots.filter(slot => slot.state === "available").length;
            const rates = (shown.length ? shown : slots).map(slot => slot.rate);
            const low = rates.length ? Math.min(...rates) : court.hourly_rate, high = rates.length ? Math.max(...rates) : court.hourly_rate;
            return (
              <article
                className="shop-court-block"
                key={court.id}
                id={`lapangan-${court.id}`}
                ref={node => { if (node) blocks.current.set(court.id, node); else blocks.current.delete(court.id); }}
              >
                <header>
                  {court.photos.length > 0 && <CourtCover name={court.name} photos={court.photos} className="shop-court-thumb" />}
                  <div className="title">
                    <h3>{court.name}</h3>
                    <small>
                      {[court.environment && environmentLabel[court.environment], court.surface].filter(Boolean).join(" · ")}
                      {(court.environment || court.surface) && <br />}
                      Buka {court.opens_at} – {court.closes_at} · {free === 0 ? "penuh" : `${free} slot kosong`}
                    </small>
                  </div>
                  <div className="rate">
                    <b>{low === high ? money(low) : `${money(low)} – ${money(high)}`}</b>
                    <small>per jam</small>
                  </div>
                </header>
                {free === 0 ? (
                  <div className="shop-court-full">
                    <p>{shown.length === 0 ? "Jam operasional di tanggal ini sudah lewat." : "Semua slot di tanggal ini sudah terisi."}</p>
                    {nextDay <= lastDay && (
                      <button type="button" className="shop-ghost small" onClick={() => goto(nextDay)}>
                        Lihat {date === today ? "besok" : formatShortDay(nextDay)}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="shop-slots">
                      {shown.map(slot => {
                        const chosen = covered(court.id, slot.start);
                        const special = slot.state === "available" && !!slot.rule;
                        const label = slot.state === "booked" ? "sudah dipesan" : slot.state === "maintenance" ? "sedang perawatan" : "tersedia";
                        return (
                          <button
                            key={slot.start}
                            type="button"
                            className={`shop-slot ${chosen ? "picked" : slot.state}${special ? " special" : ""}`}
                            disabled={slot.state !== "available"}
                            aria-pressed={chosen}
                            title={special ? `Tarif ${slot.rule}: ${money(slot.rate)} per jam` : undefined}
                            aria-label={`${court.name} pukul ${slot.start}, ${chosen ? "dipilih" : label}${special ? `, tarif ${slot.rule} ${money(slot.rate)} per jam` : ""}`}
                            onClick={() => { setNotice(""); setPicked({ courtId: court.id, start: slot.start }); setDuration(60); }}
                          >
                            {slot.start}
                          </button>
                        );
                      })}
                    </div>
                    {passed > 0 && (
                      <p className="shop-slot-note"><Info size={14} aria-hidden="true" /> {passed} slot sebelum pukul {data.time} disembunyikan karena sudah lewat.</p>
                    )}
                  </>
                )}
              </article>
            );
          })}
            </Fragment>
          ))}
        </>
      )}

      {picked && pickedCourt && (
        <div className="shop-summary" role="region" aria-label="Ringkasan pilihan">
          <button type="button" className="shop-summary-close" onClick={() => setPicked(null)} aria-label="Batalkan pilihan"><X size={16} /></button>
          <div className="what">
            <small>Pilihan Anda</small>
            <b>{pickedCourt.name}</b>
            <span>{pickedFloor ? `${pickedFloor} · ` : ""}{formatShortDay(date)} · {picked.start}{end ? ` – ${end}` : ""}</span>
            {appliedRules.length > 0 && <em>Termasuk tarif {appliedRules.join(" & ")}</em>}
            {pickedCount > 0 && <span className="extras">Lapangan {money(total)} + {pickedCount} tambahan {money(extras)}</span>}
          </div>
          <div className="shop-duration" role="group" aria-label="Durasi main">
            {durations.map(value => (
              <button key={value} type="button" aria-pressed={effective === value} disabled={!available.includes(value)} onClick={() => setDuration(value)}>
                {durationLabel(value)}
              </button>
            ))}
          </div>
          <div className="pay">
            <span className="total">{money(total + extras)}</span>
            {info?.whatsapp && message ? (
              <a className="shop-cta" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener" aria-describedby="catatan-bayar">
                <MessageCircle size={18} aria-hidden="true" /> Pesan via WhatsApp
              </a>
            ) : (
              <button className="shop-cta" type="button" disabled aria-describedby="catatan-bayar">Lanjut ke pembayaran</button>
            )}
            <small id="catatan-bayar">
              {info?.whatsapp ? "Slot belum terkunci sampai dikonfirmasi staf. Pembayaran online segera hadir." : "Pembayaran online segera hadir. Tunjukkan ringkasan ini ke staf venue."}
              {policyLine && <> <Link href="/kebijakan#pembatalan">{policyLine}.</Link></>}
            </small>
          </div>
          {catalog.length > 0 && (
            <div className={`shop-summary-addons${addonsOpen ? " open" : ""}`}>
              <button type="button" className="shop-addons-toggle" aria-expanded={addonsOpen} aria-controls="pilihan-tambahan" onClick={() => setAddonsOpen(open => !open)}>
                <PackagePlus size={17} aria-hidden="true" />
                <span>{pickedCount ? `${pickedCount} tambahan dipilih · ${money(extras)}` : "Tambah sewa raket, bola & lainnya"}</span>
                <ChevronDown size={16} aria-hidden="true" className="chevron" />
              </button>
              {addonsOpen && (
                <ShopAddonPicker id="pilihan-tambahan" options={catalog} picks={picks} loading={addonOptions === null}
                  onChange={(id, quantity) => setPicks(current => ({ ...current, [id]: quantity }))} />
              )}
            </div>
          )}
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
