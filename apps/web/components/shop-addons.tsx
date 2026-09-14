"use client";
import { money } from "@/lib/api";
import { type AddonOption, availabilityNote, categoryLabel, maxFor, shopTypeLabel, unitLabel } from "@/lib/addons";
import { AddonThumb } from "./addon-icon";
import { QtyStepper } from "./qty-stepper";

/** Pilihan tambahan di ringkasan pesanan halaman ketersediaan. */
export function ShopAddonPicker({ id, options, picks, loading, onChange }: {
  id: string; options: AddonOption[]; picks: Record<string, number>; loading: boolean; onChange: (id: string, quantity: number) => void;
}) {
  return (
    <div className="shop-addon-picker" id={id}>
      <p className="shop-addon-note" role="status">
        {loading ? "Memeriksa stok untuk jam ini…" : "Dibayar bersama sewa lapangan. Staf memastikan barangnya siap saat konfirmasi."}
      </p>
      <ul>
        {options.map(option => {
          const quantity = picks[option.id] ?? 0;
          const note = availabilityNote(option);
          return (
            <li key={option.id} className={quantity ? "chosen" : ""}>
              <AddonThumb category={option.category} photoId={option.photo_id} />
              <div className="info">
                <b>{option.name}</b>
                <small>{money(option.price)} {unitLabel(option.type, option.pricing)}</small>
                {note && <em className={option.available === 0 ? "out" : ""}>{note}</em>}
              </div>
              <QtyStepper value={quantity} max={maxFor(option)} onChange={value => onChange(option.id, value)} label={option.name} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Daftar sewa & tambahan di beranda. */
export function ShopAddonCatalog({ items }: { items: AddonOption[] }) {
  return (
    <ul className="shop-addons">
      {items.map(item => (
        <li key={item.id}>
          <AddonThumb category={item.category} photoId={item.photo_id} className="large" />
          <div className="body">
            <small>{categoryLabel[item.category]} · {shopTypeLabel[item.type]}</small>
            <b>{item.name}</b>
            {item.description && <p>{item.description}</p>}
            <span className="price">{money(item.price)} <small>{unitLabel(item.type, item.pricing)}</small></span>
            {item.type === "jual" && item.available === 0 && <em className="out">Stok sedang habis</em>}
          </div>
        </li>
      ))}
    </ul>
  );
}
