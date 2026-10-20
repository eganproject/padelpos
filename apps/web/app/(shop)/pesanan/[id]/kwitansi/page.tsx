"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { money } from "@/lib/api";
import { formatDay } from "@/lib/shop";
import { useVenueInfo } from "@/lib/use-venue-info";
import { fetchOrder, methodLabel, payTypeLabel, type OrderView } from "@/lib/payments";
import { taxName } from "@/lib/bill";
import { formatWhatsapp } from "@/lib/venue-info";

const stampFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
const dateFormat = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });

/**
 * Kwitansi atau tagihan yang bisa dicetak dan disimpan sebagai PDF lewat dialog cetak browser.
 * Judulnya mengikuti keadaan: "Kwitansi" bila lunas, "Tagihan" bila masih ada sisa, dan cap
 * "Dibatalkan" untuk pesanan yang batal. Tidak ada data baru di sini: semuanya dari halaman pesanan.
 */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<OrderView | null>(null);
  const [error, setError] = useState("");
  const { data: venue } = useVenueInfo();
  useEffect(() => { fetchOrder(id).then(setData).catch(problem => setError((problem as Error).message)); }, [id]);

  if (error) return <div className="shop-wrap shop-band"><p className="shop-note error" role="alert">{error}</p></div>;
  if (!data) return <div className="shop-wrap shop-band"><div className="skeleton tall" aria-busy="true" aria-label="Memuat kwitansi" /></div>;

  const { order } = data;
  const info = venue?.info;
  const active = order.sessions.filter(session => session.status !== "cancelled" && session.status !== "expired");
  const billed = active.length ? active : order.sessions;
  const total = billed.reduce((sum, session) => sum + session.total, 0);
  const remaining = active.reduce((sum, session) => sum + Math.max(0, session.total - session.paid), 0);
  const void_ = !active.length;
  const settled = !void_ && remaining === 0;
  const title = void_ ? "Pesanan dibatalkan" : settled ? "Kwitansi" : "Tagihan";
  const stamp = void_ ? { label: order.status === "expired" ? "Kedaluwarsa" : "Dibatalkan", tone: "off" } : settled ? { label: "Lunas", tone: "on" } : { label: order.paid > 0 ? "Belum lunas" : "Belum dibayar", tone: "wait" };
  const payments = data.payments ?? [];
  const onlineType = data.payment?.status === "paid" ? payTypeLabel(data.payment.payment_type) : "";

  return (
    <div className="shop-wrap invoice-page">
      <div className="invoice-tools no-print">
        <Link className="shop-btn ghost sm" href={`/pesanan/${order.id}`}><ArrowLeft size={16} aria-hidden="true" /> Kembali ke pesanan</Link>
        <button type="button" className="shop-btn primary sm" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Cetak / simpan PDF</button>
      </div>

      <article className="invoice" aria-label={`${title} ${order.code}`}>
        <header className="invoice-head">
          <div>
            <b className="invoice-venue">{info?.name || "Venue padel"}</b>
            {info?.address && <span>{info.address}</span>}
            <span>{[info?.whatsapp && `WA ${formatWhatsapp(info.whatsapp)}`, info?.phone, info?.email].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="invoice-title">
            <h1>{title}</h1>
            <span className={`invoice-stamp ${stamp.tone}`}>{stamp.label}</span>
          </div>
        </header>

        <dl className="invoice-meta">
          <div><dt>Nomor</dt><dd>{order.code}</dd></div>
          <div><dt>Tanggal pesan</dt><dd>{dateFormat.format(new Date(order.created_at))}</dd></div>
          <div><dt>Atas nama</dt><dd>{order.customer}</dd></div>
          <div><dt>WhatsApp</dt><dd>{order.phone}</dd></div>
        </dl>

        <table className="invoice-lines">
          <thead><tr><th>Rincian</th><th className="num">Jumlah</th></tr></thead>
          <tbody>
            {order.sessions.map(session => {
              const off = session.status === "cancelled" || session.status === "expired";
              return [
                <tr key={session.id} className={`session${off ? " off" : ""}`}>
                  <td>
                    <b>{session.court_name}</b>
                    <span>{formatDay(session.date)} · {session.start_time}–{session.end_time} · kode {session.code}{off ? " · dibatalkan" : ""}</span>
                  </td>
                  <td className="num">{money(session.court_total)}</td>
                </tr>,
                ...session.addons.map((line, index) => (
                  <tr key={`${session.id}-a${index}`} className={`sub${off ? " off" : ""}`}><td>{line.quantity}× {line.name}</td><td className="num">{money(line.subtotal)}</td></tr>
                )),
                ...((session.member_discount ?? 0) > 0 ? [<tr key={`${session.id}-m`} className={`sub${off ? " off" : ""}`}><td>Potongan member {session.member_plan}</td><td className="num">−{money(session.member_discount!)}</td></tr>] : []),
                ...(session.discount > 0 ? [<tr key={`${session.id}-d`} className={`sub${off ? " off" : ""}`}><td>Potongan{session.discount_note ? ` ${session.discount_note}` : ""}</td><td className="num">−{money(session.discount)}</td></tr>] : []),
                ...(session.tax > 0 ? [<tr key={`${session.id}-t`} className={`sub${off ? " off" : ""}`}><td>{taxName(session)}</td><td className="num">{money(session.tax)}</td></tr>] : []),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="total"><td>Total{active.length && active.length < order.sessions.length ? " sesi aktif" : ""}</td><td className="num">{money(total)}</td></tr>
            {payments.map(entry => (
              <tr key={entry.id}>
                <td>{entry.kind === "refund" ? "Dikembalikan" : "Dibayar"} {entry.source === "gateway" ? `online${onlineType ? ` (${onlineType})` : ""}` : `(${methodLabel[entry.method] ?? entry.method})`} · {stampFormat.format(new Date(entry.created_at))}</td>
                <td className="num">{entry.kind === "refund" ? "" : "−"}{money(entry.amount)}</td>
              </tr>
            ))}
            {!payments.length && order.paid > 0 && <tr><td>Sudah dibayar</td><td className="num">−{money(order.paid)}</td></tr>}
            {!void_ && <tr className="due"><td>Sisa tagihan</td><td className="num">{money(remaining)}</td></tr>}
          </tfoot>
        </table>

        <footer className="invoice-foot">
          {void_ ? <p>Pesanan ini tidak ditagih. Bila ada dana yang perlu dikembalikan, venue akan menghubungi Anda.</p>
            : settled ? <p>Terima kasih. Pembayaran sudah kami terima seluruhnya.</p>
              : <p>Sisa tagihan dibayar {order.status === "pending" ? "sebelum batas waktu di halaman pesanan" : "di venue sebelum main"}.</p>}
          <p className="muted">Dokumen ini dibuat otomatis pada {stampFormat.format(new Date())} dan sah tanpa tanda tangan.</p>
        </footer>
      </article>
    </div>
  );
}
