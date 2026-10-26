"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BadgeCheck, CalendarPlus, CalendarX2, CheckCheck, PackageX, Repeat2, Settings2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/** Sama dengan API (apps/api/src/staff-alerts.ts). */
export const staffEvents = ["booking_new", "payment_in", "cancelled", "reschedule", "rental_unreturned", "member"] as const;
export type StaffEvent = typeof staffEvents[number];
export const staffEventLabels: Record<StaffEvent, [string, string]> = {
  booking_new: ["Booking baru", "Pesanan online yang sudah dibayar pelanggan."],
  payment_in: ["Pembayaran masuk", "Pembayaran dan pengembalian dana di kasir, link tagihan yang dibayar, iuran member, dan transaksi kasir lewat Midtrans."],
  cancelled: ["Pembatalan", "Booking yang dibatalkan, termasuk pembayaran yang masuk setelah slot dilepas."],
  reschedule: ["Pindah jadwal", "Pelanggan memindah jadwal booking dari akunnya."],
  rental_unreturned: ["Barang sewa belum kembali", "Raket dan barang sewa lain yang lewat jam kembali, sekali per booking."],
  member: ["Member", "Member yang segera berakhir atau sudah berakhir, dan pendaftar yang menunggu persetujuan."],
};
const eventIcon: Record<StaffEvent, typeof Bell> = {
  booking_new: CalendarPlus, payment_in: Wallet, cancelled: CalendarX2, reschedule: Repeat2, rental_unreturned: PackageX, member: BadgeCheck,
};

type Item = { id: string; event: StaffEvent; title: string; body: string; link: string; tone: "info" | "success" | "warning" | "danger"; read: boolean; created_at: string };
type Inbox = { items: Item[]; unread: number; more: boolean; events: StaffEvent[] };

/** "baru saja", "5 mnt", "3 jam", "kemarin", lalu tanggal. */
function ago(stamp: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(stamp)) / 60000));
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} mnt lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  if (hours < 48) return "kemarin";
  return new Date(stamp).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

const pollMs = 30000;

/**
 * Lonceng notifikasi staf di bilah atas panel admin: jumlah yang belum dibaca diperbarui tiap 30 detik
 * (dan saat tab kembali dibuka), daftarnya dimuat saat lonceng dibuka. Notifikasi baru yang masuk
 * selagi panel terbuka juga muncul sebagai toast.
 */
export function StaffBell({ canConfigure }: { canConfigure: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const known = useRef<number | null>(null);

  const load = useCallback(async (only: "all" | "unread", before?: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "15", ...(only === "unread" ? { unread: "1" } : {}), ...(before ? { before } : {}) });
      const next = await api<Inbox>(`/profile/notifications?${query}`);
      setInbox(current => before && current ? { ...next, items: [...current.items, ...next.items] } : next);
      setUnread(next.unread);
      known.current = next.unread;
    } catch (error) { toast.error((error as Error).message); }
    finally { setLoading(false); }
  }, []);

  /* Hitung yang belum dibaca secara berkala. Kenaikan jumlah memunculkan toast berisi judul terbaru. */
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const { unread: count } = await api<{ unread: number }>("/profile/notifications/unread");
        if (stopped) return;
        const before = known.current;
        known.current = count;
        setUnread(count);
        if (before !== null && count > before) {
          const latest = await api<Inbox>("/profile/notifications?limit=1&unread=1");
          const item = latest.items[0];
          if (item && !stopped) toast(item.title, { description: item.body.split("\n")[0], action: item.link ? { label: "Buka", onClick: () => router.push(item.link) } : undefined });
        }
      } catch { /* sesi habis ditangani kerangka panel */ }
    };
    void check();
    const timer = setInterval(() => void check(), pollMs);
    const visible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [router]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => { if (open) void load(filter); }, [open, filter, load]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function markRead(ids?: string[]) {
    try {
      const { unread: count } = await api<{ unread: number }>("/profile/notifications/read", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) });
      setUnread(count); known.current = count;
      setInbox(current => current && { ...current, unread: count, items: current.items.map(item => !ids || ids.includes(item.id) ? { ...item, read: true } : item) });
    } catch (error) { toast.error((error as Error).message); }
  }
  function openItem(item: Item) {
    if (!item.read) void markRead([item.id]);
    setOpen(false);
    if (item.link) router.push(item.link);
  }

  const items = inbox?.items ?? [];
  const badge = unread > 99 ? "99+" : String(unread);
  return (
    <div className="desk-bell" ref={box}>
      <button type="button" className="desk-icon-btn desk-bell-btn" onClick={() => setOpen(value => !value)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"} data-tip="Notifikasi">
        <Bell />{unread > 0 && <span className="desk-bell-count" aria-hidden="true">{badge}</span>}
      </button>
      {open && <div className="desk-dropdown desk-bell-panel" role="dialog" aria-label="Notifikasi staf">
        <div className="desk-bell-head">
          <b>Notifikasi</b>
          {unread > 0 && <button type="button" className="desk-bell-link" onClick={() => void markRead()}><CheckCheck aria-hidden="true" /> Tandai semua dibaca</button>}
        </div>
        <div className="seg desk-bell-seg" role="tablist" aria-label="Saring notifikasi">
          <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>Semua</button>
          <button type="button" role="tab" aria-selected={filter === "unread"} onClick={() => setFilter("unread")}>Belum dibaca{unread > 0 ? ` (${badge})` : ""}</button>
        </div>
        <ul className="desk-bell-list">
          {items.map(item => {
            const Icon = eventIcon[item.event] ?? Bell;
            return <li key={item.id}>
              <button type="button" className={`desk-bell-item${item.read ? "" : " unread"}`} onClick={() => openItem(item)}>
                <span className={`desk-bell-icon ${item.tone}`} aria-hidden="true"><Icon /></span>
                <span className="desk-bell-text">
                  <b>{item.title}</b>
                  <span>{item.body}</span>
                  <small>{staffEventLabels[item.event]?.[0] ?? "Info"} · {ago(item.created_at)}</small>
                </span>
                {!item.read && <i className="desk-bell-dot" aria-label="Belum dibaca" />}
              </button>
            </li>;
          })}
          {!items.length && <li className="desk-dropdown-empty">{loading ? "Memuat…" : inbox && !inbox.events.length ? "Role Anda tidak menerima notifikasi apa pun." : filter === "unread" ? "Semua notifikasi sudah dibaca." : "Belum ada notifikasi dalam 30 hari terakhir."}</li>}
        </ul>
        {inbox?.more && <button type="button" className="desk-bell-more" disabled={loading} onClick={() => void load(filter, items[items.length - 1]?.created_at)}>{loading ? "Memuat…" : "Muat lebih banyak"}</button>}
        {canConfigure && <Link className="desk-bell-foot" href="/admin/notifications?tab=staf"><Settings2 aria-hidden="true" /> Atur notifikasi per role</Link>}
      </div>}
    </div>
  );
}
