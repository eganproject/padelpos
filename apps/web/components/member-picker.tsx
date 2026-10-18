"use client";
import { useEffect, useState } from "react";
import { BadgeCheck, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { type LookupMember, discountSummary, stateLabel } from "@/lib/members";
import { formatShortDay } from "@/lib/shop";

/**
 * Cari member untuk booking kasir: nama, kode, atau nomor HP. Member yang tidak berlaku pada
 * tanggal main tetap tampil dengan alasannya, tetapi tidak dapat dipilih.
 */
export function MemberPicker({ date, value, onChange, disabled = false }: { date: string; value: LookupMember | null; onChange: (member: LookupMember | null) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(""), [results, setResults] = useState<LookupMember[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    let active = true;
    const timer = setTimeout(() => {
      api<{ members: LookupMember[] }>(`/operations/members/lookup?q=${encodeURIComponent(q)}${date ? "&date=" + date : ""}`)
        .then(result => { if (active) { setResults(result.members); setError(""); } })
        .catch(problem => { if (active) setError((problem as Error).message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, date]);
  // Tanggal main berubah: periksa lagi apakah member terpilih masih berlaku.
  useEffect(() => {
    if (!value || !date) return;
    let active = true;
    api<{ members: LookupMember[] }>(`/operations/members/lookup?q=${encodeURIComponent(value.code)}&date=${date}`)
      .then(result => { const fresh = result.members.find(item => item.id === value.id); if (active && fresh && fresh.valid !== value.valid) onChange(fresh); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [date, value, onChange]);

  if (value) return (
    <div className="booking-account-row member-picked">
      <div><b><BadgeCheck size={14} aria-hidden="true" /> {value.name} · {value.code}</b>
        <small>{value.plan.name} · {discountSummary(value.plan)}{value.ends_on ? ` · berlaku s.d. ${formatShortDay(value.ends_on)}` : ""}</small>
        {!value.valid && <small className="member-invalid">Tidak berlaku pada tanggal main ini ({value.state === "active" ? "di luar masa berlaku" : stateLabel[value.state].toLowerCase()}). Harga normal yang dipakai.</small>}
      </div>
      <button type="button" className="ops-link-button" disabled={disabled} onClick={() => onChange(null)}><X size={13} aria-hidden="true" /> Lepas</button>
    </div>
  );
  return (
    <div className="member-picker">
      <label>Member (opsional)<span className="member-search"><Search size={14} aria-hidden="true" /><input value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder="Cari nama, kode member, atau nomor HP" /></span></label>
      {error && <small className="member-invalid">{error}</small>}
      {results && (results.length ? <ul className="member-results">{results.map(member => (
        <li key={member.id}><button type="button" disabled={!member.valid || disabled} onClick={() => { onChange(member); setQuery(""); setResults(null); }}>
          <span><b>{member.name}</b><small>{member.code} · {member.phone} · {member.plan.name}</small></span>
          <small>{member.valid ? discountSummary(member.plan) : member.state === "active" ? "Di luar masa berlaku" : stateLabel[member.state]}</small>
        </button></li>
      ))}</ul> : <small className="ops-muted">Tidak ada member yang cocok.</small>)}
    </div>
  );
}
