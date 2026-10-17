"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarPlus, CreditCard, Flame, Hourglass, MapPin, MessageCircle, RotateCcw, Timer, Trophy } from "lucide-react";
import { money } from "@/lib/api";
import { fetchOverview, type Overview } from "@/lib/account";
import { useVenueInfo } from "@/lib/use-venue-info";
import { whatsappLink } from "@/lib/venue-info";
import { countdown } from "@/lib/payments";
import { BookingCard, downloadCalendar, formatFull, rebookHref, relativeDay, statusOf } from "@/components/account-bookings";

const hoursLabel = (hours: number) => `${hours.toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;

export default function AccountHome() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const { data: venue } = useVenueInfo();
  const load = useCallback(() => fetchOverview().then(result => { setData(result); setError(""); }).catch(problem => setError((problem as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  // Hitung mundur batas bayar berjalan hanya selama ada pesanan yang menunggu.
  useEffect(() => {
    if (!data?.awaiting.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data]);

  if (error && !data) return <p className="shop-note error" role="alert">{error} <button type="button" onClick={() => void load()}>Coba lagi</button></p>;
  if (!data) return <div className="skeleton" style={{ minHeight: 320 }} aria-busy="true" aria-label="Memuat ringkasan" />;

  const place = { name: venue?.info.name ?? "", address: venue?.info.address ?? "" };
  const next = data.next;
  const others = data.upcoming.filter(item => item.id !== next?.id).slice(0, 3);
  const { stats } = data;

  return (
    <div className="acct-home">
      {data.awaiting.map(order => {
        const left = countdown(order.expires_at, now);
        return (
          <Link key={order.order_id} className="acct-alert" href={`/pesanan/${order.order_id}`}>
            <CreditCard size={20} aria-hidden="true" />
            <span>
              <b>Pesanan {order.order_code} menunggu pembayaran</b>
              {money(order.amount)} · {order.sessions} sesi · {left ? `sisa waktu ${left}` : "batas waktu hampir habis"}
            </span>
            <em>Bayar sekarang <ArrowRight size={15} aria-hidden="true" /></em>
          </Link>
        );
      })}

      {next ? (
        <article className="acct-next">
          <div className="acct-next-top">
            <span className="acct-next-label"><Timer size={15} aria-hidden="true" /> Jadwal berikutnya</span>
            <span className={`pill ${statusOf(next).tone}`}>{statusOf(next).label}</span>
          </div>
          <h2>{relativeDay(next.date)}, {next.start_time}</h2>
          <p className="acct-next-meta">{formatFull(next.date)} · {next.start_time}–{next.end_time}</p>
          <p className="acct-next-court"><MapPin size={16} aria-hidden="true" /> {next.court_name}{place.name ? ` · ${place.name}` : ""}</p>
          {next.addons.length > 0 && <p className="acct-next-meta">Termasuk {next.addons.map(line => `${line.quantity}× ${line.name}`).join(", ")}</p>}
          <div className="acct-next-actions">
            {next.status === "confirmed" && (
              <button type="button" className="shop-btn primary sm" onClick={() => downloadCalendar(next, place)}>
                <CalendarPlus size={16} aria-hidden="true" /> Tambah ke kalender
              </button>
            )}
            {next.order_id && <Link className="shop-btn outline sm" href={`/pesanan/${next.order_id}`}>Lihat pesanan</Link>}
            {next.reschedule?.allowed && <Link className="shop-btn outline sm" href="/akun/pesanan">Ubah jadwal</Link>}
            {venue?.info.whatsapp && (
              <a className="shop-btn outline sm" target="_blank" rel="noopener"
                href={whatsappLink(venue.info.whatsapp, `Halo, saya ${data.account.name}. Saya ingin menanyakan jadwal ${next.court_name} ${formatFull(next.date)} pukul ${next.start_time}.`)}>
                <MessageCircle size={16} aria-hidden="true" /> Tanya venue
              </a>
            )}
          </div>
          {next.total > next.paid && next.status === "confirmed" && <p className="acct-next-due">Sisa {money(next.total - next.paid)} dibayar di venue.</p>}
        </article>
      ) : (
        <article className="acct-next empty">
          <span className="acct-next-label"><Timer size={15} aria-hidden="true" /> Jadwal berikutnya</span>
          <h2>Belum ada jadwal main</h2>
          <p className="acct-next-meta">Pilih jam kosong dan pesan dalam satu menit. Pesanan yang dibuat saat Anda masuk otomatis tersimpan di sini.</p>
          <div className="acct-next-actions">
            <Link className="shop-btn primary sm" href="/ketersediaan">Cari jadwal <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link className="shop-btn outline sm" href="/akun/pesanan#klaim">Hubungkan pesanan lama</Link>
          </div>
        </article>
      )}

      <dl className="acct-stats">
        <div><dt><Trophy size={18} aria-hidden="true" /> Sesi dimainkan</dt><dd>{stats.sessions}</dd></div>
        <div><dt><Hourglass size={18} aria-hidden="true" /> Waktu di lapangan</dt><dd>{hoursLabel(stats.hours)}</dd></div>
        <div><dt><Flame size={18} aria-hidden="true" /> Bulan ini</dt><dd>{stats.this_month} sesi</dd></div>
        <div>
          <dt><MapPin size={18} aria-hidden="true" /> Lapangan favorit</dt>
          <dd className="text">{stats.favorite ? stats.favorite.name : "—"}</dd>
          {stats.favorite && <Link className="text-link" href={rebookHref({ court_id: stats.favorite.id })}>Pesan lagi <ArrowRight size={14} aria-hidden="true" /></Link>}
        </div>
      </dl>

      {others.length > 0 && (
        <section className="acct-section" aria-labelledby="judul-mendatang">
          <div className="acct-section-head">
            <h2 id="judul-mendatang">Jadwal lain yang akan datang</h2>
            {data.upcoming_count > others.length + 1 && <Link className="text-link" href="/akun/pesanan">Semua {data.upcoming_count} jadwal <ArrowRight size={14} aria-hidden="true" /></Link>}
          </div>
          <div className="acct-list">{others.map(item => <BookingCard key={item.id} item={item} venue={place} onChanged={() => void load()} />)}</div>
        </section>
      )}

      {data.recent.length > 0 && (
        <section className="acct-section" aria-labelledby="judul-terakhir">
          <div className="acct-section-head">
            <h2 id="judul-terakhir">Terakhir dimainkan</h2>
            <Link className="text-link" href="/akun/pesanan?tab=past">Riwayat lengkap <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          <ul className="acct-recent">
            {data.recent.map(item => (
              <li key={item.id}>
                <div><b>{item.court_name}</b><span>{formatFull(item.date)} · {item.start_time}–{item.end_time}</span></div>
                <Link className="shop-btn outline sm" href={rebookHref(item)}><RotateCcw size={15} aria-hidden="true" /> Pesan lagi</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
