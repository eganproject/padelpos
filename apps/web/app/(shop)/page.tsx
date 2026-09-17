import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, AtSign, CalendarRange, Check, Clock3, Mail, MapPin, MapPinned, MessageCircle,
  Navigation, Phone, ShieldCheck, Sparkles, Wallet,
} from "lucide-react";
import { money } from "@/lib/api";
import { CourtCover } from "@/components/photo-gallery";
import { FacilityIcon } from "@/components/facility-icon";
import { RichText } from "@/components/rich-text";
import { ShopAddonCatalog } from "@/components/shop-addons";
import { ShopStart } from "@/components/shop-start";
import { FaqList, RefundTiers } from "@/components/shop-policy";
import { VenueMapNav } from "@/components/venue-map";
import { availability, venueInfo } from "@/lib/server-data";
import { environmentLabel, facilityLabels, hasCancellationPolicy, mapsEmbed, mapsLink, rescheduleLine, whatsappLink } from "@/lib/venue-info";
import { floorLabel, venueNow } from "@/lib/shop";

/** Sama dengan batas jendela jadwal di API publik. */
const horizonDays = 90;

/** Jadwal berubah setiap menit, jadi halaman disusun ulang pada setiap kunjungan. */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const data = await venueInfo();
  const name = data?.info.name?.trim();
  return {
    title: { absolute: name ? `${name} — Booking Lapangan Padel` : "Padelix — Booking Lapangan Padel" },
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
  const varies = courts.some(court => court.rate_min < court.rate_max);
  const indoor = courts.filter(court => court.environment === "indoor").length;
  const outdoor = courts.filter(court => court.environment === "outdoor").length;
  const opens = courts.length ? courts.map(court => court.opens_at).sort()[0] : "";
  const closes = courts.length ? courts.map(court => court.closes_at).sort().at(-1)! : "";
  const gallery = courts.flatMap(court => court.photos.map(photo => ({ photo, court: court.name }))).slice(0, 8);
  const showcase = courts.find(court => court.photos.length > 0);

  const facilities = info ? info.facilities.length + info.extra_facilities.length : 0;
  const reachable = !!info && !!(info.address || info.about || info.whatsapp || info.phone || info.email || info.instagram || info.hours_note);
  const showMap = !!info?.address && info.show_map;
  const cancellation = !!policies && hasCancellationPolicy(policies);
  const payOnline = !!venue?.payment.enabled;
  const scheduleHref = (courtId: string) => `/ketersediaan?date=${today}#lapangan-${encodeURIComponent(courtId)}`;

  return (
    <>
      {/* ---- Hero: suasana lapangan, satu kalimat, dan langkah pertama ---- */}
      <section className="shop-hero">
        {showcase && (
          <div className="shop-hero-photo" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto dari API sendiri, sudah diperkecil saat diunggah */}
            <img src={`/api/public/photos/${encodeURIComponent(showcase.photos[0])}`} alt="" fetchPriority="high" decoding="async" />
          </div>
        )}
        <div className="shop-hero-veil" aria-hidden="true" />
        {/* Dengan foto venue, hero memakai satu kolom penuh di atas fotonya. Tanpa foto,
            kolom kanan diisi gambar lapangan sehingga hero tetap punya suasana. */}
        <div className={`shop-wrap shop-hero-inner${showcase ? " solo" : ""}`}>
          <div>
            <span className="shop-eyebrow"><Sparkles size={14} aria-hidden="true" /> {info?.name?.trim() || "Booking lapangan padel"}</span>
            <h1>Cari jam kosong, <em>langsung main.</em></h1>
            <p className="shop-hero-lead">
              {info?.tagline?.trim() || "Lihat jadwal semua lapangan secara langsung, pilih jam dan durasi yang cocok, dan ketahui total biayanya sebelum memesan."}
            </p>
            {data ? (
              <p className={`shop-hero-live${freeToday === 0 ? " idle" : ""}`}>
                <i aria-hidden="true" />
                {freeToday > 0
                  ? <><b>{freeToday} slot kosong</b> hari ini di {courts.length} lapangan</>
                  : <>Semua lapangan penuh hari ini — <b>coba besok</b></>}
              </p>
            ) : (
              <p className="shop-hero-live idle"><i aria-hidden="true" />Jadwal langsung belum dapat dimuat</p>
            )}
            <ShopStart today={data?.today ?? today} horizon={horizonDays} />
          </div>

          {!showcase && (
            <div className="shop-court-art" aria-hidden="true">
              <span className="glow" />
              <span className="stage">
                <span className="floor" />
                <span className="lines" />
                <span className="service a" />
                <span className="service b" />
                <span className="ball" />
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ---- Angka penting, menumpang di batas hero ---- */}
      <div className="shop-wrap">
        <div className="shop-facts">
          <div>
            <MapPinned size={22} aria-hidden="true" />
            <b>{courts.length ? `${courts.length} lapangan` : "—"}</b>
            <span>{[floors.length > 1 && `${floors.length} lantai`, indoor && `${indoor} indoor`, outdoor && `${outdoor} outdoor`].filter(Boolean).join(" · ") || "Semua jadwal dalam satu halaman"}</span>
          </div>
          <div>
            <Wallet size={22} aria-hidden="true" />
            <b>{lowest ? `Mulai ${money(lowest)}` : "—"}</b>
            <span>{varies ? "Per jam; tarif berbeda di jam tertentu" : "Per jam, durasi 1 sampai 2 jam"}</span>
          </div>
          <div>
            <Clock3 size={22} aria-hidden="true" />
            <b>{opens ? `${opens} – ${closes}` : "—"}</b>
            <span>{info?.hours_note?.trim() || "Jam buka lapangan hari ini"}</span>
          </div>
          <div>
            <CalendarRange size={22} aria-hidden="true" />
            <b>{horizonDays} hari ke depan</b>
            <span>Rencanakan jadwal main lebih awal</span>
          </div>
        </div>
      </div>

      {/* ---- Lapangan ---- */}
      <section className="shop-band" id="lapangan">
        <div className="shop-wrap">
          <div className="shop-sec-head">
            <span className="shop-eyebrow">Lapangan</span>
            <h2>Pilih lapangan yang paling pas</h2>
            <p>Tarif per jam dan sisa slot hari ini. Ketuk untuk melihat jam yang masih kosong.</p>
          </div>

          {!data ? (
            <p className="shop-note error" role="alert">Daftar lapangan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p>
          ) : courts.length === 0 ? (
            <p className="shop-empty">Belum ada lapangan yang dibuka untuk pemesanan.</p>
          ) : (
            <div className="shop-courts">
              {courts.map((court, index) => {
                const free = freeByCourt.get(court.id) ?? 0;
                const spread = court.rate_min < court.rate_max;
                const floor = floorLabel(floors, court.floor_id);
                return (
                  <article className="shop-court" key={court.id}>
                    <CourtCover name={court.name} photos={court.photos} priority={index === 0} />
                    <div className="shop-court-body">
                      <div className="shop-court-top">
                        <h3>{court.name}</h3>
                        <span className={`shop-free ${free === 0 ? "full" : free <= 3 ? "few" : "open"}`}>
                          {free === 0 ? "Penuh hari ini" : `${free} slot kosong`}
                        </span>
                      </div>
                      {(floor || court.environment || court.surface) && (
                        <div className="shop-tags">
                          {floor && <span className="floor">{floor}</span>}
                          {court.environment && <span className={court.environment}>{environmentLabel[court.environment]}</span>}
                          {court.surface && <span>{court.surface}</span>}
                        </div>
                      )}
                      {court.description && <p className="shop-court-desc">{court.description}</p>}
                      <span className="shop-court-open"><Clock3 size={15} aria-hidden="true" /> Buka {court.opens_at} – {court.closes_at}</span>
                      <div className="shop-court-price">
                        <div>
                          {spread && <small className="from">Mulai</small>}
                          <b>{money(court.rate_min)}</b> <small>/ jam</small>
                        </div>
                        {spread && <small>hingga {money(court.rate_max)}</small>}
                      </div>
                      <Link className="shop-btn outline wide" href={scheduleHref(court.id)}>Lihat jadwal <ArrowRight size={16} aria-hidden="true" /></Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ---- Denah venue ---- */}
      {data && courts.length > 0 && (
        <section className="shop-band tight" aria-labelledby="judul-denah">
          <div className="shop-wrap">
            <div className="shop-sec-head">
              <span className="shop-eyebrow">Denah</span>
              <h2 id="judul-denah">Venue dilihat dari atas</h2>
              <p>Ketuk lapangan pada denah untuk langsung membuka jadwalnya.</p>
            </div>
            <div className="book-map">
              <VenueMapNav date={today} venue={data.venue} floors={data.floors} courts={entries} features={data.features} />
              <div className="venue-map-legend">
                <span><i className="open" />Banyak slot kosong</span>
                <span><i className="few" />Tinggal sedikit</span>
                <span><i className="full" />Penuh</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---- Suasana: hanya bila venue sudah punya foto ---- */}
      {gallery.length >= 2 && (
        <section className="shop-band night tight" aria-labelledby="judul-suasana">
          <div className="shop-wrap">
            <div className="shop-sec-head">
              <span className="shop-eyebrow">Suasana</span>
              <h2 id="judul-suasana">Seperti ini rasanya main di sini</h2>
              <p>Geser untuk melihat lapangan dan sudut lain di venue.</p>
            </div>
            <div className="shop-gallery">
              {gallery.map(item => (
                <figure key={item.photo}>
                  <CourtCover name={item.court} photos={[item.photo]} />
                  <figcaption>{item.court}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---- Fasilitas ---- */}
      {info && facilities > 0 && (
        <section className="shop-band tight" aria-labelledby="judul-fasilitas">
          <div className="shop-wrap">
            <div className="shop-sec-head">
              <span className="shop-eyebrow">Fasilitas</span>
              <h2 id="judul-fasilitas">Yang tersedia di venue</h2>
            </div>
            <ul className="shop-facilities">
              {info.facilities.map(kind => <li key={kind}><FacilityIcon kind={kind} size={20} /> {facilityLabels[kind]}</li>)}
              {info.extra_facilities.map(item => <li key={item}><Check size={20} aria-hidden="true" /> {item}</li>)}
            </ul>
          </div>
        </section>
      )}

      {/* ---- Sewa & tambahan ---- */}
      {venue && venue.addons.length > 0 && (
        <section className="shop-band tight" id="tambahan" aria-labelledby="judul-tambahan">
          <div className="shop-wrap">
            <div className="shop-sec-head">
              <span className="shop-eyebrow">Sewa & tambahan</span>
              <h2 id="judul-tambahan">Tidak membawa raket? Tidak masalah</h2>
              <p>Pilih perlengkapan atau pelatih saat memesan jadwal, dibayar bersama sewa lapangan.</p>
            </div>
            <ShopAddonCatalog items={venue.addons} />
          </div>
        </section>
      )}

      {/* ---- Cara memesan ---- */}
      <section className="shop-band night" aria-labelledby="judul-cara">
        <div className="shop-wrap">
          <div className="shop-sec-head">
            <span className="shop-eyebrow">Cara memesan</span>
            <h2 id="judul-cara">Tiga langkah, tanpa menelepon</h2>
          </div>
          <ol className="shop-steps">
            <li className="shop-step">
              <h3>Pilih tanggal</h3>
              <p>Lihat slot yang masih kosong di semua lapangan sekaligus, lengkap dengan denah venue.</p>
            </li>
            <li className="shop-step">
              <h3>Masukkan ke keranjang</h3>
              <p>Tentukan jam mulai, lama bermain, dan sewa raket atau bola bila perlu. Beberapa sesi boleh masuk satu keranjang.</p>
            </li>
            <li className="shop-step">
              {payOnline ? (
                <>
                  <h3>Bayar sekali</h3>
                  <p>Isi data pemesan, lalu bayar seluruh sesi sekaligus lewat QRIS, virtual account, e-wallet, atau kartu. Slot dikunci selama pembayaran berlangsung.</p>
                </>
              ) : info?.whatsapp ? (
                <>
                  <h3>Kirim ke venue</h3>
                  <p>Kirim isi keranjang lewat WhatsApp dengan satu ketukan, lalu staf mengonfirmasi slotnya.</p>
                </>
              ) : (
                <>
                  <h3>Tunjukkan ke staf</h3>
                  <p>Bawa daftar di keranjang Anda ke resepsionis venue untuk mengamankan slotnya.</p>
                </>
              )}
            </li>
          </ol>
        </div>
      </section>

      {/* ---- Lokasi & kontak ---- */}
      {info && reachable && (
        <section className="shop-band" id="lokasi" aria-labelledby="judul-lokasi">
          <div className="shop-wrap">
            <div className="shop-sec-head">
              <span className="shop-eyebrow">{info.address ? "Lokasi" : "Tentang"}</span>
              <h2 id="judul-lokasi">{info.address ? "Datang dan main di sini" : "Tentang venue"}</h2>
              {info.name && <p>{info.name}</p>}
            </div>
            <div className={`shop-place${showMap ? "" : " single"}`}>
              <div className="shop-place-card">
                {info.about && <RichText text={info.about} />}
                <ul className="shop-contacts">
                  {info.address && <li><MapPin aria-hidden="true" /><div><small>Alamat</small><span>{info.address}</span></div></li>}
                  {info.hours_note && <li><Clock3 aria-hidden="true" /><div><small>Jam buka</small><span>{info.hours_note}</span></div></li>}
                  {info.phone && <li><Phone aria-hidden="true" /><div><small>Telepon</small><a href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}>{info.phone}</a></div></li>}
                  {info.email && <li><Mail aria-hidden="true" /><div><small>Email</small><a href={`mailto:${info.email}`}>{info.email}</a></div></li>}
                  {info.instagram && <li><AtSign aria-hidden="true" /><div><small>Instagram</small><a href={`https://instagram.com/${info.instagram}`} target="_blank" rel="noopener">@{info.instagram}</a></div></li>}
                </ul>
                {(info.whatsapp || info.address) && (
                  <div className="shop-place-actions">
                    {info.whatsapp && (
                      <a className="shop-btn primary" href={whatsappLink(info.whatsapp, `Halo${info.name ? ` ${info.name}` : ""}, saya ingin bertanya tentang booking lapangan.`)} target="_blank" rel="noopener">
                        <MessageCircle size={18} aria-hidden="true" /> Chat WhatsApp
                      </a>
                    )}
                    {info.address && <a className="shop-btn outline" href={mapsLink(info)} target="_blank" rel="noopener"><Navigation size={17} aria-hidden="true" /> Petunjuk arah</a>}
                  </div>
                )}
              </div>
              {showMap && (
                <div className="shop-map-embed">
                  <iframe title={`Peta lokasi ${info.name || "venue"}`} src={mapsEmbed(info.address)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- Sebelum memesan ---- */}
      {policies && (cancellation || faqs.length > 0) && (
        <section className="shop-band tight" aria-labelledby="judul-bantuan">
          <div className="shop-wrap">
            <div className="shop-sec-head">
              <span className="shop-eyebrow">Sebelum memesan</span>
              <h2 id="judul-bantuan">Hal yang biasanya ditanyakan</h2>
            </div>
            <div className={`shop-trust${cancellation && faqs.length ? "" : " single"}`}>
              {cancellation && (
                <article>
                  <header><ShieldCheck size={22} aria-hidden="true" /><h3>Kebijakan pembatalan</h3></header>
                  <RefundTiers policies={policies} />
                  {rescheduleLine(policies) && <p>{rescheduleLine(policies)}</p>}
                  <Link className="shop-tlink" href="/kebijakan#pembatalan">Baca kebijakan lengkap <ArrowRight size={15} aria-hidden="true" /></Link>
                </article>
              )}
              {faqs.length > 0 && (
                <div className="shop-faq-side">
                  <FaqList items={faqs.slice(0, 4)} />
                  {faqs.length > 4 && <Link className="shop-tlink" href="/faq">Lihat semua {faqs.length} pertanyaan <ArrowRight size={15} aria-hidden="true" /></Link>}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- Ajakan penutup ---- */}
      <section className="shop-band night">
        <div className="shop-wrap shop-closing">
          <div>
            <h2>Lapangannya siap. Tinggal jamnya.</h2>
            <p>
              {freeToday > 0
                ? `Masih ada ${freeToday} slot kosong hari ini. Pilih jam Anda sekarang sebelum diambil orang lain.`
                : "Lihat jadwal hari berikutnya dan amankan jam main Anda."}
            </p>
          </div>
          <div className="actions">
            <Link className="shop-btn primary" href="/ketersediaan">Cek ketersediaan <ArrowRight size={18} aria-hidden="true" /></Link>
            {info?.whatsapp && (
              <a className="shop-btn outline" href={whatsappLink(info.whatsapp, `Halo${info.name ? ` ${info.name}` : ""}, saya ingin bertanya tentang booking lapangan.`)} target="_blank" rel="noopener">
                <MessageCircle size={17} aria-hidden="true" /> Tanya dulu
              </a>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
