"use client";
import { useEffect, useRef, useState } from "react";
import { TicketPercent, X } from "lucide-react";
import { money } from "@/lib/api";
import { checkVoucher, type VoucherCheck } from "@/lib/vouchers";

/**
 * Isian kode voucher untuk formulir kasir (booking baru dan transaksi kasir). Potongannya diperiksa
 * server dari angka belanja saat ini dan diperiksa ulang bila belanjanya berubah; server tetap
 * menghitung ulang saat transaksi disimpan, jadi angka di sini hanya pratinjau.
 */
export function VoucherField({ court = 0, extras, subtotal, cap, phone, value, onChange, disabled }: {
  court?: number; extras: number; subtotal: number; cap: number; phone: string;
  value: VoucherCheck | null; onChange: (value: VoucherCheck | null) => void; disabled?: boolean;
}) {
  const [input, setInput] = useState(value?.code ?? "");
  const [code, setCode] = useState(value?.code ?? "");
  const [busy, setBusy] = useState(false);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!code) { latest.current(null); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      checkVoucher({ code, court, extras, subtotal, cap, phone })
        .then(result => { if (active) latest.current(result); })
        .catch(error => { if (active) latest.current({ ok: false, code, name: "", summary: "", amount: 0, message: (error as Error).message }); })
        .finally(() => { if (active) setBusy(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [code, court, extras, subtotal, cap, phone]);

  const apply = () => { const next = input.trim().toUpperCase(); if (next) setCode(next); };
  if (code && value?.ok) return (
    <div className="ops-card-head voucher-applied-row">
      <span className="ops-muted"><TicketPercent size={14} aria-hidden="true" /> Voucher <b className="voucher-code">{value.code}</b> · {value.name} · −{money(value.amount)}</span>
      <button type="button" className="ops-link-button" disabled={disabled} onClick={() => { setCode(""); setInput(""); }}><X size={13} aria-hidden="true" /> Lepas</button>
    </div>
  );
  return (
    <div>
      <div className="voucher-line">
        <label>Kode voucher (opsional)<input value={input} maxLength={32} autoComplete="off" spellCheck={false} disabled={disabled} placeholder="Mis. MAINPAGI"
          onChange={event => setInput(event.target.value.toUpperCase().replace(/\s+/g, ""))}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} /></label>
        <button type="button" className="ops-secondary" disabled={disabled || busy || !input.trim()} onClick={apply}>{busy ? "Memeriksa…" : "Pakai"}</button>
      </div>
      {code && value && !value.ok && <p className="voucher-note bad" role="alert">{value.message}</p>}
    </div>
  );
}
