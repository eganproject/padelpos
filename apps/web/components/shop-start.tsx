"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { addDays, formatShortDay } from "@/lib/shop";

/**
 * Langkah pertama pemesanan, di dalam hero. Tanggalnya datang dari server
 * (zona waktu venue) sehingga tombol "Hari ini" tidak pernah meleset satu hari
 * karena jam di perangkat pengunjung berbeda.
 */
export function ShopStart({ today, horizon }: { today: string; horizon: number }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const quick = [0, 1, 2, 3].map(offset => addDays(today, offset));
  const last = addDays(today, horizon);

  return (
    <form
      className="shop-start"
      onSubmit={event => { event.preventDefault(); if (date) router.push(`/ketersediaan?date=${date}`); }}
    >
      <small id="kapan-main">Kapan Anda mau main?</small>
      <div className="shop-days-row" role="group" aria-labelledby="kapan-main">
        {quick.map((value, index) => {
          const [weekday, dayMonth] = formatShortDay(value).split(", ");
          return (
            <button className="shop-day" type="button" key={value} aria-pressed={date === value} onClick={() => setDate(value)}>
              <small>{index === 0 ? "Hari ini" : index === 1 ? "Besok" : weekday}</small>
              <b>{dayMonth}</b>
            </button>
          );
        })}
      </div>
      <label className="shop-start-other">
        Tanggal lain
        <input type="date" value={date} min={today} max={last} onChange={event => setDate(event.target.value)} />
      </label>
      <button className="shop-btn primary wide" type="submit" disabled={!date}>
        Lihat slot kosong <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
