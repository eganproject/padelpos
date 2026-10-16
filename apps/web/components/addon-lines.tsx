"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { money } from "@/lib/api";
import { type AddonOption, type AddonPricing, type BookingAddon, availabilityNote, lineTotal, maxFor, typeLabel, unitLabel } from "@/lib/addons";
import { AddonThumb } from "./addon-icon";
import { QtyStepper } from "./qty-stepper";
import { MoneyInput } from "./form-controls";

/** Baris tambahan yang sedang disusun. `id` hanya ada untuk baris yang sudah tersimpan. */
export type Draft = {
  key: string; id?: string; initial: number; addon_id: string | null; name: string;
  type: BookingAddon["type"]; pricing: AddonPricing; unit_price: number; quantity: number;
};
export const draftsFrom = (lines: BookingAddon[]): Draft[] => lines.map(line => ({
  key: line.id, id: line.id, initial: line.quantity, addon_id: line.addon_id, name: line.name,
  type: line.type, pricing: line.pricing, unit_price: line.unit_price, quantity: line.quantity,
}));
/** Format kiriman API: baris lama cukup id dan jumlah; jumlah nol berarti dihapus. */
export const draftPayload = (drafts: Draft[]) => drafts.filter(draft => draft.quantity > 0).map(draft =>
  draft.id ? { id: draft.id, quantity: draft.quantity }
    : draft.addon_id ? { addon_id: draft.addon_id, quantity: draft.quantity }
      : { name: draft.name, unit_price: draft.unit_price, quantity: draft.quantity });
export const draftsTotal = (drafts: Draft[], duration: number) =>
  drafts.reduce((sum, draft) => sum + lineTotal(draft.unit_price, draft.quantity, draft.pricing, duration), 0);
/** Setelah jam berubah, turunkan pilihan baru yang melebihi stok jam itu. */
export const clampDrafts = (drafts: Draft[], options: AddonOption[]) => drafts.map(draft => {
  const option = !draft.id && draft.addon_id ? options.find(item => item.id === draft.addon_id) : undefined;
  return option ? { ...draft, quantity: Math.min(draft.quantity, maxFor(option)) } : draft;
}).filter(draft => draft.id || draft.quantity > 0);

export function AddonLinesEditor({ options, drafts, onChange, duration, allowCustom = false }: {
  options: AddonOption[] | null; drafts: Draft[]; onChange: (drafts: Draft[]) => void; duration: number; allowCustom?: boolean;
}) {
  const [custom, setCustom] = useState({ name: "", price: "" });
  if (!options) return <p className="ops-muted" role="status">Memeriksa stok tambahan…</p>;

  const update = (key: string, quantity: number) =>
    onChange(drafts.map(draft => draft.key === key ? { ...draft, quantity } : draft).filter(draft => draft.id || draft.quantity > 0));
  const setCatalog = (option: AddonOption, quantity: number) => {
    const current = drafts.find(draft => draft.addon_id === option.id);
    if (current) update(current.key, quantity);
    else if (quantity > 0) onChange([...drafts, { key: option.id, initial: 0, addon_id: option.id, name: option.name, type: option.type, pricing: option.pricing, unit_price: option.price, quantity }]);
  };
  // Item yang sudah nonaktif tidak ada di pilihan, tetapi barisnya tetap bisa dikurangi.
  const inactive = drafts.filter(draft => draft.addon_id && !options.some(option => option.id === draft.addon_id));
  const others = drafts.filter(draft => !draft.addon_id);
  const price = Number(custom.price);
  const customValid = custom.name.trim().length >= 2 && custom.price !== "" && Number.isInteger(price) && price >= 0 && price <= 10000000;
  const addCustom = () => {
    if (!customValid) return;
    onChange([...drafts, { key: crypto.randomUUID(), initial: 0, addon_id: null, name: custom.name.trim(), type: "lainnya", pricing: "per_booking", unit_price: price, quantity: 1 }]);
    setCustom({ name: "", price: "" });
  };
  const subtotal = (value: number, quantity: number, pricing: AddonPricing) => quantity ? money(lineTotal(value, quantity, pricing, duration)) : "";

  return (
    <div className="addon-editor">
      {options.length === 0 && drafts.length === 0 && <p className="ops-muted">Belum ada item aktif. Tambahkan lewat menu Sewa & Tambahan.</p>}
      <ul className="addon-lines">
        {options.map(option => {
          const draft = drafts.find(item => item.addon_id === option.id);
          const quantity = draft?.quantity ?? 0;
          // Baris tersimpan memakai harga saat booking dibuat, bukan harga katalog terbaru.
          const value = draft?.id ? draft.unit_price : option.price;
          const pricing = draft?.id ? draft.pricing : option.pricing;
          const note = availabilityNote(option);
          return (
            <li key={option.id} className={quantity ? "chosen" : ""}>
              <AddonThumb category={option.category} photoId={option.photo_id} />
              <div className="info">
                <b>{option.name}</b>
                <small>{typeLabel[option.type]} · {money(value)} {unitLabel(option.type, pricing)}{option.online === false ? " · khusus kasir" : ""}</small>
                {note && <em className={option.available === 0 ? "out" : ""}>{note}</em>}
              </div>
              <QtyStepper value={quantity} max={maxFor(option, draft?.initial ?? 0)} onChange={value => setCatalog(option, value)} label={option.name} />
              <strong>{subtotal(value, quantity, pricing)}</strong>
            </li>
          );
        })}
        {inactive.map(draft => (
          <li key={draft.key} className={draft.quantity ? "chosen" : ""}>
            <AddonThumb category="lainnya" photoId={null} />
            <div className="info"><b>{draft.name}</b><small>{money(draft.unit_price)} {unitLabel(draft.type, draft.pricing)}</small><em>Item sudah nonaktif, jumlahnya hanya dapat dikurangi</em></div>
            <QtyStepper value={draft.quantity} max={draft.initial} onChange={value => update(draft.key, value)} label={draft.name} />
            <strong>{subtotal(draft.unit_price, draft.quantity, draft.pricing)}</strong>
          </li>
        ))}
        {others.map(draft => (
          <li key={draft.key} className={draft.quantity ? "chosen" : ""}>
            <AddonThumb category="lainnya" photoId={null} />
            <div className="info"><b>{draft.name}</b><small>Biaya lain · {money(draft.unit_price)} per pcs</small></div>
            <QtyStepper value={draft.quantity} max={99} onChange={value => update(draft.key, value)} label={draft.name} />
            <strong>{subtotal(draft.unit_price, draft.quantity, draft.pricing)}</strong>
          </li>
        ))}
      </ul>
      {allowCustom && (
        <div className="addon-custom">
          <label>Biaya lain (di luar katalog)
            <input value={custom.name} maxLength={60} placeholder="Mis. Ganti grip raket rusak" onChange={event => setCustom({ ...custom, name: event.target.value })}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCustom(); } }} />
          </label>
          <label>Harga
            <MoneyInput min={0} max={10000000} value={custom.price} onChange={event => setCustom({ ...custom, price: event.target.value })}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCustom(); } }} />
          </label>
          <button type="button" className="ops-secondary" disabled={!customValid} onClick={addCustom}><Plus size={14} /> Tambah</button>
        </div>
      )}
    </div>
  );
}
