import { Minus, Plus } from "lucide-react";

/** Tombol kurang/tambah jumlah, dipakai di formulir booking staf dan halaman pelanggan. */
export function QtyStepper({ value, max, onChange, label }: { value: number; max: number; onChange: (value: number) => void; label: string }) {
  return (
    <div className="qty-stepper" role="group" aria-label={`Jumlah ${label}`}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label={`Kurangi ${label}`} data-tip={`Kurangi ${label}`}><Minus size={14} /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Tambah ${label}`} data-tip={`Tambah ${label}`}><Plus size={14} /></button>
    </div>
  );
}
