import { money } from "@/lib/api";
import { type AddonOption, availabilityNote, maxFor, shopTypeLabel, unitLabel } from "@/lib/addons";
import { AddonThumb } from "./addon-icon";
import { QtyStepper } from "./qty-stepper";

/** Katalog sewa & tambahan di beranda. Hanya bacaan, jadi digambar di server. */
export function ShopAddonCatalog({ items }: { items: AddonOption[] }) {
  return (
    <ul className="addon-rail">
      {items.map(item => (
        <li key={item.id}>
          <AddonThumb category={item.category} photoId={item.photo_id} />
          <div>
            <small>{shopTypeLabel[item.type]}</small>
            <b>{item.name}</b>
            <span className="price">{money(item.price)} <small>{unitLabel(item.type, item.pricing)}</small></span>
            {item.type === "jual" && item.available === 0 && <em className="out">Stok sedang habis</em>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Pilihan tambahan saat memilih jam main. Stok ikut jam yang dipilih. */
export function ShopAddonPicker({ id, options, picks, loading, onChange }: {
  id?: string; options: AddonOption[]; picks: Record<string, number>; loading: boolean; onChange: (id: string, quantity: number) => void;
}) {
  return (
    <div className="addon-pick" id={id}>
      {loading && <p className="addon-pick-note" role="status">Memeriksa stok untuk jam ini…</p>}
      <ul>
        {options.map(option => {
          const quantity = picks[option.id] ?? 0;
          const note = availabilityNote(option);
          const max = maxFor(option, quantity);
          return (
            <li key={option.id} className={quantity ? "on" : max === 0 ? "out" : ""}>
              <AddonThumb category={option.category} photoId={option.photo_id} />
              <div className="info">
                <b>{option.name}</b>
                <small>{money(option.price)} {unitLabel(option.type, option.pricing)}</small>
                {note && <em>{note}</em>}
              </div>
              <QtyStepper value={quantity} max={max} onChange={value => onChange(option.id, value)} label={option.name} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
