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
    const timer = window.setInterval(() => { setNow(Date.now()); void check(); }, 15000);
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); window.clearInterval(ticker); };
  }, [waiting, check]);

  const order = data?.order;
  const payment = data?.payment;
  const info = venue?.info;
  const copy = order ? statusCopy[order.status] ?? statusCopy.pending : null;
  const remaining = order ? order.total - order.paid : 0;
  const timeLeft = payment && waiting ? countdown(payment.expires_at, now) : "";
  const message = order ? `Halo${info?.name ? ` ${info.name}` : ""}, saya ingin menanyakan pesanan ${order.code} (${order.court_name}, ${formatDay(order.date)} ${order.start_time}–${order.end_time}).` : "";

  return (
    <section className="shop-section shop-order">
      {error && !order && <p className="shop-note error" role="alert">{error} <button type="button" onClick={() => void load()}>Coba lagi</button></p>}
      {!order ? (
        !error && <div className="shop-doc-card skeleton" aria-busy="true" aria-label="Memuat pesanan" />
      ) : (
        <>
          <header className="shop-order-head">
            <span className={`status-pill ${copy!.tone}`}>{copy!.title}</span>
            <h1>Pesanan {order.code}</h1>
            <p>{copy!.note}</p>
          </header>

          {waiting && payment && (
            <div className="shop-order-pay">
              <div>
                <small>Bayar sekarang</small>
                <b>{money(payment.amount)}</b>
                {timeLeft ? <span><Clock3 size={14} aria-hidden="true" /> Sisa waktu {timeLeft}</span> : <span>Batas waktu hampir habis</span>}
              </div>
              <div className="actions">
                {payment.redirect_url && (
                  <a className="shop-cta" href={payment.redirect_url}><CreditCard size={18} aria-hidden="true" /> Lanjutkan pembayaran</a>
                )}
                <button type="button" className="shop-ghost" onClick={() => void check()} disabled={busy}>
                  <RefreshCw size={16} className={busy ? "spin" : ""} aria-hidden="true" /> Saya sudah bayar
                </button>
              </div>
            </div>
          )}

          {order.status === "confirmed" && (
            <p className="shop-order-confirmed"><CheckCircle2 size={18} aria-hidden="true" /> Pembayaran diterima{payment?.payment_type ? ` lewat ${payTypeLabel(payment.payment_type)}` : ""}.</p>
          )}
          {order.status === "cancelled" && order.cancel_reason && (
            <p className="shop-note error"><TriangleAlert size={16} aria-hidden="true" /> {order.cancel_reason}</p>
          )}

          <div className="shop-doc-card">
            <h2>Rincian</h2>
            <ul className="shop-order-facts">
              <li><CalendarDays size={18} aria-hidden="true" /><div><small>Jadwal</small><span>{formatDay(order.date)} · {order.start_time} – {order.end_time}</span></div></li>
              <li><Clock3 size={18} aria-hidden="true" /><div><small>Lapangan</small><span>{order.court_name}</span></div></li>
            </ul>
            <dl className="shop-order-bill">
              <div><dt>Sewa lapangan</dt><dd>{money(order.court_total)}</dd></div>
              {order.addons.map(line => <div key={line.name}><dt>{line.quantity}× {line.name}</dt><dd>{money(line.subtotal)}</dd></div>)}
              <div className="total"><dt>Total</dt><dd>{money(order.total)}</dd></div>
              <div><dt>Sudah dibayar</dt><dd>{money(order.paid)}</dd></div>
              {remaining > 0 && order.status !== "expired" && <div className="due"><dt>{order.paid > 0 ? "Dibayar di venue" : "Belum dibayar"}</dt><dd>{money(remaining)}</dd></div>}
            </dl>
            <p className="shop-order-meta">Atas nama {order.customer} · {order.phone}{payment ? ` · ${intentLabel[payment.status]}` : ""}</p>
          </div>

          <div className="shop-order-actions">
            {info?.whatsapp && (
              <a className="shop-ghost" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener">
                <MessageCircle size={17} aria-hidden="true" /> Tanya venue
              </a>
            )}
            <Link className="shop-ghost" href="/ketersediaan">Lihat jadwal lain <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          {error && <p className="shop-note error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
