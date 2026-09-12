"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Clock3, Sparkles } from "lucide-react";
import { money } from "@/lib/api";
import { addDays, fetchCourts, formatShortDay, venueNow, type ShopCourt } from "@/lib/shop";

export default function ShopLandingPage() {
  const router = useRouter();
  const [courts, setCourts] = useState<ShopCourt[] | null>(null);
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");

  // Tanggal dihitung setelah render agar zona waktu venue tidak bentrok dengan hasil prerender.
  useEffect(() => {
    const now = venueNow();
    setToday(now.date);
    setDate(now.date);
    void fetchCourts().then(setCourts);
  }, []);

  const quickDays = today ? [0, 1, 2].map(offset => addDays(today, offset)) : [];

  return (
    <>
      <section className="shop-hero">
        <span className="shop-eyebrow"><Sparkles size={14} /> BOOKING LAPANGAN PADEL</span>
        <h1>Cari slot kosong, <em>langsung main.</em></h1>
        <p>Lihat ketersediaan lapangan secara langsung, pilih jam yang cocok, dan amankan tempat Anda dalam hitungan menit.</p>

        <form
          className="shop-picker"
          onSubmit={event => { event.preventDefault(); router.push(`/ketersediaan?date=${date}`); }}
        >
          <div className="shop-field">
            <label htmlFor="tanggal">Tanggal main</label>
            <input id="tanggal" type="date" value={date} min={today} onChange={event => setDate(event.target.value)} required />
          </div>
          <div className="shop-quick" role="group" aria-label="Pilihan tanggal cepat">
            {quickDays.map((value, index) => (
              <button type="button" key={value} aria-pressed={date === value} onClick={() => setDate(value)}>
                {index === 0 ? "Hari ini" : index === 1 ? "Besok" : formatShortDay(value)}
              </button>
            ))}
          </div>
          <button className="shop-cta" type="submit" disabled={!date}>
            Cek ketersediaan <ArrowRight size={18} />
          </button>
        </form>
      </section>

      <section className="shop-section">
        <div className="shop-section-head">
          <div>
            <h2>Lapangan kami</h2>
            <p>Tarif dihitung per jam, minimal 30 menit.</p>
          </div>
          <Link className="shop-ghost" href="/ketersediaan">Lihat jadwal</Link>
        </div>
        {!courts ? (
          <p className="shop-empty">Memuat lapangan…</p>
        ) : (
          <div className="shop-courts">
            {courts.map(court => (
              <article className="shop-court-card" key={court.id}>
                <h3>{court.name}</h3>
                <span className="hours"><Clock3 size={15} /> Buka {court.opens_at} – {court.closes_at}</span>
                <span className="price">{money(court.hourly_rate)} <small>/ jam</small></span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="shop-section">
        <div className="shop-section-head">
          <div>
            <h2>Cara memesan</h2>
            <p>Tiga langkah, tanpa perlu menelepon.</p>
          </div>
        </div>
        <div className="shop-steps">
          <article className="shop-step">
            <span>1</span>
            <h3>Pilih tanggal</h3>
            <p>Tentukan hari main Anda, lalu lihat slot yang masih kosong di semua lapangan sekaligus.</p>
          </article>
          <article className="shop-step">
            <span>2</span>
            <h3>Pilih jam dan durasi</h3>
            <p>Ambil jam mulai yang cocok dan tentukan durasi. Total biaya langsung terlihat sebelum Anda lanjut.</p>
          </article>
          <article className="shop-step">
            <span>3</span>
            <h3>Bayar dan selesai</h3>
            <p>Slot ditahan sementara selama Anda menyelesaikan pembayaran, lalu konfirmasi dikirim ke nomor Anda.</p>
          </article>
        </div>
      </section>

      <section className="shop-section" style={{ paddingTop: 0 }}>
        <p className="shop-note">
          <CalendarDays size={16} style={{ verticalAlign: "-3px", marginRight: 8 }} />
          Pembayaran online sedang disiapkan. Untuk sekarang, cek ketersediaan lalu hubungi staf untuk memastikan slot Anda.
        </p>
      </section>
    </>
  );
}
