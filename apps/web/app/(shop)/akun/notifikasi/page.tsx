"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  BellOff, CalendarClock, CalendarX2, CheckCheck, CircleCheck, Clock3, CreditCard, Hourglass, Loader2, ReceiptText, RefreshCw, Repeat2, TimerOff,
} from "lucide-react";
import { fetchInbox, markRead, type InboxItem } from "@/lib/account";

/** Ikon per jenis kabar; warnanya mengikuti `tone` dari server. */
const icons: Record<string, typeof CreditCard> = {
  bill: CreditCard, payment_due: Hourglass, confirmed: CircleCheck, expired: TimerOff, receipt: ReceiptText,
  reschedule: Repeat2, cancelled: CalendarX2, reminder: CalendarClock,
};
const dayFormat = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta" });
const timeFormat = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Jakarta" });

function dayLabel(iso: string, now: Date) {
  const key = dayKey.format(new Date(iso));
  if (key === dayKey.format(now)) return "Hari ini";
  if (key === dayKey.format(new Date(now.getTime() - 86400000))) return "Kemarin";
  return dayFormat.format(new Date(iso));
}
/** "5 menit lalu" untuk kabar hari ini, jam untuk yang lebih lama. */
function ago(iso: string, now: Date) {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  if (minutes < 6 * 60) return `${Math.floor(minutes / 60)} jam lalu`;
  return timeFormat.format(new Date(iso));
}

/**
 * Kotak masuk pelanggan: tagihan, kwitansi, pengingat main, dan perubahan jadwal dari venue.
 * Kabar yang dibuka langsung ditandai dibaca; tautan luar (halaman bayar Midtrans) dibuka di tab baru.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const result = await fetchInbox();
      setItems(result.items); setUnread(result.unread); setMore(result.more); setError(""); setNow(new Date());
    } catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!items?.length) return;
    setBusy("lagi");
    try {
      const result = await fetchInbox(items[items.length - 1].created_at);
      setItems([...items, ...result.items.filter(item => !items.some(existing => existing.id === item.id))]); setMore(result.more);
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(""); }
  }
  async function readAll() {
    setBusy("semua");
    try { setUnread(await markRead()); setItems(list => list?.map(item => ({ ...item, read: true })) ?? null); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(""); }
  }
  function open(item: InboxItem) {
    if (!item.read) {
      setItems(list => list?.map(entry => (entry.id === item.id ? { ...entry, read: true } : entry)) ?? null);
      setUnread(count => Math.max(0, count - 1));
      void markRead([item.id]).catch(() => undefined);
    }
    if (!item.link) return;
    if (/^https?:\/\//.test(item.link)) window.open(item.link, "_blank", "noopener");
    else router.push(item.link);
  }

  if (error && !items) return <p className="shop-note error" role="alert">{error} <button type="button" onClick={() => void load()}>Coba lagi</button></p>;
  if (!items) return <div className="skeleton" style={{ minHeight: 320 }} aria-busy="true" aria-label="Memuat notifikasi" />;

  const groups: { label: string; items: InboxItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.created_at, now);
    const group = groups.at(-1);
    if (group?.label === label) group.items.push(item); else groups.push({ label, items: [item] });
  }

  return (
    <div className="acct-inbox">
      <div className="acct-section-head">
        <h2>Notifikasi{unread > 0 ? <span className="acct-inbox-count">{unread} baru</span> : null}</h2>
        <div className="acct-inbox-tools">
          <button type="button" className="shop-icon-btn outline" onClick={() => void load()} disabled={!!busy} aria-label="Muat ulang" data-tip="Muat ulang">
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          {unread > 0 && (
            <button type="button" className="shop-btn outline sm" onClick={() => void readAll()} disabled={!!busy}>
              {busy === "semua" ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <CheckCheck size={15} aria-hidden="true" />} Tandai dibaca
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="acct-inbox-empty">
          <BellOff size={28} aria-hidden="true" />
          <b>Belum ada notifikasi</b>
          <p>Tagihan, bukti pembayaran, pengingat main, dan perubahan jadwal akan muncul di sini.</p>
          <Link className="shop-btn primary sm" href="/ketersediaan">Pesan jadwal</Link>
        </div>
      ) : (
        groups.map(group => (
          <section key={group.label} className="acct-inbox-day" aria-label={group.label}>
            <h3>{group.label}</h3>
            <ul>
              {group.items.map(item => {
                const Icon = icons[item.kind] ?? Clock3;
                return (
                  <li key={item.id}>
                    <button type="button" className={`acct-inbox-item ${item.tone}${item.read ? "" : " unread"}`} onClick={() => open(item)}>
                      <span className="icon" aria-hidden="true"><Icon size={19} /></span>
                      <span className="text">
                        <span className="top"><b>{item.title}</b><time dateTime={item.created_at}>{ago(item.created_at, now)}</time></span>
                        <span className="body">{item.body}</span>
                      </span>
                      {!item.read && <span className="dot" aria-label="Belum dibaca" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {more && (
        <button type="button" className="shop-btn outline wide" onClick={() => void loadMore()} disabled={!!busy}>
          {busy === "lagi" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null} Tampilkan yang lebih lama
        </button>
      )}
      {error && <p className="shop-note error" role="alert">{error}</p>}
      <p className="muted small">Atur kanal email dan WhatsApp di <Link className="text-link" href="/akun/profil#notifikasi">Profil</Link>.</p>
    </div>
  );
}
