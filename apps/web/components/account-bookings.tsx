"use client";

import Link from "next/link";
import { ArrowRight, CalendarPlus, Clock3, RotateCcw, TriangleAlert } from "lucide-react";
import { money } from "@/lib/api";
import { calendarFile, type HistoryItem } from "@/lib/account";
import { venueNow } from "@/lib/shop";

const monthShort = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const at = (date: string) => new Date(date + "T12:00:00Z");
export const formatFull = (date: string) => fullDate.format(at(date));

/** "Hari ini", "Besok", "3 hari lagi", "Sabtu depan" — seperti orang menyebut jadwal. */
export function relativeDay(date: string) {
  const today = venueNow().date;
  const days = Math.round((at(date).getTime() - at(today).getTime()) / 86400000);
  if (days === 0) return "Hari ini";
  if (days === 1) return "Besok";
  if (days === 2) return "Lusa";
  if (days > 2 && days < 7) return `${days} hari lagi`;
  if (days >= 7 && days < 14) return `${weekday.format(at(date))} depan`;
  if (days < 0 && days > -7) return `${-days} hari lalu`;
  return formatFull(date);
}

/** Label dan warna status dari sudut pandang pelanggan. */
export function statusOf(item: Pick<HistoryItem, "status" | "phase">) {
  if (item.status === "cancelled") return { label: "Dibatalkan", tone: "off" };
  if (item.status === "expired") return { label: "Kedaluwarsa", tone: "off" };
  if (item.status === "pending") return { label: "Menunggu bayar", tone: "wait" };
  if (item.phase === "past") return { label: "Selesai", tone: "done" };
  return { label: "Terkonfirmasi", tone: "on" };
}

export function downloadCalendar(item: HistoryItem, venue: { name: string; address: string }) {
  const url = URL.createObjectURL(calendarFile(item, venue));
  const link = document.createElement("a");
  link.href = url;
  link.download = `padel-${item.date}-${item.start_time.replace(":", "")}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const rebookHref = (item: Pick<HistoryItem, "court_id">) => `/ketersediaan#lapangan-${encodeURIComponent(item.court_id)}`;

/** Satu sesi di riwayat: tanggal besar di kiri, rincian dan tindakan di kanan. */
export function BookingCard({ item, venue }: { item: HistoryItem; venue: { name: string; address: string } }) {
  const status = statusOf(item);
  const [day, month] = [at(item.date).getUTCDate(), monthShort.format(at(item.date))];
  const due = item.total - item.paid;
  const live = item.phase === "upcoming" && item.status === "confirmed";
  return (
    <article className={`acct-booking ${item.phase}`}>
      <div className="acct-date" aria-hidden="true"><b>{day}</b><small>{month}</small></div>
      <div className="acct-booking-body">
        <header>
          <div>
            <h3>{item.court_name}</h3>
            <p><Clock3 size={14} aria-hidden="true" /> {relativeDay(item.date)} · {item.start_time}–{item.end_time}</p>
          </div>
          <span className={`shop-pill ${status.tone}`}>{status.label}</span>
        </header>
        {item.addons.length > 0 && (
          <ul className="acct-lines">{item.addons.map(line => <li key={line.name}>{line.quantity}× {line.name}</li>)}</ul>
        )}
        {item.cancel_reason && <p className="acct-warn"><TriangleAlert size={14} aria-hidden="true" /> {item.cancel_reason}</p>}
        <footer>
          <div className="acct-money">
            <b>{money(item.total)}</b>
            <small>
              {item.status === "cancelled" || item.status === "expired" ? `Kode ${item.order_code ?? item.code}`
                : due > 0 ? `${item.paid > 0 ? `Dibayar ${money(item.paid)} · ` : ""}sisa ${money(due)} di venue` : "Lunas"}
            </small>
          </div>
          <div className="acct-actions">
            {live && (
              <button type="button" className="shop-btn outline sm" onClick={() => downloadCalendar(item, venue)}>
                <CalendarPlus size={16} aria-hidden="true" /> Kalender
              </button>
            )}
            {item.phase !== "upcoming" && (
              <Link className="shop-btn outline sm" href={rebookHref(item)}><RotateCcw size={15} aria-hidden="true" /> Pesan lagi</Link>
            )}
            {item.order_id && (
              <Link className="shop-btn outline sm" href={`/pesanan/${item.order_id}`}>
                {item.status === "pending" ? "Bayar" : "Detail"} <ArrowRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        </footer>
      </div>
    </article>
  );
}
