"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, CalendarPlus, CheckCircle2, Clock3, Copy, CreditCard, ExternalLink, Hourglass, Loader2, Lock, MapPin, MessageCircle, PartyPopper, ReceiptText, RefreshCw, Share2, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/api";
import { ShopSteps } from "@/components/shop-steps";
import { formatDay } from "@/lib/shop";
import { useVenueInfo } from "@/lib/use-venue-info";
import { mapsLink, whatsappLink } from "@/lib/venue-info";
import { downloadCalendar } from "@/components/account-bookings";
import { OrderProgress } from "@/components/order-progress";
import { countdown, fetchOrder, intentLabel, methodLabel, payTypeLabel, refreshOrder, type OrderView } from "@/lib/payments";
import { taxName } from "@/lib/bill";
import { loadSnap } from "@/lib/snap";

const statusCopy: Record<string, { title: string; tone: string; note: string; icon: typeof CheckCircle2 }> = {
  pending: { title: "Menunggu pembayaran", tone: "wait", note: "Selesaikan pembayaran sebelum waktu habis agar slot tidak dilepas.", icon: Hourglass },
  confirmed: { title: "Booking terkonfirmasi", tone: "on", note: "Sampai jumpa di lapangan. Tunjukkan kode ini saat datang.", icon: CheckCircle2 },
  completed: { title: "Sesi selesai", tone: "done", note: "Terima kasih sudah bermain. Sampai jumpa lagi!", icon: PartyPopper },
  expired: { title: "Waktu pembayaran habis", tone: "off", note: "Slot sudah dilepas. Silakan pilih jadwal lain.", icon: XCircle },
  cancelled: { title: "Pesanan dibatalkan", tone: "off", note: "Hubungi venue bila ada dana yang perlu dikembalikan.", icon: XCircle },
};
const sessionTone: Record<string, string> = { pending: "wait", confirmed: "on", completed: "done", expired: "off", cancelled: "off" };
const sessionLabel: Record<string, string> = { pending: "Menunggu bayar", confirmed: "Terkonfirmasi", completed: "Selesai", expired: "Kedaluwarsa", cancelled: "Dibatalkan" };

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

  // Selama menunggu pembayaran, status dibaca ulang beberapa detik sekali supaya halaman berubah
  // sendiri begitu lunas. Webhook biasanya sudah memperbarui data; sesekali Midtrans ditanya langsung
  // karena webhook bisa telat.
  const waiting = data?.payment?.status === "pending" && data.order.status === "pending";
  useEffect(() => {
    if (!waiting) return;
    const poll = window.setInterval(() => void load(), 4000);
    const ask = window.setInterval(() => void check(), 15000);
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(ask); window.clearInterval(ticker); };
  }, [waiting, load, check]);

  // Kabar singkat saat status berubah dari menunggu menjadi lunas di halaman ini.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = data?.order.status ?? null;
    if (lastStatus.current === "pending" && status === "confirmed") toast.success("Pembayaran berhasil", { description: "Booking Anda sudah terkonfirmasi." });
    lastStatus.current = status;
  }, [data?.order.status]);

  // Jendela pembayaran Midtrans (Snap) ditanam langsung di halaman ini.
  const token = waiting ? data?.payment?.snap_token ?? "" : "";
  const clientKey = venue?.payment.client_key ?? "";
  const [snapState, setSnapState] = useState<"idle" | "loading" | "open" | "popup" | "failed">("idle");
  const embedded = useRef("");
  useEffect(() => {
    if (!token || !venue) return;
    if (!clientKey) { setSnapState("failed"); return; }
    if (embedded.current === token) return;
    embedded.current = token;
    setSnapState("loading");
    const callbacks = {
      onSuccess: () => void check(),
      onPending: () => void check(),
      onError: () => toast.error("Pembayaran belum berhasil", { description: "Coba metode lain atau ulangi sebentar lagi." }),
    };
    loadSnap(clientKey, venue.payment.environment).then(snap => {
      if (snap.embed) {
        snap.embed(token, { embedId: "snap-bayar", ...callbacks });
        setSnapState("open");
      } else {
        snap.pay(token, { ...callbacks, onClose: () => setSnapState("popup") });
        setSnapState("popup");
      }
    }).catch(() => { embedded.current = ""; setSnapState("failed"); });
  }, [token, clientKey, venue, check]);
  const reopen = () => {
    if (!token || !window.snap) return;
    window.snap.pay(token, { onSuccess: () => void check(), onPending: () => void check(), onClose: () => setSnapState("popup") });
  };

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

  /** Bagikan jadwal ke teman main: lembar bagikan bawaan ponsel, atau salin teks di desktop. */
  async function share() {
    if (!order) return;
    const lines = active.map(session => `• ${session.court_name}, ${formatDay(session.date)} ${session.start_time}–${session.end_time}`);
    const text = [`Main padel${info?.name ? ` di ${info.name}` : ""}:`, ...lines, ...(info?.address ? [info.address] : [])].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: `Jadwal padel ${order.code}`, text });
      else { await navigator.clipboard.writeText(text); toast.success("Jadwal disalin", { description: "Tempel di grup WhatsApp teman main Anda." }); }
    } catch { /* lembar bagikan ditutup */ }
  }

  async function copyCode() {
    if (!order) return;
    try { await navigator.clipboard.writeText(order.code); toast.success("Kode pesanan disalin"); }
    catch { toast.info(`Kode pesanan: ${order.code}`); }
  }

  return (
    <div className="order shop-wrap">
      {error && !order && <p className="shop-note error" role="alert">{error} <button type="button" onClick={() => void load()}>Coba lagi</button></p>}
      {!order || !copy ? (
        !error && <div className="skeleton tall" aria-busy="true" aria-label="Memuat pesanan" />
      ) : (
        <>
          {order.status === "pending" && <ShopSteps current={2} />}
          <section className={`order-hero ${copy.tone}`}>
            <span className="order-hero-icon"><copy.icon size={30} aria-hidden="true" /></span>
            <h1>{copy.title}</h1>
            <p>{copy.note}</p>
            <button type="button" className="order-code" onClick={() => void copyCode()} aria-label={`Salin kode pesanan ${order.code}`}>
              <small>Kode pesanan</small>
              <b>{order.code}</b>
              <Copy size={16} aria-hidden="true" />
            </button>
            <OrderProgress status={order.status} firstSession={active[0] ?? order.sessions[0]} />
          </section>

          {waiting && payment && (
            <section className="card order-pay">
              <div className="order-pay-top">
                <div>
                  <small>Bayar sekarang</small>
                  <b>{money(payment.amount)}</b>
                </div>
                <span className={`timer${timeLeft ? "" : " late"}`}><Clock3 size={16} aria-hidden="true" /> {timeLeft || "Hampir habis"}</span>
              </div>
              {/* Snap mengisi kotak ini sendiri; tingginya ikut isi jendela pembayaran. */}
              <div id="snap-bayar" className={`snap-box${snapState === "open" ? " on" : ""}`} />
              {snapState === "loading" && <p className="snap-wait"><Loader2 size={18} className="spin" aria-hidden="true" /> Menyiapkan pilihan pembayaran…</p>}
              <div className="btn-col">
                {snapState === "popup" && (
                  <button type="button" className="shop-btn primary lg wide" onClick={reopen}><CreditCard size={18} aria-hidden="true" /> Pilih metode pembayaran</button>
                )}
                {snapState === "failed" && payment.redirect_url && (
                  <a className="shop-btn primary lg wide" href={payment.redirect_url}><ExternalLink size={18} aria-hidden="true" /> Buka halaman pembayaran</a>
                )}
                <button type="button" className="shop-btn ghost wide" onClick={() => void check()} disabled={busy}>
                  <RefreshCw size={16} className={busy ? "spin" : ""} aria-hidden="true" /> Sudah bayar? Cek status sekarang
                </button>
              </div>
              <p className="snap-fine"><Lock size={14} aria-hidden="true" /> Diproses aman oleh Midtrans. Halaman ini berubah sendiri begitu pembayaran diterima.</p>
            </section>
          )}

          {order.status === "confirmed" && (
            <>
              <p className="shop-note ok"><CheckCircle2 size={18} aria-hidden="true" /> Pembayaran diterima{payment?.payment_type ? ` lewat ${payTypeLabel(payment.payment_type)}` : ""}.</p>
              <section className="card order-next" aria-labelledby="judul-siap">
                <h2 id="judul-siap" className="card-title">Siap main</h2>
                <div className="order-next-grid">
                  <button type="button" onClick={() => downloadCalendar(active, { name: info?.name ?? "", address: info?.address ?? "" })}>
                    <CalendarPlus size={20} aria-hidden="true" /><b>Simpan ke kalender</b><small>Dengan pengingat 2 jam sebelumnya</small>
                  </button>
                  <button type="button" onClick={() => void share()}>
                    <Share2 size={20} aria-hidden="true" /><b>Ajak teman main</b><small>Bagikan jam dan lokasinya</small>
                  </button>
                  {info?.address && (
                    <a href={mapsLink(info)} target="_blank" rel="noopener">
                      <MapPin size={20} aria-hidden="true" /><b>Petunjuk arah</b><small>{info.address}</small>
                    </a>
                  )}
                  <Link href={`/pesanan/${order.id}/kwitansi`}>
                    <ReceiptText size={20} aria-hidden="true" /><b>Kwitansi</b><small>Cetak atau simpan sebagai PDF</small>
                  </Link>
                </div>
              </section>
            </>
          )}

          <section className="card receipt">
            <h2 className="card-title">{order.sessions.length > 1 ? `${order.sessions.length} sesi` : "Rincian booking"}</h2>
            <ul className="receipt-sessions">
              {order.sessions.map(session => (
                <li key={session.id}>
                  <div className="row">
                    <div>
                      <b>{session.court_name}</b>
                      <span><CalendarDays size={14} aria-hidden="true" /> {formatDay(session.date)}</span>
                      <span><Clock3 size={14} aria-hidden="true" /> {session.start_time} – {session.end_time}</span>
                    </div>
                    <div className="cost">
                      <b>{money(session.total)}</b>
                      {order.sessions.length > 1 && <span className={`pill ${sessionTone[session.status] ?? "wait"}`}>{sessionLabel[session.status] ?? session.status}</span>}
                    </div>
                  </div>
                  {(session.addons.length > 0 || session.discount > 0 || session.tax > 0) && (
                    <ul className="receipt-lines">
                      <li><span>Sewa lapangan</span><span>{money(session.court_total)}</span></li>
                      {session.addons.map((line, index) => <li key={index}><span>{line.quantity}× {line.name}</span><span>{money(line.subtotal)}</span></li>)}
                      {session.discount > 0 && <li><span>Potongan{session.discount_note ? ` ${session.discount_note}` : ""}</span><span>−{money(session.discount)}</span></li>}
                      {session.tax > 0 && <li><span>{taxName(session)}</span><span>{money(session.tax)}</span></li>}
                    </ul>
                  )}
                  {session.cancel_reason && <p className="warn"><TriangleAlert size={14} aria-hidden="true" /> {session.cancel_reason}</p>}
                </li>
              ))}
            </ul>
            <dl className="bill">
              <div className="total"><dt>Total{active.length && active.length < order.sessions.length ? " sesi aktif" : ""}</dt><dd>{money(billTotal)}</dd></div>
              <div><dt>Sudah dibayar</dt><dd>{money(order.paid)}</dd></div>
              {remaining > 0 && (
                <div className={order.status === "pending" ? "due" : "now"}><dt>{order.status === "pending" ? "Belum dibayar" : "Sisa, dibayar di venue"}</dt><dd>{money(remaining)}</dd></div>
              )}
            </dl>
            {!!data?.payments?.length && (
              <ul className="receipt-payments" aria-label="Riwayat pembayaran">
                {data.payments.map(entry => (
                  <li key={entry.id} className={entry.kind}>
                    <span>{entry.kind === "refund" ? "Dikembalikan" : "Dibayar"} · {entry.source === "gateway" ? "online" : methodLabel[entry.method] ?? entry.method}<small>{new Date(entry.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}</small></span>
                    <b>{entry.kind === "refund" ? "−" : ""}{money(entry.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Atas nama {order.customer} · {order.phone}{payment ? ` · ${payment.status === "paid" && order.paid < order.total ? "DP dibayar" : intentLabel[payment.status]}` : ""}</p>
            {order.status !== "confirmed" && order.paid > 0 && (
              <Link className="text-link" href={`/pesanan/${order.id}/kwitansi`}><ReceiptText size={15} aria-hidden="true" /> Lihat kwitansi</Link>
            )}
          </section>

          <div className="btn-row">
            {info?.whatsapp && (
              <a className="shop-btn outline" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener">
                <MessageCircle size={17} aria-hidden="true" /> Tanya venue
              </a>
            )}
            <Link className="shop-btn ghost" href="/ketersediaan">Booking jadwal lain <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          {error && <p className="shop-note error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
