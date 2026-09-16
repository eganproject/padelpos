"use client";
import { useState } from "react";
import { CreditCard, Loader2, ShieldCheck, X } from "lucide-react";
import { ApiError, money } from "@/lib/api";
import { amountDue, startCheckout, type PaymentPublic } from "@/lib/payments";

export type CheckoutPick = { addon_id: string; name: string; quantity: number; subtotal: number };

/**
 * Formulir singkat sebelum diarahkan ke halaman pembayaran Midtrans.
 * Slot baru terkunci setelah tombol bayar ditekan, jadi konflik jadwal dilaporkan di sini.
 */
export function CheckoutModal({ payment, booking, onClose, onTaken }: {
  payment: PaymentPublic;
  booking: { court_id: string; court_name: string; floor?: string; date: string; dateLabel: string; start_time: string; end_time: string; durationLabel: string; courtTotal: number; total: number; picks: CheckoutPick[] };
  onClose: () => void;
  onTaken: () => void;
}) {
  const [form, setForm] = useState({ customer: "", phone: "", email: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = amountDue(payment, booking.total);
  const later = booking.total - now;
  const valid = form.customer.trim().length >= 2 && form.phone.replace(/[^0-9]/g, "").length >= 9;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await startCheckout({
        court_id: booking.court_id, date: booking.date, start_time: booking.start_time, end_time: booking.end_time,
        customer: form.customer.trim(), phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(),
        addons: booking.picks.map(pick => ({ addon_id: pick.addon_id, quantity: pick.quantity })),
      });
      // Halaman Midtrans menggantikan halaman ini; status pesanan dibuka lewat URL finish.
      window.location.assign(result.redirect_url);
    } catch (problem) {
      const message = problem instanceof ApiError ? problem.message : "Pemesanan gagal. Coba lagi.";
      setError(message);
      if (problem instanceof ApiError && problem.status === 409) onTaken();
      setBusy(false);
    }
  }

  return (
    <div className="shop-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="shop-modal" role="dialog" aria-modal="true" aria-labelledby="judul-checkout">
        <header>
          <h2 id="judul-checkout">Data pemesan</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Tutup"><X size={18} /></button>
        </header>
        <div className="shop-modal-summary">
          <b>{booking.court_name}{booking.floor ? ` · ${booking.floor}` : ""}</b>
          <span>{booking.dateLabel} · {booking.start_time}–{booking.end_time} ({booking.durationLabel})</span>
          <dl>
            <div><dt>Sewa lapangan</dt><dd>{money(booking.courtTotal)}</dd></div>
            {booking.picks.map(pick => (
              <div key={pick.addon_id}><dt>{pick.quantity}× {pick.name}</dt><dd>{money(pick.subtotal)}</dd></div>
            ))}
            <div className="total"><dt>Total</dt><dd>{money(booking.total)}</dd></div>
          </dl>
        </div>
        <form onSubmit={submit}>
          {error && <p className="shop-note error" role="alert">{error}</p>}
          <label>Nama pemesan<input required minLength={2} maxLength={80} autoFocus value={form.customer} onChange={event => setForm({ ...form, customer: event.target.value })} /></label>
          <label>Nomor WhatsApp<input required inputMode="tel" minLength={9} maxLength={18} placeholder="08xxxxxxxxxx" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
          <label>Email (opsional)<input type="email" maxLength={60} placeholder="untuk bukti pembayaran" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
          <label>Catatan (opsional)<input maxLength={300} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="shop-modal-pay">
            <div>
              <small>{payment.mode === "dp" ? `Dibayar sekarang (DP ${payment.dp_percent}%)` : "Dibayar sekarang"}</small>
              <b>{money(now)}</b>
              {later > 0 && <span>Sisa {money(later)} dibayar di venue</span>}
            </div>
            <button className="shop-cta" type="submit" disabled={!valid || busy}>
              {busy ? <><Loader2 size={18} className="spin" aria-hidden="true" /> Menyiapkan…</> : <><CreditCard size={18} aria-hidden="true" /> Lanjut ke pembayaran</>}
            </button>
          </div>
          <p className="shop-modal-note">
            <ShieldCheck size={15} aria-hidden="true" />
            Slot ditahan {payment.hold_minutes} menit sampai pembayaran selesai. Pembayaran diproses Midtrans (QRIS, virtual account, e-wallet, kartu).
          </p>
          {payment.note && <p className="shop-modal-note">{payment.note}</p>}
        </form>
      </div>
    </div>
  );
}
