import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, AtSign, CalendarCheck, Check, Clock3, CreditCard, Mail, MapPin, MessageCircle,
  Navigation, Phone, ShieldCheck, ShoppingBag,
} from "lucide-react";
import { money } from "@/lib/api";
import { CourtCover } from "@/components/photo-gallery";
import { FacilityIcon } from "@/components/facility-icon";
import { RichText } from "@/components/rich-text";
import { ShopAddonCatalog } from "@/components/shop-addons";
import { ShopStart } from "@/components/shop-start";
import { FaqList, RefundTiers } from "@/components/shop-policy";
import { availability, venueInfo } from "@/lib/server-data";
import { environmentLabel, facilityLabels, hasCancellationPolicy, mapsEmbed, mapsLink, rescheduleLine, whatsappLink } from "@/lib/venue-info";
import { floorLabel, venueNow } from "@/lib/shop";
import { brandName } from "@/lib/brand";

/** Sama dengan batas jendela jadwal di API publik. */
const horizonDays = 90;

/** Jadwal berubah setiap menit, jadi halaman disusun ulang pada setiap kunjungan. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const data = await venueInfo();
  const name = data?.info.name?.trim();
  return {
    title: { absolute: `${brandName(data?.info)} — Booking Lapangan Padel` },
    description: data?.info.tagline?.trim() || "Cek ketersediaan lapangan padel dan pesan jam main Anda secara online.",
  };
}

export default async function HomePage() {
  const today = venueNow().date;
  const [venue, data] = await Promise.all([venueInfo(), availability(today)]);

  const info = venue?.info;
  const policies = venue?.policies;
  const faqs = venue?.faqs ?? [];
  const floors = data?.floors ?? [];
  const order = (floorId: string | null) => Math.max(0, floors.findIndex(floor => floor.id === floorId));
  // Urut per lantai; urutan nama dari API tetap terjaga karena sort bersifat stabil.
  const entries = [...(data?.courts ?? [])].sort((a, b) => order(a.court.floor_id) - order(b.court.floor_id));
  const courts = entries.map(entry => entry.court);
  const freeByCourt = new Map(entries.map(entry => [entry.court.id, entry.slots.filter(slot => slot.state === "available").length]));
  const freeToday = [...freeByCourt.values()].reduce((sum, value) => sum + value, 0);

  const lowest = courts.length ? Math.min(...courts.map(court => court.rate_min)) : 0;
  const opens = courts.length ? courts.map(court => court.opens_at).sort()[0] : "";
  const closes = courts.length ? courts.map(court => court.closes_at).sort().at(-1)! : "";
  const showcase = courts.find(court => court.photos.length > 0);

  const facilities = info ? info.facilities.length + info.extra_facilities.length : 0;
  const reachable = !!info && !!(info.address || info.about || info.whatsapp || info.phone || info.email || info.instagram || info.hours_note);
  const showMap = !!info?.address && info.show_map;
  const cancellation = !!policies && hasCancellationPolicy(policies);
  const payOnline = !!venue?.payment.enabled;
  const name = info?.name?.trim() || "";
  const askText = `Halo${name ? ` ${name}` : ""}, saya ingin bertanya tentang booking lapangan.`;
  const scheduleHref = (courtId: string) => `/ketersediaan?date=${today}#lapangan-${encodeURIComponent(courtId)}`;

  return (
    <>
      {/* ---- Hero: satu kalimat, kabar jadwal hari ini, dan langkah pertama ---- */}
      <section className="hero">
        {showcase && (
          <div className="hero-photo" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto dari API sendiri, sudah diperkecil saat diunggah */}
            <img src={`/api/public/photos/${encodeURIComponent(showcase.photos[0])}`} alt="" fetchPriority="high" decoding="async" />
          </div>
        )}
        <div className="shop-wrap hero-inner">
          <div className="hero-copy">
            <h1>Booking lapangan padel, <em>beres dalam semenit.</em></h1>
            <p className="hero-lead">
              {info?.tagline?.trim() || "Lihat jam kosong secara langsung, pilih durasi, dan ketahui total biayanya sebelum memesan."}
            </p>
            {data ? (
              <p className={`hero-live${freeToday === 0 ? " idle" : ""}`}>
                <i aria-hidden="true" />
                {freeToday > 0 ? <><b>{freeToday} slot kosong</b> hari ini</> : <>Hari ini penuh, <b>coba besok</b></>}
              </p>
            ) : (
              <p className="hero-live idle"><i aria-hidden="true" />Jadwal langsung belum dapat dimuat</p>
            )}
            {courts.length > 0 && (
              <ul className="hero-facts">
                <li><b>{courts.length}</b> lapangan</li>
                {lowest > 0 && <li>mulai <b>{money(lowest)}</b>/jam</li>}
                {opens && <li>buka <b>{opens}–{closes}</b></li>}
              </ul>
            )}
          </div>
          <ShopStart today={data?.today ?? today} horizon={horizonDays} />
        </div>
      </section>

      {/* ---- Lapangan ---- */}
      <section className="home-sec" id="lapangan" aria-labelledby="judul-lapangan">
        <div className="shop-wrap">
          <header className="sec-head">
            <div>
              <h2 id="judul-lapangan">Pilih lapangan</h2>
              <p>Tarif per jam dan sisa slot hari ini.</p>
            </div>
            <Link className="text-link" href="/ketersediaan">Semua jadwal <ArrowRight size={16} aria-hidden="true" /></Link>
          </header>

          {!data ? (
            <p className="shop-note error" role="alert">Daftar lapangan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p>
          ) : courts.length === 0 ? (
            <p className="shop-empty">Belum ada lapangan yang dibuka untuk pemesanan.</p>
          ) : (
            <div className="court-rail">
              {courts.map((court, index) => {
                const free = freeByCourt.get(court.id) ?? 0;
                const floor = floorLabel(floors, court.floor_id);
                const tags = [floor, court.environment && environmentLabel[court.environment], court.surface].filter(Boolean);
                return (
                  <article className="court-card" key={court.id}>
                    <div className="court-card-media">
                      <CourtCover name={court.name} photos={court.photos} priority={index === 0} />
                      <span className={`avail-badge ${free === 0 ? "full" : free <= 3 ? "few" : "open"}`}>
                        {free === 0 ? "Penuh hari ini" : `${free} slot kosong`}
                      </span>
                    </div>
                    <div className="court-card-body">
                      <h3>{court.name}</h3>
                      {tags.length > 0 && <p className="court-card-tags">{tags.join(" · ")}</p>}
                      {court.description && <p className="court-card-desc">{court.description}</p>}
                      <div className="court-card-foot">
                        <div className="price">
                          <small>{court.rate_min < court.rate_max ? "Mulai" : "Tarif"}</small>
                          <b>{money(court.rate_min)}<span>/jam</span></b>
                        </div>
                        <Link className="shop-btn primary sm" href={scheduleHref(court.id)} aria-label={`Pilih jam di ${court.name}`}>
                          Pilih jam <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ---- Cara memesan ---- */}
      <section className="home-sec soft" aria-labelledby="judul-cara">
        <div className="shop-wrap">
          <header className="sec-head">
            <div>
              <h2 id="judul-cara">Cara booking</h2>
              <p>Tanpa telepon, tanpa menunggu balasan.</p>
            </div>
          </header>
          <ol className="how">
            <li>
              <span className="how-icon"><CalendarCheck size={22} aria-hidden="true" /></span>
              <div><h3>Pilih tanggal & jam</h3><p>Semua lapangan tampil sekaligus. Hanya jam yang muat untuk durasi Anda yang bisa dipilih.</p></div>
            </li>
            <li>
              <span className="how-icon"><ShoppingBag size={22} aria-hidden="true" /></span>
              <div><h3>Tambah sewa raket bila perlu</h3><p>Raket, bola, atau pelatih ikut dalam pesanan yang sama. Beberapa sesi bisa masuk satu keranjang.</p></div>
            </li>
            <li>
              <span className="how-icon"><CreditCard size={22} aria-hidden="true" /></span>
              <div>
                {payOnline ? (
                  <><h3>Bayar sekali</h3><p>QRIS, virtual account, e-wallet, atau kartu. Slot dikunci untuk Anda selama pembayaran berlangsung.</p></>
                ) : info?.whatsapp ? (
                  <><h3>Kirim ke venue</h3><p>Isi keranjang terkirim lewat WhatsApp dengan satu ketukan, lalu staf mengonfirmasi slotnya.</p></>
                ) : (
                  <><h3>Tunjukkan ke staf</h3><p>Bawa daftar di keranjang Anda ke resepsionis untuk mengamankan slotnya.</p></>
                )}
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* ---- Sewa & tambahan ---- */}
      {venue && venue.addons.length > 0 && (
        <section className="home-sec" id="tambahan" aria-labelledby="judul-tambahan">
          <div className="shop-wrap">
            <header className="sec-head">
              <div>
                <h2 id="judul-tambahan">Lupa bawa raket? Sewa di sini</h2>
                <p>Dipilih saat booking, dibayar bersama sewa lapangan.</p>
              </div>
            </header>
            <ShopAddonCatalog items={venue.addons} />
          </div>
        </section>
      )}

      {/* ---- Fasilitas ---- */}
      {info && facilities > 0 && (
        <section className="home-sec tight" aria-labelledby="judul-fasilitas">
          <div className="shop-wrap">
            <header className="sec-head"><div><h2 id="judul-fasilitas">Fasilitas</h2></div></header>
            <ul className="facility-list">
              {info.facilities.map(kind => <li key={kind}><FacilityIcon kind={kind} size={18} /> {facilityLabels[kind]}</li>)}
              {info.extra_facilities.map(item => <li key={item}><Check size={18} aria-hidden="true" /> {item}</li>)}
            </ul>
          </div>
        </section>
      )}

      {/* ---- Lokasi & kontak ---- */}
      {info && reachable && (
        <section className="home-sec" id="lokasi" aria-labelledby="judul-lokasi">
          <div className="shop-wrap">
            <header className="sec-head"><div><h2 id="judul-lokasi">{info.address ? "Lokasi & kontak" : "Tentang venue"}</h2></div></header>
            <div className={`place${showMap ? "" : " single"}`}>
              <div className="place-card">
                {info.about && <RichText text={info.about} className="place-about" />}
                <ul className="contact-list">
                  {info.address && <li><MapPin aria-hidden="true" /><div><small>Alamat</small><span>{info.address}</span></div></li>}
                  {info.hours_note && <li><Clock3 aria-hidden="true" /><div><small>Jam buka</small><span>{info.hours_note}</span></div></li>}
                  {info.phone && <li><Phone aria-hidden="true" /><div><small>Telepon</small><a href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}>{info.phone}</a></div></li>}
                  {info.email && <li><Mail aria-hidden="true" /><div><small>Email</small><a href={`mailto:${info.email}`}>{info.email}</a></div></li>}
                  {info.instagram && <li><AtSign aria-hidden="true" /><div><small>Instagram</small><a href={`https://instagram.com/${info.instagram}`} target="_blank" rel="noopener">@{info.instagram}</a></div></li>}
                </ul>
                {(info.whatsapp || info.address) && (
                  <div className="btn-row">
                    {info.whatsapp && (
                      <a className="shop-btn primary" href={whatsappLink(info.whatsapp, askText)} target="_blank" rel="noopener">
                        <MessageCircle size={18} aria-hidden="true" /> Chat WhatsApp
                      </a>
                    )}
                    {info.address && <a className="shop-btn outline" href={mapsLink(info)} target="_blank" rel="noopener"><Navigation size={17} aria-hidden="true" /> Petunjuk arah</a>}
                  </div>
                )}
              </div>
              {showMap && (
                <div className="place-map">
                  <iframe title={`Peta lokasi ${name || "venue"}`} src={mapsEmbed(info.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- Sebelum memesan ---- */}
      {policies && (cancellation || faqs.length > 0) && (
        <section className="home-sec soft" aria-labelledby="judul-bantuan">
          <div className="shop-wrap">
            <header className="sec-head"><div><h2 id="judul-bantuan">Sebelum memesan</h2><p>Hal yang paling sering ditanyakan.</p></div></header>
            <div className={`before${cancellation && faqs.length ? "" : " single"}`}>
              {cancellation && (
                <article className="card policy-card">
                  <h3><ShieldCheck size={20} aria-hidden="true" /> Kebijakan pembatalan</h3>
                  <RefundTiers policies={policies} />
                  {rescheduleLine(policies) && <p className="muted">{rescheduleLine(policies)}</p>}
                  <Link className="text-link" href="/kebijakan#pembatalan">Kebijakan lengkap <ArrowRight size={15} aria-hidden="true" /></Link>
                </article>
              )}
              {faqs.length > 0 && (
                <div>
                  <FaqList items={faqs.slice(0, 4)} />
                  {faqs.length > 4 && <Link className="text-link faq-more" href="/faq">Lihat semua {faqs.length} pertanyaan <ArrowRight size={15} aria-hidden="true" /></Link>}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- Ajakan penutup ---- */}
      <section className="home-sec tight">
        <div className="shop-wrap">
          <div className="closing">
            <div>
              <h2>Siap main?</h2>
              <p>{freeToday > 0 ? `Masih ada ${freeToday} slot kosong hari ini.` : "Lihat jadwal hari berikutnya dan amankan jam main Anda."}</p>
            </div>
            <div className="btn-row">
              <Link className="shop-btn lime" href="/ketersediaan">Pesan sekarang <ArrowRight size={18} aria-hidden="true" /></Link>
              {info?.whatsapp && (
                <a className="shop-btn on-dark" href={whatsappLink(info.whatsapp, askText)} target="_blank" rel="noopener">
                  <MessageCircle size={17} aria-hidden="true" /> Tanya dulu
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
