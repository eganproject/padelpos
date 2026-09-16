"use client";
import { presetRange } from "@/lib/finance";

/** Pemilih periode: pilihan cepat untuk sehari-hari, dua kolom tanggal untuk rentang bebas. */
export function PeriodPicker({ from, to, today, onChange }: { from:string; to:string; today:string; onChange:(range:{from:string;to:string})=>void }) {
  const presets: [string, string][] = [["bulan-ini","Bulan ini"],["bulan-lalu","Bulan lalu"],["30-hari","30 hari terakhir"],["tahun-ini","Tahun ini"]];
  const active = presets.find(([key]) => { const range = presetRange(key, today); return range.from===from && range.to===to })?.[0] ?? "";
  return (
    <div className="fin-period">
      <div className="fin-chips" role="group" aria-label="Pilihan periode">
        {presets.map(([key,label]) => (
          <button key={key} type="button" aria-pressed={active===key} onClick={()=>onChange(presetRange(key,today))}>{label}</button>
        ))}
      </div>
      <div className="fin-dates">
        <label>Dari<input type="date" value={from} max={to} onChange={e=>e.target.value&&onChange({from:e.target.value,to})}/></label>
        <label>Sampai<input type="date" value={to} min={from} onChange={e=>e.target.value&&onChange({from,to:e.target.value})}/></label>
      </div>
    </div>
  );
}

/** Isian rupiah: pengguna mengetik angka, titik ribuan muncul sendiri. */
export function AmountField({ label, value, onChange, hint, autoFocus=false }: { label:string; value:number; onChange:(value:number)=>void; hint?:string; autoFocus?:boolean }) {
  return (
    <label className="fin-field">
      <span className="fin-label">{label}</span>
      <span className="fin-amount">
        <span aria-hidden="true">Rp</span>
        <input inputMode="numeric" autoComplete="off" autoFocus={autoFocus} placeholder="0" aria-label={label}
          value={value ? value.toLocaleString("id-ID") : ""}
          onChange={e=>{ const digits=e.target.value.replace(/\D/g,"").slice(0,12); onChange(digits?Number(digits):0) }}/>
      </span>
      {hint && <small className="fin-hint">{hint}</small>}
    </label>
  );
}

export function StatCard({ label, value, hint, tone="", change }: { label:string; value:string; hint?:string; tone?:string; change?:React.ReactNode }) {
  return (
    <div className={`fin-stat ${tone}`}>
      <span className="fin-stat-label">{label}</span>
      <strong>{value}</strong>
      <div className="fin-stat-foot">{change}{hint && <small>{hint}</small>}</div>
    </div>
  );
}

/** Batang proporsi untuk daftar kategori. */
export function ShareBar({ value, max, tone="" }: { value:number; max:number; tone?:string }) {
  const width = max>0 ? Math.max(2, Math.round(Math.abs(value)/max*100)) : 0;
  return <span className={`fin-share ${tone}`} aria-hidden="true"><i style={{width:`${width}%`}}/></span>;
}

export function Empty({ title, text }: { title:string; text:string }) {
  return <div className="fin-empty"><b>{title}</b><p>{text}</p></div>;
}
