"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Clock3, Layers, Map as MapIcon, PackagePlus, RefreshCw, ShoppingBag, X } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/api";
import { VenueMap } from "@/components/venue-map";
import { CourtCover } from "@/components/photo-gallery";
import { ShopAddonPicker } from "@/components/shop-addons";
import { ShopSteps } from "@/components/shop-steps";
import { type AddonOption, fetchAddonOptions, lineTotal, maxFor } from "@/lib/addons";
import { addToCart, cartTotal, maxCartItems, useCart } from "@/lib/cart";
import { minute, timeSlots } from "@/lib/operations";
import { useVenueInfo } from "@/lib/use-venue-info";
import { environmentLabel, policySummary } from "@/lib/venue-info";
import {
  addDays, fetchAvailability, floorLabel, formatDay, formatShortDay, priceFor, rangeIsFree, rulesFor, venueNow,
  type Availability, type ShopCourt, type ShopSlot,
} from "@/lib/shop";
import { DateInput } from "@/components/form-controls";

/** Pilihan cepat di tombol; durasi yang lebih lama ada di daftar "Lebih lama". */
const quickMax = 120;
/** Batas tampilan bila admin tidak membatasi dan data lapangan belum termuat. */
const fallbackMax = 180;
/** Sama dengan batas jendela jadwal di API publik. */
const horizonDays = 90;
const stripDays = 14;
const refreshMs = 60_000;
const durationKey = "padelix_duration";
type Selection = { courtId: string; start: string };
const durationLabel = (value: number) => `${(value / 60).toLocaleString("id-ID")} jam`;
/** Harga ringkas di tombol slot: Rp350.000 menjadi "350rb", Rp1.400.000 menjadi "1,4jt". */
const shortMoney = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })}jt`
    : value >= 1000 ? `${(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}rb` : money(value);

const periods = [
  { key: "all", label: "Semua jam", from: 0, to: 24 * 60 },
  { key: "pagi", label: "Pagi", from: 0, to: 11 * 60 },
  { key: "siang", label: "Siang", from: 11 * 60, to: 15 * 60 },
  { key: "sore", label: "Sore", from: 15 * 60, to: 18 * 60 },
  { key: "malam", label: "Malam", from: 18 * 60, to: 24 * 60 },
] as const;
type Period = typeof periods[number]["key"];

/** Durasi 1, 1,5, dan 2 jam sebagai tombol, sisanya (2,5 jam ke atas) di satu daftar pilihan. */
function DurationPicker({ label, value, options, allowed, onChange, full }: {
  label: string; value: number; options: number[]; allowed?: (value: number) => boolean; onChange: (value: number) => void; full?: boolean;
}) {
  const quick = options.filter(option => option <= quickMax);
  const more = options.filter(option => option > quickMax);
  const ok = (option: number) => !allowed || allowed(option);
  const long = value > quickMax;
  return (
    <div className={`seg${full ? " full" : ""}`} role="group" aria-label={label}>
      {!full && <span className="seg-label"><Clock3 size={16} aria-hidden="true" /><span className="seg-label-text">Durasi</span></span>}
      {quick.map(option => (
        <button key={option} type="button" aria-pressed={value === option} disabled={!ok(option)} onClick={() => onChange(option)}>{durationLabel(option)}</button>
      ))}
      {more.length > 0 && (
        <label className={`seg-more${long ? " on" : ""}`}>
          <span>{long ? durationLabel(value) : "Lebih lama"}</span>
          <ChevronDown size={15} aria-hidden="true" />
          <select aria-label="Pilih durasi lebih lama" value={long ? value : ""} disabled={!more.some(ok)} onChange={event => event.target.value && onChange(Number(event.target.value))}>
            <option value="" disabled>Lebih lama</option>
            {more.map(option => <option key={option} value={option} disabled={!ok(option)}>{durationLabel(option)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function AvailabilityView() {
  const router = useRouter();
  const params = useSearchParams();
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Selection | null>(null);
  /** Durasi dipilih di depan: tombol jam hanya aktif bila durasi itu muat di sana. */
  const [duration, setDuration] = useState(60);
  const [period, setPeriod] = useState<Period>("all");
  const [mapOpen, setMapOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const blocks = useRef(new Map<string, HTMLElement>());
  const jumped = useRef(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const { data: venue } = useVenueInfo();
  /** Pilihan tambahan untuk jam yang dipilih; null selama stoknya belum diperiksa. */
  const [addonOptions, setAddonOptions] = useState<AddonOption[] | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [addonsOpen, setAddonsOpen] = useState(false);
  const cart = useCart();

  // Pemain yang selalu main 2 jam tidak perlu memilih ulang setiap kali datang.
  useEffect(() => {
    try { const saved = Number(window.localStorage.getItem(durationKey)); if (saved >= 60 && saved % 30 === 0) setDuration(saved); } catch { /* mode privat */ }
  }, []);
  const chooseDuration = (value: number) => {
    setDuration(value);
    try { window.localStorage.setItem(durationKey, String(value)); } catch { /* mode privat */ }
  };

  // Lama main paling panjang: batas dari admin, atau rentang jam buka lapangan terpanjang.
  const cap = venue?.info.max_booking_hours ?? 0;
  const longestOpen = data?.courts.length ? Math.max(...data.courts.map(entry => minute(entry.court.closes_at) - minute(entry.court.opens_at))) : 0;
  const maxMinutes = cap > 0 ? cap * 60 : longestOpen || fallbackMax;
  const durations = useMemo(() => Array.from({ length: Math.max(1, Math.floor((maxMinutes - 60) / 30) + 1) }, (_, index) => 60 + index * 30), [maxMinutes]);
  useEffect(() => { if (venue && data && duration > maxMinutes) setDuration(Math.max(60, maxMinutes - maxMinutes % 30)); }, [venue, data, duration, maxMinutes]);

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

  // Tanggal yang dipilih selalu terlihat di deretan tanggal.
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [date, today]);

  // Setelah pembaruan, lepaskan pilihan yang ternyata sudah diambil orang lain.
  useEffect(() => {
    if (!data || !picked) return;
    const entry = data.courts.find(item => item.court.id === picked.courtId);
    if (entry && durations.some(value => rangeIsFree(entry.slots, picked.start, value))) return;
    setPicked(null);
    setNotice(`Jam ${picked.start}${entry ? ` di ${entry.court.name}` : ""} baru saja dipesan orang lain. Silakan pilih jam lain.`);
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
  const stripStart = today && date > addDays(today, stripDays - 1) ? addDays(date, -3) : today;
  const days = today ? Array.from({ length: stripDays }, (_, index) => addDays(stripStart, index)).filter(value => value <= lastDay) : [];
  const nextDay = date ? addDays(date, 1) : "";
  const totalFree = data ? data.courts.reduce((sum, entry) => sum + entry.slots.filter(slot => slot.state === "available").length, 0) : 0;
  const anySpecial = !!data?.courts.some(entry => entry.slots.some(slot => slot.rule && slot.state === "available"));

  const pickedCourt = useMemo<ShopCourt | undefined>(
    () => data?.courts.find(entry => entry.court.id === picked?.courtId)?.court,
    [data, picked],
  );
  const pickedSlots = data?.courts.find(entry => entry.court.id === picked?.courtId)?.slots ?? [];
  const available = picked ? durations.filter(value => rangeIsFree(pickedSlots, picked.start, value)) : [];
  // Bila durasi pilihan tidak muat, pakai durasi terpanjang yang masih muat di jam itu.
  const effective = available.includes(duration) ? duration : available.filter(value => value < duration).at(-1) ?? available[0];
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
  const grandTotal = total + extras;
  const payOnline = !!venue?.payment.enabled;
  // Slot yang sudah masuk keranjang ditandai agar tidak dipilih dua kali.
  const cartToday = cart.filter(item => item.date === date);
  const inCart = (courtId: string, start: string) =>
    cartToday.some(item => item.court_id === courtId && minute(start) >= minute(item.start_time) && minute(start) < minute(item.end_time));
  const pickedInCart = !!picked && !!pickedCourt && cartToday.some(item => item.court_id === pickedCourt.id && item.start_time === picked.start);

  const info = venue?.info;
  const policyLine = venue ? policySummary(venue.policies) : null;
  const floors = data?.floors ?? [];
  const pickedFloor = pickedCourt ? floorLabel(floors, pickedCourt.floor_id) : undefined;
  const range = periods.find(item => item.key === period)!;
  // Venue bertingkat: jadwal dikelompokkan per lantai sesuai urutan lantai di denah.
  const groups = data
    ? floors.length > 1
      ? floors.map(floor => ({ floor, entries: data.courts.filter(entry => (entry.court.floor_id ?? floors[0].id) === floor.id) })).filter(group => group.entries.length)
      : [{ floor: null, entries: data.courts }]
    : [];

  function pick(courtId: string, slots: ShopSlot[], slot: ShopSlot) {
    setNotice("");
    if (!durations.some(value => rangeIsFree(slots, slot.start, value))) {
      toast.info(`Mulai pukul ${slot.start} tidak muat`, { description: `Minimal main ${durationLabel(durations[0])}, sedangkan jam setelahnya sudah terisi atau lapangan tutup.` });
      return;
    }
    setPicked(current => current?.courtId === courtId && current.start === slot.start ? null : { courtId, start: slot.start });
  }

  function addPickedToCart(thenCheckout: boolean) {
    if (!picked || !pickedCourt || !end || !effective) return;
    const result = addToCart({
      court_id: pickedCourt.id, court_name: pickedCourt.name, floor: pickedFloor ?? "",
      date, start_time: picked.start, end_time: end, duration: effective, court_total: total,
      addons: chosenAddons.map(({ option, quantity }) => ({
        addon_id: option.id, name: option.name, quantity, unit_price: option.price, pricing: option.pricing,
      })),
    });
    if (result === "ok") {
      setPicked(null);
      if (thenCheckout) { router.push("/keranjang"); return; }
      toast.success("Masuk keranjang", {
        description: `${pickedCourt.name} · ${formatShortDay(date)} ${picked.start}–${end}`,
        action: { label: "Lihat", onClick: () => router.push("/keranjang") },
      });
    } else if (result === "duplicate") toast.info("Sesi ini sudah ada di keranjang.");
    else if (result === "overlap") toast.error("Jam ini bertabrakan dengan sesi lain di keranjang.");
    else toast.error(`Keranjang penuh: maksimal ${maxCartItems} sesi dalam satu pesanan.`);
  }

  return (
    <div className={`book shop-wrap${picked ? " has-sheet" : cart.length ? " has-bar" : ""}`}>
      <ShopSteps current={0} />
      <header className="page-head">
        <div>
          <h1>Pilih jadwal main</h1>
          <p>{date ? formatDay(date) : "Memuat tanggal…"}{data ? ` · ${totalFree} slot kosong` : ""}</p>
        </div>
        <button type="button" className="shop-icon-btn outline" onClick={() => date && void load(date, true)} disabled={!date || refreshing} aria-label="Perbarui jadwal" title="Perbarui jadwal">
          <RefreshCw size={18} className={refreshing ? "spin" : ""} aria-hidden="true" />
        </button>
      </header>

      {/* ---- Pengatur: tanggal, durasi, dan rentang jam ---- */}
      <div className="book-controls">
        <div className="date-chips" ref={stripRef} role="group" aria-label="Pilih tanggal">
          {days.map(value => {
            const [weekday, dayMonth] = formatShortDay(value).split(", ");
            return (
              <button className="date-chip" key={value} type="button" aria-pressed={value === date} onClick={() => goto(value)}>
                <small>{value === today ? "Hari ini" : value === addDays(today, 1) ? "Besok" : weekday}</small>
                <b>{dayMonth}</b>
              </button>
            );
          })}
          <label className="date-chip other">
            <CalendarDays size={18} aria-hidden="true" />
            <small>Lainnya</small>
            <DateInput theme="shop" bare aria-label="Pilih tanggal lain" value={date} min={today} max={lastDay} onChange={event => event.target.value && goto(event.target.value)} />
          </label>
        </div>
        <div className="book-filters">
<DurationPicker label="Lama bermain" value={duration} options={durations} onChange={chooseDuration} />
          <div className="chips" role="group" aria-label="Rentang jam">
            {periods.map(item => (
              <button key={item.key} type="button" className="chip" aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="shop-note error" role="alert">
          {error} <button type="button" onClick={() => date && void load(date)}>Coba lagi</button>
        </p>
      )}
      {notice && <p className="shop-note warn" role="status">{notice}</p>}

      {!data ? (
        !error && (
          <div aria-busy="true" aria-label="Memuat jadwal" className="skeleton-stack">
            <div className="skeleton" /><div className="skeleton" />
          </div>
        )
      ) : data.courts.length === 0 ? (
        <p className="shop-empty">Belum ada lapangan yang dibuka untuk pemesanan.</p>
      ) : (
        <>
          <div className="book-legend" aria-label="Keterangan">
            <span><i className="free" />Kosong</span>
            <span><i className="pick" />Pilihan Anda</span>
            <span><i className="busy" />Terisi</span>
            {anySpecial && <span><i className="special" />Tarif khusus</span>}
            {cartToday.length > 0 && <span><i className="incart" />Di keranjang</span>}
            <button type="button" className="map-toggle" aria-expanded={mapOpen} aria-controls="denah-venue" onClick={() => setMapOpen(open => !open)}>
              <MapIcon size={16} aria-hidden="true" /> {mapOpen ? "Tutup denah" : "Lihat denah"}
            </button>
          </div>

          {mapOpen && (
            <div className="card book-map" id="denah-venue">
              <p className="muted">Ketuk lapangan pada denah untuk melompat ke jadwalnya.</p>
              <VenueMap venue={data.venue} floors={data.floors} courts={data.courts} features={data.features} selected={picked?.courtId} onSelect={focusCourt} />
            </div>
          )}

          {groups.map(group => (
            <Fragment key={group.floor?.id ?? "semua"}>
              {group.floor && (
                <h2 className="floor-head"><Layers size={18} aria-hidden="true" /> {group.floor.name} <small>{group.entries.length} lapangan</small></h2>
              )}
              {group.entries.map(({ court, slots }) => {
                // Slot yang sudah lewat hanya memenuhi layar, jadi disembunyikan.
                const upcoming = date === data.today ? slots.filter(slot => slot.state !== "past") : slots;
                const shown = upcoming.filter(slot => minute(slot.start) >= range.from && minute(slot.start) < range.to);
                const free = slots.filter(slot => slot.state === "available").length;
                const rates = (upcoming.length ? upcoming : slots).map(slot => slot.rate);
                const low = rates.length ? Math.min(...rates) : court.hourly_rate;
                const high = rates.length ? Math.max(...rates) : court.hourly_rate;
                const meta = [court.environment && environmentLabel[court.environment], court.surface, `${court.opens_at}–${court.closes_at}`].filter(Boolean).join(" · ");
                return (
                  <article
                    className={`court-block${picked?.courtId === court.id ? " active" : ""}`}
                    key={court.id}
                    id={`lapangan-${court.id}`}
                    ref={node => { if (node) blocks.current.set(court.id, node); else blocks.current.delete(court.id); }}
                  >
                    <header>
                      <CourtCover name={court.name} photos={court.photos} className="thumb" />
                      <div className="title">
                        <h3>{court.name}</h3>
                        <small>{meta}</small>
                      </div>
                      <div className="rate">
                        <b>{low === high ? shortMoney(low) : `${shortMoney(low)}–${shortMoney(high)}`}</b>
                        <small>per jam</small>
                      </div>
                    </header>
                    {free === 0 ? (
                      <div className="court-empty">
                        <p>{upcoming.length === 0 ? "Jam operasional di tanggal ini sudah lewat." : "Semua jam di tanggal ini sudah terisi."}</p>
                        {nextDay <= lastDay && (
                          <button type="button" className="shop-btn outline sm" onClick={() => goto(nextDay)}>
                            Cek {date === today ? "besok" : formatShortDay(nextDay)} <ArrowRight size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ) : shown.length === 0 ? (
                      <div className="court-empty">
                        <p>Tidak ada jam {range.label.toLowerCase()} di tanggal ini.</p>
                        <button type="button" className="shop-btn outline sm" onClick={() => setPeriod("all")}>Tampilkan semua jam</button>
                      </div>
                    ) : (
                      <div className="slot-grid">
                        {shown.map(slot => {
                          const chosen = covered(court.id, slot.start);
                          const booked = inCart(court.id, slot.start);
                          const open = slot.state === "available";
                          const fits = open && rangeIsFree(slots, slot.start, duration);
                          const longest = open && !fits ? durations.filter(value => rangeIsFree(slots, slot.start, value)).at(-1) : undefined;
                          const special = open && !!slot.rule;
                          const state = chosen ? "picked" : booked ? "incart" : !open ? slot.state : fits ? "free" : longest ? "short" : "nofit";
                          const label = chosen ? "dipilih" : booked ? "sudah di keranjang"
                            : slot.state === "booked" ? "sudah dipesan" : slot.state === "maintenance" ? "sedang perawatan"
                              : fits ? `kosong, ${durationLabel(duration)} ${money(priceFor(slots, slot.start, duration))}`
                                : longest ? `hanya muat ${durationLabel(longest)}` : "tidak muat";
                          return (
                            <button
                              key={slot.start}
                              type="button"
                              className={`slot ${state}${special ? " special" : ""}`}
                              disabled={!open || booked}
                              aria-pressed={chosen}
                              title={special ? `Tarif ${slot.rule}: ${money(slot.rate)} per jam` : undefined}
                              aria-label={`${court.name} pukul ${slot.start}, ${label}${special ? `, tarif ${slot.rule}` : ""}`}
                              onClick={() => pick(court.id, slots, slot)}
                            >
                              <b>{slot.start}</b>
                              <small>
                                {chosen ? "Dipilih" : booked ? "Keranjang" : slot.state === "booked" ? "Terisi" : slot.state === "maintenance" ? "Perawatan"
                                  : fits ? shortMoney(priceFor(slots, slot.start, duration)) : longest ? `Maks ${durationLabel(longest)}` : "Tak muat"}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </Fragment>
          ))}
        </>
      )}

      {/* ---- Lembar pilihan: muncul begitu satu jam dipilih ---- */}
      {picked && pickedCourt && (
        <div className="sheet" role="region" aria-label="Pilihan Anda">
          <div className="sheet-inner">
            <div className="sheet-head">
              <div>
                <small>{pickedFloor ? `${pickedFloor} · ` : ""}{formatShortDay(date)}</small>
                <h2>{pickedCourt.name}</h2>
                <p className="when">{picked.start}{end ? ` – ${end}` : ""} <span>· {effective ? durationLabel(effective) : ""}</span></p>
              </div>
              <button type="button" className="shop-icon-btn soft" onClick={() => setPicked(null)} aria-label="Batalkan pilihan"><X size={18} aria-hidden="true" /></button>
            </div>

            <DurationPicker full label="Durasi untuk jam ini" value={effective ?? duration} options={durations} allowed={value => available.includes(value)} onChange={chooseDuration} />
            {!!effective && effective !== duration && <p className="sheet-note">{durationLabel(duration)} tidak muat mulai {picked.start}, jadi dipakai {durationLabel(effective)}.</p>}
            {appliedRules.length > 0 && <p className="sheet-note">Termasuk tarif {appliedRules.join(" & ")}.</p>}

            {catalog.length > 0 && (
              <div className="sheet-addons">
                <button type="button" className="sheet-addons-toggle" aria-expanded={addonsOpen} aria-controls="pilihan-tambahan" onClick={() => setAddonsOpen(open => !open)}>
                  <PackagePlus size={18} aria-hidden="true" />
                  <span>{pickedCount ? <><b>{pickedCount} tambahan</b> · {money(extras)}</> : <>Sewa raket, bola & lainnya <small>opsional</small></>}</span>
                  <ChevronDown size={18} aria-hidden="true" className="chevron" />
                </button>
                {addonsOpen && (
                  <ShopAddonPicker id="pilihan-tambahan" options={catalog} picks={picks} loading={addonOptions === null}
                    onChange={(id, quantity) => setPicks(current => ({ ...current, [id]: quantity }))} />
                )}
              </div>
            )}

            <div className="sheet-foot">
              <div className="sheet-total">
                <small>{pickedCount ? `Lapangan ${money(total)} + tambahan ${money(extras)}` : "Sewa lapangan"}</small>
                <b>{money(grandTotal)}</b>
              </div>
              {pickedInCart ? (
                <Link className="shop-btn primary" href="/keranjang"><ShoppingBag size={18} aria-hidden="true" /> Sudah di keranjang</Link>
              ) : (
                <div className="sheet-actions">
                  <button className="shop-btn outline" type="button" onClick={() => addPickedToCart(false)} disabled={!effective} title="Simpan di keranjang lalu pilih jam lain">
                    <ShoppingBag size={18} aria-hidden="true" /> + Keranjang
                  </button>
                  <button className="shop-btn primary" type="button" onClick={() => addPickedToCart(true)} disabled={!effective}>
                    Pesan sekarang <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <p className="sheet-fine">
              {payOnline ? "Bayar di langkah berikutnya. " : info?.whatsapp ? "Pesanan dikirim ke staf lewat WhatsApp. " : "Tunjukkan keranjang ke staf venue. "}
              {policyLine && <Link href="/kebijakan#pembatalan">{policyLine}.</Link>}
            </p>
          </div>
        </div>
      )}

      {/* ---- Bilah keranjang: selalu tahu isi keranjang dan jalan ke sana ---- */}
      {!picked && cart.length > 0 && (
        <Link className="cart-bar" href="/keranjang">
          <span className="count"><ShoppingBag size={18} aria-hidden="true" /> {cart.length}</span>
          <span className="sum"><small>{cart.length} sesi di keranjang</small><b>{money(cartTotal(cart))}</b></span>
          <span className="go">Lanjut <ArrowRight size={18} aria-hidden="true" /></span>
        </Link>
      )}
    </div>
  );
}

export default function AvailabilityPage() {
  return (
    <Suspense fallback={<div className="book shop-wrap"><p className="shop-empty">Memuat jadwal…</p></div>}>
      <AvailabilityView />
    </Suspense>
  );
}
