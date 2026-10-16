"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarX2, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { claimOrder, fetchHistory, useAccount, type HistoryItem, type Phase } from "@/lib/account";
import { useVenueInfo } from "@/lib/use-venue-info";
import { BookingCard } from "@/components/account-bookings";

const tabs: { key: Phase; label: string; empty: string }[] = [
  { key: "upcoming", label: "Mendatang", empty: "Belum ada jadwal main yang akan datang." },
  { key: "past", label: "Selesai", empty: "Sesi yang sudah dimainkan akan muncul di sini." },
  { key: "cancelled", label: "Dibatalkan", empty: "Tidak ada pesanan yang dibatalkan." },
];

function History() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = tabs.find(item => item.key === params.get("tab"))?.key ?? "upcoming";
  const [data, setData] = useState<{ items: HistoryItem[]; counts: Record<Phase, number> } | null>(null);
  const [error, setError] = useState("");
  const { data: venue } = useVenueInfo();
  const load = useCallback(() => fetchHistory(tab).then(result => { setData(result); setError(""); }).catch(problem => setError((problem as Error).message)), [tab]);
  useEffect(() => { setData(null); void load(); }, [load]);

  const place = { name: venue?.info.name ?? "", address: venue?.info.address ?? "" };
  const active = tabs.find(item => item.key === tab)!;
  return (
    <div className="acct-history">
      <div className="seg acct-filter" role="tablist" aria-label="Saring pesanan">
        {tabs.map(item => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} aria-pressed={tab === item.key}
            onClick={() => router.replace(item.key === "upcoming" ? "/akun/pesanan" : `/akun/pesanan?tab=${item.key}`, { scroll: false })}>
            {item.label}{data ? <span className="count">{data.counts[item.key]}</span> : null}
          </button>
        ))}
      </div>

      {error && <p className="shop-note error" role="alert">{error} <button type="button" onClick={() => void load()}>Coba lagi</button></p>}
      {!data ? (
        !error && <div className="skeleton" style={{ minHeight: 220 }} aria-busy="true" aria-label="Memuat pesanan" />
      ) : data.items.length === 0 ? (
        <div className="acct-empty">
          <CalendarX2 size={28} aria-hidden="true" />
          <p>{active.empty}</p>
          {tab !== "cancelled" && <Link className="shop-btn primary sm" href="/ketersediaan">Cari jadwal <ArrowRight size={16} aria-hidden="true" /></Link>}
        </div>
      ) : (
        <div className="acct-list">{data.items.map(item => <BookingCard key={item.id} item={item} venue={place} />)}</div>
      )}

      <ClaimCard onClaimed={() => { if (tab !== "upcoming") router.replace("/akun/pesanan", { scroll: false }); else void load(); }} />
    </div>
  );
}

/** Pesanan yang dibuat sebelum punya akun, atau dibuatkan kasir, dihubungkan dengan kode + nomor HP. */
function ClaimCard({ onClaimed }: { onClaimed: () => void }) {
  const account = useAccount();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await claimOrder({ code, phone });
      if (result.linked) { toast.success(`${result.linked} sesi ditambahkan ke akun Anda`); setCode(""); onClaimed(); }
      else toast.info("Pesanan itu sudah ada di akun Anda.");
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="acct-claim" id="klaim" aria-labelledby="judul-klaim">
      <div>
        <h2 id="judul-klaim"><Link2 size={18} aria-hidden="true" /> Pesanan lama belum muncul?</h2>
        <p>Pesanan yang dibuat tanpa masuk, atau yang dicatat kasir, bisa dihubungkan ke akun ini. Masukkan kodenya — PDX-XXXXXX di halaman pesanan, atau kode 8 karakter dari pesan venue — beserta nomor HP yang dipakai saat memesan.</p>
      </div>
      <form onSubmit={submit}>
        <label>Kode pesanan
          <input required value={code} maxLength={20} placeholder="PDX-7K2M9Q" autoCapitalize="characters" onChange={event => setCode(event.target.value)} />
        </label>
        <label>Nomor HP saat memesan
          <input required inputMode="tel" value={phone} maxLength={20} placeholder="0812 3456 7890" onChange={event => setPhone(event.target.value)} />
        </label>
        <button className="shop-btn outline" type="submit" disabled={busy || code.trim().length < 6 || phone.replace(/\D/g, "").length < 9}>
          {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Hubungkan
        </button>
      </form>
      {error && <p className="shop-note error" role="alert">{error}</p>}
    </section>
  );
}

export default function HistoryPage() {
  return <Suspense><History /></Suspense>;
}
