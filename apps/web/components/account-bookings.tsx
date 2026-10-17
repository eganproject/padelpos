"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock, CalendarPlus, Clock3, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { calendarFile, rescheduleBooking, type HistoryItem } from "@/lib/account";
import { venueNow, type Availability } from "@/lib/shop";

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

export function downloadCalendar(item: Parameters<typeof calendarFile>[0], venue: { name: string; address: string }) {
  const url = URL.createObjectURL(calendarFile(item, venue));
  const link = document.createElement("a");
  link.href = url;
  const first = Array.isArray(item) ? item[0] : item;
  link.download = `padel-${first.date}-${first.start_time.replace(":", "")}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const rebookHref = (item: Pick<HistoryItem, "court_id">) => `/ketersediaan#lapangan-${encodeURIComponent(item.court_id)}`;

/** Satu sesi di riwayat: tanggal besar di kiri, rincian dan tindakan di kanan. */
export function BookingCard({ item, venue, onChanged }: { item: HistoryItem; venue: { name: string; address: string }; onChanged?: () => void }) {
  const status = statusOf(item);
  const [moving, setMoving] = useState(false);
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
          <span className={`pill ${status.tone}`}>{status.label}</span>
        </header>
        {item.addons.length > 0 && (
          <ul className="acct-lines">{item.addons.map((line, index) => <li key={index}>{line.quantity}× {line.name}</li>)}</ul>
        )}
        {moving && <MoveForm item={item} close={() => setMoving(false)} done={() => { setMoving(false); onChanged?.(); }} />}
        {item.cancel_reason && <p className="acct-warn"><TriangleAlert size={14} aria-hidden="true" /> {item.cancel_reason}</p>}
        <footer>
          <div className="acct-money">
            <b>{money(item.total)}</b>
            <small>
              {item.status === "cancelled" || item.status === "expired" ? `Kode ${item.order_code ?? item.code}`
                : item.status === "pending" ? "Menunggu pembayaran online"
                : due > 0 ? `${item.paid > 0 ? `Dibayar ${money(item.paid)} · ` : ""}sisa ${money(due)} di venue` : "Lunas"}
            </small>
          </div>
          <div className="acct-actions">
            {live && item.reschedule?.allowed && !moving && (
              <button type="button" className="shop-btn outline sm" onClick={() => setMoving(true)}>
                <CalendarClock size={16} aria-hidden="true" /> Ubah jadwal
              </button>
            )}
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

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const label = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const shortDate = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** Pilihan tanggal: hari ini sampai 30 hari ke depan, sama dengan jendela jadwal publik yang wajar dipindah. */
function nextDays(today: string, count = 31) {
  return Array.from({ length: count }, (_, index) => { const value = at(today); value.setUTCDate(value.getUTCDate() + index); return value.toISOString().slice(0, 10); });
}

/**
 * Pindah jadwal oleh pelanggan: durasi tetap sama, lapangan boleh diganti. Jam yang ditawarkan hanya
 * yang seluruh slotnya kosong; slot milik booking ini sendiri dihitung kosong. Server memeriksa ulang
 * semuanya, termasuk batas waktu dan stok raket sewa.
 */
function MoveForm({ item, close, done }: { item: HistoryItem; close: () => void; done: () => void }) {
  const duration = minutesOf(item.end_time) - minutesOf(item.start_time);
  const [date, setDate] = useState(item.date), [courtId, setCourtId] = useState(item.court_id), [start, setStart] = useState("");
  const [data, setData] = useState<Availability | null>(null), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setStart("");
    api<Availability>(`/public/availability?date=${date}`).then(result => { if (active) { setData(result); setError(""); } }).catch(problem => { if (active) setError((problem as Error).message); });
    return () => { active = false; };
  }, [date]);
  const entry = data?.courts.find(court => court.court.id === courtId);
  const own = (slot: { start: string }) => date === item.date && courtId === item.court_id && slot.start >= item.start_time && slot.start < item.end_time;
  const starts = entry ? entry.slots.filter((slot, index) => {
    const needed = entry.slots.slice(index, index + duration / 30);
    return needed.length === duration / 30 && needed.every(part => part.state === "available" || own(part)) && !(own(slot) && slot.start === item.start_time);
  }).map(slot => slot.start) : [];
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!start) return;
    setSaving(true); setError("");
    try {
      await rescheduleBooking(item.id, { court_id: courtId, date, start_time: start, end_time: label(minutesOf(start) + duration) });
      toast.success("Jadwal berhasil dipindah.");
      done();
    } catch (problem) { setError((problem as Error).message); } finally { setSaving(false); }
  }
  return (
    <form className="acct-form acct-move" onSubmit={save}>
      <p className="acct-fine">{item.reschedule?.reason} Durasi tetap {(duration / 60).toLocaleString("id-ID")} jam; harga mengikuti tarif jam baru.</p>
      <div className="acct-move-row">
        <label>Tanggal
          <select value={date} onChange={event => setDate(event.target.value)}>
            {nextDays(data?.today ?? venueNow().date).map(value => <option key={value} value={value}>{shortDate.format(at(value))}</option>)}
          </select>
        </label>
        <label>Lapangan
          <select value={courtId} onChange={event => { setCourtId(event.target.value); setStart(""); }}>
            {(data?.courts ?? []).map(court => <option key={court.court.id} value={court.court.id}>{court.court.name}</option>)}
            {!data && <option value={item.court_id}>{item.court_name}</option>}
          </select>
        </label>
        <label>Jam mulai
          <select value={start} required disabled={!data || !starts.length} onChange={event => setStart(event.target.value)}>
            <option value="" disabled>{!data ? "Memuat…" : starts.length ? "Pilih jam" : "Tidak ada jam kosong"}</option>
            {starts.map(value => <option key={value} value={value}>{value}–{label(minutesOf(value) + duration)}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="shop-note error" role="alert">{error}</p>}
      <div className="acct-actions">
        <button type="button" className="shop-btn outline sm" onClick={close} disabled={saving}>Batal</button>
        <button type="submit" className="shop-btn primary sm" disabled={!start || saving}>{saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null} Pindahkan</button>
      </div>
    </form>
  );
}
