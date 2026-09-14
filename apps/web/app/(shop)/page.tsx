"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, CreditCard, MapPinned, Sparkles, Timer } from "lucide-react";
import { money } from "@/lib/api";
import { VenueMap } from "@/components/venue-map";
import { addDays, fetchAvailability, formatShortDay, venueNow, type Availability } from "@/lib/shop";

export default function ShopLandingPage() {
  const router = useRouter();
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [data, setData] = useState<Availability | null>(null);
  const [failed, setFailed] = useState(false);

  // Tanggal dihitung setelah render agar zona waktu venue tidak bentrok dengan hasil prerender.
  useEffect(() => {
    const now = venueNow();
    setToday(now.date);
    setDate(now.date);
    fetchAvailability(now.date).then(setData).catch(() => setFailed(true));
  }, []);

  const quickDays = today ? [0, 1, 2, 3].map(offset => addDays(today, offset)) : [];
  const freeByCourt = useMemo(
    () => new Map((data?.courts ?? []).map(entry => [entry.court.id, entry.slots.filter(slot => slot.state === "available").length])),
    [data],
  );
  const freeToday = [...freeByCourt.values()].reduce((sum, value) => sum + value, 0);
  const lowestRate = data?.courts.length ? Math.min(...data.courts.map(entry => entry.court.hourly_rate)) : 0;
  const scheduleHref = (courtId: string) => `/ketersediaan?date=${today}#lapangan-${courtId}`;

  return (
    <>
      <section className="shop-hero">
        <div className="shop-hero-copy">
          <span className="shop-eyebrow"><Sparkles size={14} /> BOOKING LAPANGAN PADEL</span>
          <h1>Cari slot kosong, <em>langsung main.</em></h1>
          <p>Lihat jadwal semua lapangan secara langsung, pilih jam dan durasi yang cocok, dan ketahui total biayanya sebelum memesan.</p>

          <form className="shop-picker" onSubmit={event => { event.preventDefault(); if (date) router.push(`/ketersediaan?date=${date}`); }}>
            <div className="shop-picker-days" role="group" aria-label="Pilih tanggal main">
              {quickDays.map((value, index) => {
                const [weekday, dayMonth] = formatShortDay(value).split(", ");
                return (
                  <button type="button" key={value} aria-pressed={date === value} onClick={() => setDate(value)}>
                    <small>{index === 0 ? "Hari ini" : index === 1 ? "Besok" : weekday}</small>
                    <b>{dayMonth}</b>
                  </button>
                );
              })}
              <label className={`shop-picker-other${date && !quickDays.includes(date) ? " active" : ""}`}>
                <small>Tanggal lain</small>
                <input type="date" value={date} min={today} onChange={event => setDate(event.target.value)} />
              </label>
            </div>
            <button className="shop-cta" type="submit" disabled={!date}>
              Lihat slot kosong <ArrowRight size={18} />
            </button>
          </form>
        </div>

        <aside className="shop-hero-visual" aria-label="Denah venue hari ini">
          <div className="shop-hero-visual-head">
            <div>
              <small>Hari ini</small>
              <b>{today ? formatShortDay(today) : "…"}</b>
            </div>
            <span className={`shop-live${data ? "" : " idle"}`}>
              {data ? `${freeToday} slot kosong` : failed ? "Belum dapat dimuat" : "Memuat…"}
            </span>
          </div>
          {data && data.courts.length > 0 ? (
            <VenueMap venue={data.venue} courts={data.courts} features={data.features} onSelect={courtId => router.push(scheduleHref(courtId))} compact />
          ) : (
            <div className="shop-hero-placeholder">{failed ? "Denah belum dapat dimuat. Coba muat ulang halaman." : "Menyiapkan denah venue…"}</div>
          )}
          <p>Ketuk lapangan pada denah untuk langsung melihat jamnya.</p>
        </aside>
      </section>

      <section className="shop-section shop-facts" aria-label="Sekilas tentang venue">
        <div><MapPinned size={20} /><b>{data ? `${data.courts.length} lapangan` : "–"}</b><span>Semua jadwal dalam satu halaman</span></div>
        <div><CreditCard size={20} /><b>{lowestRate ? `Mulai ${money(lowestRate)}` : "–"}</b><span>Per jam, durasi 1 sampai 2 jam</span></div>
        <div><Timer size={20} /><b>90 hari ke depan</b><span>Rencanakan jadwal main lebih awal</span></div>
      </section>

      <section className="shop-section">
        <div className="shop-section-head">
          <div>
            <h2>Lapangan kami</h2>
            <p>Tarif per jam dan sisa slot hari ini.</p>
          </div>
        </div>
        {failed ? (
          <p className="shop-note error" role="alert">Daftar lapangan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p>
        ) : !data ? (
          <div className="shop-courts" aria-hidden="true">{[0, 1, 2].map(key => <div className="shop-court-card skeleton" key={key} />)}</div>
        ) : data.courts.length === 0 ? (
          <p className="shop-empty">Belum ada lapangan yang dibuka untuk pemesanan.</p>
        ) : (
          <div className="shop-courts">
            {data.courts.map(({ court }) => {
              const free = freeByCourt.get(court.id) ?? 0;
              return (
                <article className="shop-court-card" key={court.id}>
                  <div className="shop-court-card-head">
                    <h3>{court.name}</h3>
                    <span className={`shop-availability ${free === 0 ? "full" : free <= 3 ? "few" : "open"}`}>
                      {free === 0 ? "Penuh hari ini" : `${free} slot kosong hari ini`}
                    </span>
                  </div>
                  <span className="hours"><Clock3 size={15} /> Buka {court.opens_at} – {court.closes_at}</span>
                  <span className="price">{money(court.hourly_rate)} <small>/ jam</small></span>
                  <Link className="shop-ghost" href={scheduleHref(court.id)}>Lihat jadwal <ArrowRight size={16} /></Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="shop-section">
        <div className="shop-section-head">
          <div>
            <h2>Cara memesan</h2>
            <p>Tidak perlu menelepon hanya untuk menanyakan jadwal.</p>
          </div>
        </div>
        <ol className="shop-steps">
          <li className="shop-step">
            <span>1</span>
            <h3>Pilih tanggal</h3>
            <p>Lihat slot yang masih kosong di semua lapangan sekaligus, lengkap dengan denah venue.</p>
          </li>
          <li className="shop-step">
            <span>2</span>
            <h3>Pilih jam dan durasi</h3>
            <p>Tentukan jam mulai dan lama bermain. Total biaya langsung terlihat sebelum Anda lanjut.</p>
          </li>
          <li className="shop-step">
            <span>3</span>
            <h3>Bayar online <em className="shop-badge">Segera hadir</em></h3>
            <p>Selama pembayaran online disiapkan, tunjukkan ringkasan pilihan Anda ke staf venue untuk mengamankan slot.</p>
          </li>
        </ol>
      </section>
    </>
  );
}
