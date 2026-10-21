"use client";
import { useEffect, useId, useState } from "react";
import AsyncCreatableSelect from "react-select/async-creatable";
import { api } from "@/lib/api";
import { type CustomerHit, bookingLabel } from "@/lib/counter";
import { formatShortDay } from "@/lib/shop";

/** Pelanggan terpilih di formulir kasir. `customer_id` kosong berarti nama baru atau riwayat tanpa akun pelanggan. */
export type CustomerChoice = CustomerHit & { isNew?: boolean };
type Option = { value: string; hit: CustomerChoice; __isNew__?: boolean; label: string };

const keyOf = (hit: CustomerHit) => hit.customer_id ?? `${hit.name}|${hit.phone}`;
const toOption = (hit: CustomerChoice): Option => ({ value: keyOf(hit), label: hit.name, hit });
const visitText = (hit: CustomerHit) => hit.visits > 0 ? `${hit.visits}× datang${hit.last_visit ? ` · terakhir ${formatShortDay(hit.last_visit)}` : ""}` : "";

/**
 * Pilih pelanggan dari riwayat (pelanggan terdaftar, booking, dan transaksi kasir sebelumnya),
 * atau ketik nama baru lalu pilih "Tambah pelanggan baru". Tanpa ketikan, daftar berisi pemesan
 * lapangan hari ini dan pelanggan yang baru datang.
 */
export function CustomerSelect({ value, onChange, required, placeholder }: { value: CustomerChoice | null; onChange: (value: CustomerChoice | null) => void; required?: boolean; placeholder?: string }) {
  const instanceId = useId();
  const [portal, setPortal] = useState<HTMLElement | null>(null), [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setPortal(document.body), []);
  async function load(query: string) {
    const result = await api<{ customers: CustomerHit[] }>(`/operations/counter/customers?q=${encodeURIComponent(query.trim())}`);
    return result.customers.map(toOption);
  }
  return (
    <AsyncCreatableSelect<Option, false>
      instanceId={instanceId}
      unstyled
      className="rs customer-select"
      classNamePrefix="rs"
      cacheOptions
      defaultOptions
      loadOptions={load}
      value={value ? toOption(value) : null}
      isClearable
      required={required}
      placeholder={placeholder ?? "Cari nama atau nomor HP, atau ketik nama baru"}
      onChange={option => onChange(option ? option.hit : null)}
      onCreateOption={name => onChange({ customer_id: null, name: name.trim().slice(0, 80), phone: "", visits: 0, last_visit: "", booking: null, isNew: true })}
      isValidNewOption={(input, _value, options) => input.trim().length >= 2 && !options.some(option => "hit" in option && option.hit.name.trim().toLowerCase() === input.trim().toLowerCase())}
      getNewOptionData={input => ({ value: `baru:${input}`, label: `+ Tambah pelanggan baru “${input.trim()}”`, hit: { customer_id: null, name: input.trim(), phone: "", visits: 0, last_visit: "", booking: null, isNew: true }, __isNew__: true })}
      formatOptionLabel={(option, meta) => {
        if (option.__isNew__) return <span className="customer-option-new">{option.label}</span>;
        const hit = option.hit;
        if (meta.context === "value") return <span className="customer-value">{hit.name}{hit.phone ? <small> · {hit.phone}</small> : null}{hit.isNew ? <small> · baru</small> : null}</span>;
        return <span className="customer-option">
          <b>{hit.name}</b>
          <small>{[hit.phone, visitText(hit)].filter(Boolean).join(" · ") || "Belum ada nomor telepon"}</small>
          {hit.booking && <em>Booking hari ini · {bookingLabel(hit.booking)}</em>}
        </span>;
      }}
      noOptionsMessage={({ inputValue }) => inputValue.trim().length < 2 ? "Ketik minimal 2 huruf" : "Tidak ada riwayat"}
      loadingMessage={() => "Mencari…"}
      onMenuOpen={() => setMenuOpen(true)}
      onMenuClose={() => setMenuOpen(false)}
      /* Esc saat daftar terbuka cukup menutup daftar, bukan dialog di belakangnya. */
      onKeyDown={event => { if (event.key === "Escape" && menuOpen) event.nativeEvent.stopImmediatePropagation(); }}
      menuPortalTarget={portal}
      menuPosition="fixed"
      menuPlacement="auto"
      menuShouldBlockScroll={false}
      maxMenuHeight={300}
      classNames={{ menuPortal: () => "rs-portal" }}
    />
  );
}
