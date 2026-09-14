"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, AtSign, Check, Clock3, CreditCard, Mail, MapPin, MapPinned, MessageCircle, Navigation, Phone, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { money } from "@/lib/api";
import { VenueMap } from "@/components/venue-map";
import { CourtCover } from "@/components/photo-gallery";
import { FacilityIcon } from "@/components/facility-icon";
import { RichText } from "@/components/rich-text";
import { FaqList, RefundTiers, useScrollToHash } from "@/components/shop-policy";
import { useVenueInfo } from "@/lib/use-venue-info";
import { environmentLabel, facilityLabels, hasCancellationPolicy, mapsEmbed, mapsLink, rescheduleLine, whatsappLink } from "@/lib/venue-info";
import { addDays, fetchAvailability, floorLabel, formatShortDay, venueNow, type Availability } from "@/lib/shop";

export default function ShopLandingPage() {
  const router = useRouter();
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [data, setData] = useState<Availability | null>(null);
  const [failed, setFailed] = useState(false);
  const { data: venue } = useVenueInfo();
  useScrollToHash(!!data && !!venue);

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
  const floors = data?.floors ?? [];
  const floorOrder = (floorId: string | null) => Math.max(0, floors.findIndex(floor => floor.id === floorId));
  // Urut per lantai; urutan nama dari API tetap terjaga karena sort bersifat stabil.
  const courts = (data?.courts.map(entry => entry.court) ?? []).sort((a, b) => floorOrder(a.floor_id) - floorOrder(b.floor_id));
  const lowestRate = courts.length ? Math.min(...courts.map(court => court.rate_min)) : 0;
  const variesByTime = courts.some(court => court.rate_min < court.rate_max);
  const indoor = courts.filter(court => court.environment === "indoor").length, outdoor = courts.filter(court => court.environment === "outdoor").length;
  const scheduleHref = (courtId: string) => `/ketersediaan?date=${today}#lapangan-${courtId}`;

  const info = venue?.info, policies = venue?.policies, faqs = venue?.faqs ?? [];
  const facilities = info ? info.facilities.length + info.extra_facilities.length : 0;
  const hasContact = !!info && !!(info.address || info.about || info.whatsapp || info.phone || info.email || info.instagram || info.hours_note);
  const showMap = !!info?.address && info.show_map;
  const cancellation = !!policies && hasCancellationPolicy(policies);

  return (
    <>
      <section className="shop-hero">
        <div className="shop-hero-copy">
          <span className="shop-eyebrow"><Sparkles size={14} /> {info?.name ? info.name.toUpperCase() : "BOOKING LAPANGAN PADEL"}</span>
          <h1>Cari slot kosong, <em>langsung main.</em></h1>
          <p>{info?.tagline || "Lihat jadwal semua lapangan secara langsung, pilih jam dan durasi yang cocok, dan ketahui total biayanya sebelum memesan."}</p>

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
            <VenueMap venue={data.venue} floors={data.floors} courts={data.courts} features={data.features} onSelect={courtId => router.push(scheduleHref(courtId))} compact />
          ) : (
            <div className="shop-hero-placeholder">{failed ? "Denah belum dapat dimuat. Coba muat ulang halaman." : "Menyiapkan denah venue…"}</div>
          )}
          <p>Ketuk lapangan pada denah untuk langsung melihat jamnya.</p>
        </aside>
      </section>

      <section className="shop-section shop-facts" aria-label="Sekilas tentang venue">
        <div><MapPinned size={20} /><b>{data ? `${courts.length} lapangan` : "–"}</b><span>{floors.length > 1 || indoor || outdoor ? [floors.length > 1 && `${floors.length} lantai`, indoor && `${indoor} indoor`, outdoor && `${outdoor} outdoor`].filter(Boolean).join(" · ") : "Semua jadwal dalam satu halaman"}</span></div>
        <div><CreditCard size={20} /><b>{lowestRate ? `Mulai ${money(lowestRate)}` : "–"}</b><span>{variesByTime ? "Per jam, tarif berbeda di jam tertentu" : "Per jam, durasi 1 sampai 2 jam"}</span></div>
        <div><Timer size={20} /><b>90 hari ke depan</b><span>Rencanakan jadwal main lebih awal</span></div>
      </section>

      <section className="shop-section" id="lapangan">
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
            {courts.map(court => {
              const free = freeByCourt.get(court.id) ?? 0;
              const varies = court.rate_min < court.rate_max;
              const floorName = floorLabel(floors, court.floor_id);
              return (
                <article className="shop-court-card" key={court.id}>
                  <CourtCover name={court.name} photos={court.photos} />
                  <div className="shop-court-card-body">
                    <div className="shop-court-card-head">
                      <h3>{court.name}</h3>
                      <span className={`shop-availability ${free === 0 ? "full" : free <= 3 ? "few" : "open"}`}>
                        {free === 0 ? "Penuh hari ini" : `${free} slot kosong hari ini`}
                      </span>
                    </div>
                    {(floorName || court.environment || court.surface) && (
                      <div className="shop-tags">
                        {floorName && <span className="floor">{floorName}</span>}
                        {court.environment && <span className={court.environment}>{environmentLabel[court.environment]}</span>}
                        {court.surface && <span>{court.surface}</span>}
                      </div>
                    )}
                    {court.description && <p className="shop-court-desc">{court.description}</p>}
                    <span className="hours"><Clock3 size={15} /> Buka {court.opens_at} – {court.closes_at}</span>
                    <span className="price">{varies && <small className="from">Mulai</small>} {money(court.rate_min)} <small>/ jam</small></span>
                    {varies && <span className="shop-rate-note">Hingga {money(court.rate_max)} per jam pada jam atau hari tertentu</span>}
                    <Link className="shop-ghost" href={scheduleHref(court.id)}>Lihat jadwal <ArrowRight size={16} /></Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {info && facilities > 0 && (
        <section className="shop-section" aria-labelledby="judul-fasilitas">
          <div className="shop-section-head">
            <div>
              <h2 id="judul-fasilitas">Fasilitas</h2>
              <p>Yang tersedia di venue untuk kenyamanan Anda.</p>
            </div>
          </div>
          <ul className="shop-facilities">
            {info.facilities.map(kind => <li key={kind}><FacilityIcon kind={kind} size={20} /> {facilityLabels[kind]}</li>)}
            {info.extra_facilities.map(item => <li key={item}><Check size={20} aria-hidden="true" /> {item}</li>)}
          </ul>
        </section>
      )}

      {info && hasContact && (
        <section className="shop-section" id="lokasi" aria-labelledby="judul-lokasi">
          <div className="shop-section-head">
            <div>
              <h2 id="judul-lokasi">{info.address ? "Lokasi & kontak" : "Tentang & kontak"}</h2>
              {info.name && <p>{info.name}</p>}
            </div>
          </div>
          <div className={`shop-location${showMap ? "" : " single"}`}>
            <div className="shop-location-card">
              {info.about && <RichText text={info.about} className="shop-about" />}
              <ul className="shop-contact-list">
                {info.address && <li><MapPin aria-hidden="true" /><div><small>Alamat</small><span>{info.address}</span></div></li>}
                {info.hours_note && <li><Clock3 aria-hidden="true" /><div><small>Jam buka</small><span>{info.hours_note}</span></div></li>}
                {info.phone && <li><Phone aria-hidden="true" /><div><small>Telepon</small><a href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}>{info.phone}</a></div></li>}
                {info.email && <li><Mail aria-hidden="true" /><div><small>Email</small><a href={`mailto:${info.email}`}>{info.email}</a></div></li>}
                {info.instagram && <li><AtSign aria-hidden="true" /><div><small>Instagram</small><a href={`https://instagram.com/${info.instagram}`} target="_blank" rel="noopener">@{info.instagram}</a></div></li>}
              </ul>
              {(info.whatsapp || info.address) && (
                <div className="shop-location-actions">
                  {info.whatsapp && (
                    <a className="shop-cta" href={whatsappLink(info.whatsapp, `Halo${info.name ? ` ${info.name}` : ""}, saya ingin bertanya tentang booking lapangan.`)} target="_blank" rel="noopener">
                      <MessageCircle size={18} aria-hidden="true" /> Chat WhatsApp
                    </a>
                  )}
                  {info.address && <a className="shop-ghost" href={mapsLink(info)} target="_blank" rel="noopener"><Navigation size={17} aria-hidden="true" /> Petunjuk arah</a>}
                </div>
              )}
            </div>
            {showMap && (
              <div className="shop-map-embed">
                <iframe title={`Peta lokasi ${info.name || "venue"}`} src={mapsEmbed(info.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
              </div>
            )}
          </div>
        </section>
      )}

      {policies && (cancellation || faqs.length > 0) && (
        <section className="shop-section" aria-labelledby="judul-bantuan">
          <div className="shop-section-head">
            <div>
              <h2 id="judul-bantuan">Sebelum memesan</h2>
              <p>Aturan pembatalan dan jawaban atas pertanyaan yang sering muncul.</p>
            </div>
          </div>
          <div className={`shop-trust${cancellation && faqs.length ? "" : " single"}`}>
            {cancellation && (
              <article className="shop-policy-card">
                <header><ShieldCheck size={22} aria-hidden="true" /><h3>Kebijakan pembatalan</h3></header>
                <RefundTiers policies={policies} />
                {rescheduleLine(policies) && <p>{rescheduleLine(policies)}</p>}
                <Link className="shop-text-link" href="/kebijakan#pembatalan">Baca kebijakan lengkap <ArrowRight size={15} aria-hidden="true" /></Link>
              </article>
            )}
            {faqs.length > 0 && (
              <div className="shop-faq-preview">
                <FaqList items={faqs.slice(0, 3)} />
                {faqs.length > 3 && <Link className="shop-text-link" href="/faq">Lihat semua {faqs.length} pertanyaan <ArrowRight size={15} aria-hidden="true" /></Link>}
              </div>
            )}
          </div>
        </section>
      )}

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
            {info?.whatsapp ? (
              <>
                <h3>Kirim ke venue</h3>
                <p>Kirim pilihan Anda lewat WhatsApp dengan satu ketukan, lalu staf mengonfirmasi slotnya. Pembayaran online segera hadir.</p>
              </>
            ) : (
              <>
                <h3>Bayar online <em className="shop-badge">Segera hadir</em></h3>
                <p>Selama pembayaran online disiapkan, tunjukkan ringkasan pilihan Anda ke staf venue untuk mengamankan slot.</p>
              </>
            )}
          </li>
        </ol>
      </section>
    </>
  );
}
