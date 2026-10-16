import { Check } from "lucide-react";

const steps = ["Pilih jadwal", "Cek keranjang", "Bayar"];

/** Penunjuk posisi dalam alur pemesanan, supaya pelanggan selalu tahu langkah berikutnya. */
export function ShopSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="shop-steps" aria-label="Langkah pemesanan">
      {steps.map((label, index) => (
        <li key={label} className={index < current ? "done" : index === current ? "now" : ""} aria-current={index === current ? "step" : undefined}>
          <span className="dot" aria-hidden="true">{index < current ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
          <span className="label">{label}</span>
        </li>
      ))}
    </ol>
  );
}
