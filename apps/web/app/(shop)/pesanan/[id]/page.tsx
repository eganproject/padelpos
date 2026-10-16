"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, CreditCard, MessageCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { money } from "@/lib/api";
import { formatDay } from "@/lib/shop";
import { useVenueInfo } from "@/lib/use-venue-info";
import { whatsappLink } from "@/lib/venue-info";
import { countdown, fetchOrder, intentLabel, payTypeLabel, refreshOrder, type OrderView } from "@/lib/payments";

const statusCopy: Record<string, { title: string; tone: string; note: string }> = {
  pending: { title: "Menunggu pembayaran", tone: "wait", note: "Selesaikan pembayaran sebelum batas waktu agar slot tidak dilepas." },
  confirmed: { title: "Pesanan dikonfirmasi", tone: "on", note: "Sampai jumpa di venue. Tunjukkan kode pesanan ini saat datang." },
  completed: { title: "Sesi selesai", tone: "done", note: "Terima kasih sudah bermain di venue kami." },
  expired: { title: "Waktu pembayaran habis", tone: "off", note: "Slot sudah dilepas. Silakan pilih jadwal lain." },
  cancelled: { title: "Pesanan dibatalkan", tone: "off", note: "Hubungi venue bila ada dana yang perlu dikembalikan." },
};
const sessionTone: Record<string, string> = { pending: "wait", confirmed: "on", completed: "done", expired: "off", cancelled: "off" };
const sessionLabel: Record<string, string> = { pending: "Menunggu bayar", confirmed: "Dikonfirmasi", completed: "Selesai", expired: "Kedaluwarsa", cancelled: "Dibatalkan" };

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<OrderView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { data: venue } = useVenueInfo();

  const load = useCallback(async () => {
    try { setData(await fetchOrder(id)); setError(""); }
    catch (problem) { setError((problem as Error).message); }
  }, [id]);

  const check = useCallback(async () => {
    setBusy(true);
    try { setData(await refreshOrder(id)); setError(""); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Selama menunggu pembayaran, status ditanyakan berkala ke Midtrans; webhook bisa telat.
  const waiting = data?.payment?.status === "pending" && data.order.status === "pending";
  useEffect(() => {
    if (!waiting) return;
    const poll = window.setInterval(() => void check(), 15000);
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(ticker); };
  }, [waiting, check]);

  const order = data?.order;
  const payment = data?.payment;
  const info = venue?.info;
  const copy = order ? statusCopy[order.status] ?? statusCopy.pending : null;
  // Sesi yang batal atau kedaluwarsa tidak ditagih lagi; dananya (bila ada) dikembalikan venue.
  const active = order ? order.sessions.filter(session => session.status !== "cancelled" && session.status !== "expired") : [];
  const billed = active.length ? active : order?.sessions ?? [];
  const billTotal = billed.reduce((sum, session) => sum + session.total, 0);
  const remaining = active.reduce((sum, session) => sum + Math.max(0, session.total - session.paid), 0);
  const timeLeft = payment && waiting ? countdown(payment.expires_at, now) : "";
  const message = order ? `Halo${info?.name ? ` ${info.name}` : ""}, saya ingin menanyakan pesanan ${order.code}.` : "";

  return (
    <section className="shop-band shop-wrap">
      <div className="order">
        {error && !order && <p className="shop-note error" role="alert">{error} <button type="button" onClick={() => void load()}>Coba lagi</button></p>}
        {!order ? (
          !error && <div className="skeleton" style={{ minHeight: 260 }} aria-busy="true" aria-label="Memuat pesanan" />
        ) : (
          <>
            <header className="order-head">
              <span className={`shop-pill ${copy!.tone}`}>{copy!.title}</span>
              <h1>Pesanan {order.code}</h1>
              <p>{copy!.note}</p>
            </header>

            {waiting && payment && (
              <div className="order-pay">
                <div>
                  <small>Bayar sekarang</small>
                  <b>{money(payment.amount)}</b>
                  {timeLeft ? <span><Clock3 size={14} aria-hidden="true" /> Sisa waktu {timeLeft}</span> : <span>Batas waktu hampir habis</span>}
                </div>
                <div className="actions">
                  {payment.redirect_url && (
                    <a className="shop-btn primary" href={payment.redirect_url}><CreditCard size={18} aria-hidden="true" /> Lanjutkan pembayaran</a>
                  )}
                  <button type="button" className="shop-btn outline" onClick={() => void check()} disabled={busy}>
                    <RefreshCw size={16} className={busy ? "spin" : ""} aria-hidden="true" /> Saya sudah bayar
                  </button>
                </div>
              </div>
            )}

            {order.status === "confirmed" && (
              <p className="order-ok"><CheckCircle2 size={18} aria-hidden="true" /> Pembayaran diterima{payment?.payment_type ? ` lewat ${payTypeLabel(payment.payment_type)}` : ""}.</p>
            )}

            <div className="order-card">
              <h2>{order.sessions.length > 1 ? `${order.sessions.length} sesi dalam pesanan ini` : "Rincian"}</h2>
              <ul className="order-sessions">
                {order.sessions.map(session => (
                  <li key={session.id}>
                    <div className="when">
                      <b>{session.court_name}</b>
                      <span><CalendarDays size={14} aria-hidden="true" /> {formatDay(session.date)}</span>
                      <span><Clock3 size={14} aria-hidden="true" /> {session.start_time} – {session.end_time}</span>
                      {session.addons.length > 0 && (
                        <ul className="lines">
                          {session.addons.map((line, index) => <li key={index}>{line.quantity}× {line.name} · {money(line.subtotal)}</li>)}
                        </ul>
                      )}
                      {session.cancel_reason && <em className="warn"><TriangleAlert size={14} aria-hidden="true" /> {session.cancel_reason}</em>}
                    </div>
                    <div className="cost">
                      <b>{money(session.total)}</b>
                      {order.sessions.length > 1 && <span className={`shop-pill ${sessionTone[session.status] ?? "wait"}`}>{sessionLabel[session.status] ?? session.status}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="order-bill">
                <div className="total"><dt>Total{active.length && active.length < order.sessions.length ? " sesi aktif" : ""}</dt><dd>{money(billTotal)}</dd></div>
                <div><dt>Sudah dibayar</dt><dd>{money(order.paid)}</dd></div>
                {remaining > 0 && (
                  <div className="due"><dt>{order.status === "pending" ? "Belum dibayar" : "Dibayar di venue"}</dt><dd>{money(remaining)}</dd></div>
                )}
              </dl>
              <p className="order-meta">Atas nama {order.customer} · {order.phone}{payment ? ` · ${intentLabel[payment.status]}` : ""}</p>
            </div>

            <div className="order-actions">
              {info?.whatsapp && (
                <a className="shop-btn outline" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener">
                  <MessageCircle size={17} aria-hidden="true" /> Tanya venue
                </a>
              )}
              <Link className="shop-btn outline" href="/ketersediaan">Lihat jadwal lain <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
            {error && <p className="shop-note error" role="alert">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}
