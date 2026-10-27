"use client";
import { money } from "@/lib/api";
import { type ChannelKey, type PublicFees, rateLabel, surchargeFor } from "@/lib/payments";

/**
 * Pilihan metode Midtrans sebelum halaman bayar dibuka. Dipakai bila biaya admin ditanggung pelanggan:
 * besarnya berbeda per metode, jadi pelanggan melihat biaya layanannya lebih dulu dan Midtrans hanya
 * menampilkan metode yang dipilih.
 */
export function ChannelPicker({ fees, base, value, onChange, name = "metode-bayar", compact = false }: {
  fees: PublicFees; base: number; value: ChannelKey | null; onChange: (key: ChannelKey) => void; name?: string; compact?: boolean;
}) {
  return (
    <fieldset className={`pay-channels${compact ? " compact" : ""}`}>
      <legend>Metode pembayaran</legend>
      {fees.channels.map(channel => {
        const surcharge = surchargeFor(fees, channel, base);
        return (
          <label key={channel.key} className={value === channel.key ? "on" : ""}>
            <input type="radio" name={name} value={channel.key} checked={value === channel.key} onChange={() => onChange(channel.key)} />
            <span className="what"><b>{channel.label}</b><small>{channel.hint}</small></span>
            <span className="cost" data-tip={`Tarif Midtrans ${rateLabel(channel)}`}>{base > 0 ? `+${money(surcharge)}` : rateLabel(channel)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Metode yang paling murah untuk nominal itu, sebagai pilihan awal. */
export function cheapestChannel(fees: PublicFees | undefined, base: number): ChannelKey | null {
  if (!fees?.channels.length) return null;
  return [...fees.channels].sort((a, b) => surchargeFor(fees, a, base) - surchargeFor(fees, b, base))[0].key;
}
