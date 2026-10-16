"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import { addDays, formatShortDay } from "@/lib/shop";
import { DateInput } from "./form-controls";

/**
 * Langkah pertama pemesanan, di dalam hero. Tanggalnya datang dari server
 * (zona waktu venue) sehingga tombol "Hari ini" tidak pernah meleset satu hari
 * karena jam di perangkat pengunjung berbeda.
 */
export function ShopStart({ today, horizon }: { today: string; horizon: number }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const quick = Array.from({ length: 7 }, (_, offset) => addDays(today, offset));
  const last = addDays(today, horizon);
  const custom = !quick.includes(date);

  return (
    <form className="start-card" onSubmit={event => { event.preventDefault(); if (date) router.push(`/ketersediaan?date=${date}`); }}>
      <p className="start-title" id="kapan-main">Mau main kapan?</p>
      <div className="date-chips" role="group" aria-labelledby="kapan-main">
        {quick.map((value, index) => {
          const [weekday, dayMonth] = formatShortDay(value).split(", ");
          return (
            <button className="date-chip" type="button" key={value} aria-pressed={date === value} onClick={() => setDate(value)}>
              <small>{index === 0 ? "Hari ini" : index === 1 ? "Besok" : weekday}</small>
              <b>{dayMonth}</b>
            </button>
          );
        })}
        <label className={`date-chip other${custom ? " on" : ""}`}>
          <CalendarDays size={18} aria-hidden="true" />
          <small>{custom ? formatShortDay(date) : "Lainnya"}</small>
          <DateInput theme="shop" bare aria-label="Pilih tanggal lain" value={date} min={today} max={last} onChange={event => event.target.value && setDate(event.target.value)} />
        </label>
      </div>
      <button className="shop-btn primary lg wide" type="submit" disabled={!date}>
        Lihat jam kosong <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
