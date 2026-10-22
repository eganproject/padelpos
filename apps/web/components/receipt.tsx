import { forwardRef } from "react";
import { money } from "@/lib/api";
import { formatDay } from "@/lib/shop";
import { taxName } from "@/lib/bill";
import { methodLabel } from "@/lib/payments";
import { minute } from "@/lib/operations";
import { isRoll, rollWidth, type ReceiptData, type ReceiptSettings, type ReceiptVenue } from "@/lib/receipt";
import { type SaleReceiptData, methodName } from "@/lib/counter";
import { assetUrl } from "@/lib/brand";
import { type Shift, differenceLabel, shiftSources } from "@/lib/shifts";

/** Logo merek (bila diatur dan diizinkan di Pengaturan nota) lalu nama venue. */
function ReceiptLogo({ venue, settings }: { venue: ReceiptVenue; settings: ReceiptSettings }) {
  const logo = settings.show_logo !== false && venue.logo ? venue.logo : null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- logo kecil dari API sendiri, ikut tercetak */}
      {logo && <img className="receipt-logo" src={assetUrl(logo)} alt={venue.show_name === false ? venue.name : ""} />}
      {(!logo || venue.show_name !== false) && <b className="receipt-venue">{venue.name || "Venue padel"}</b>}
    </>
  );
}

const stamp = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const hours = (start: string, end: string) => `${((minute(end) - minute(start)) / 60).toLocaleString("id-ID")} jam`;

/**
 * Isi satu nota. Tampilannya mengikuti kertas: kertas gulung (thermal) dibuat sempit dan rapat
 * dengan garis putus-putus, A4/A5 dibuat seperti nota lembar biasa. Lebar kertas gulung ditulis
 * dalam milimeter agar tampilan di layar sama persis dengan hasil cetak.
 */
export const Receipt = forwardRef<HTMLElement, { data: ReceiptData }>(function Receipt({ data }, ref) {
  const { booking, addons, payments, venue, settings } = data;
  const roll = isRoll(settings.paper);
  const width = roll ? rollWidth(settings.paper, settings.custom_width) : 0;
  const closed = booking.status === "cancelled" || booking.status === "expired";
  const remaining = Math.max(0, booking.total - booking.paid);
  const refundDue = closed ? Math.max(0, booking.paid - booking.forfeited) : Math.max(0, booking.paid - booking.total);
  const state = closed ? (booking.status === "expired" ? "KEDALUWARSA" : "DIBATALKAN") : remaining === 0 ? "LUNAS" : booking.paid > 0 ? "BELUM LUNAS" : "BELUM DIBAYAR";
  const contacts = [venue.whatsapp && `WA +${venue.whatsapp}`, venue.phone, venue.email, venue.instagram && `@${venue.instagram}`].filter(Boolean);
  const subtotal = booking.court_total + addons.reduce((sum, line) => sum + line.subtotal, 0);
  const size = roll ? (width < 64 ? "narrow" : "wide") : settings.paper;
  return (
    <article ref={ref} className={`receipt ${roll ? "roll" : "sheet"} size-${size}`} style={roll ? { width: `${width}mm` } : undefined} aria-label={`Nota ${booking.code}`}>
      <header className="receipt-head">
        <ReceiptLogo venue={venue} settings={settings} />
        {venue.address && <span>{venue.address}</span>}
        {contacts.length > 0 && <span>{contacts.join(" · ")}</span>}
        {settings.header_note && <span className="receipt-note">{settings.header_note}</span>}
      </header>

      <div className="receipt-title"><h1>Nota</h1><span className={`receipt-state${closed ? " off" : remaining === 0 ? " on" : ""}`}>{state}</span></div>

      <dl className="receipt-meta">
        <div><dt>No. nota</dt><dd>{booking.code}</dd></div>
        {booking.order_code && <div><dt>Pesanan</dt><dd>{booking.order_code}</dd></div>}
        <div><dt>Dicetak</dt><dd>{stamp.format(new Date(data.printed_at))}</dd></div>
        {settings.show_cashier && data.cashier && <div><dt>Kasir</dt><dd>{data.cashier}</dd></div>}
        <div><dt>Pelanggan</dt><dd>{booking.customer}</dd></div>
        <div><dt>Telepon</dt><dd>{booking.phone}</dd></div>
        {booking.source && <div><dt>Asal</dt><dd>{booking.source === "online" ? "Booking online" : "Booking di kasir"}</dd></div>}
      </dl>

      <table className="receipt-lines">
        {!roll && <thead><tr><th>Rincian</th><th className="num">Jumlah</th></tr></thead>}
        <tbody>
          <tr className="item">
            <td><b>Sewa {booking.court_name}</b><span>{formatDay(booking.date)}</span><span>{booking.start_time}–{booking.end_time} · {hours(booking.start_time, booking.end_time)}</span></td>
            <td className="num">{money(booking.court_total)}</td>
          </tr>
          {addons.map(line => (
            <tr className="item" key={line.id}>
              <td><b>{line.name}</b><span>{line.quantity} × {money(line.unit_price)}{line.pricing === "per_hour" ? " / jam" : ""}</span></td>
              <td className="num">{money(line.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {(booking.discount > 0 || booking.tax > 0 || (booking.member_discount ?? 0) > 0 || (booking.voucher_discount ?? 0) > 0) && <tr><td>Subtotal</td><td className="num">{money(subtotal)}</td></tr>}
          {(booking.member_discount ?? 0) > 0 && <tr><td>Potongan member{booking.member_plan ? ` (${booking.member_plan})` : ""}</td><td className="num">−{money(booking.member_discount!)}</td></tr>}
          {(booking.voucher_discount ?? 0) > 0 && <tr><td>Voucher {booking.voucher_code}</td><td className="num">−{money(booking.voucher_discount!)}</td></tr>}
          {booking.discount > 0 && <tr><td>Potongan{booking.discount_note ? ` (${booking.discount_note})` : ""}</td><td className="num">−{money(booking.discount)}</td></tr>}
          {booking.tax > 0 && <tr><td>{taxName(booking)}</td><td className="num">{booking.tax_inclusive ? "" : "+"}{money(booking.tax)}</td></tr>}
          <tr className="total"><td>Total</td><td className="num">{money(booking.total)}</td></tr>
          {settings.show_payments && payments.map(entry => [
            <tr key={entry.id} className="pay">
              <td>{entry.kind === "refund" ? "Dikembalikan" : "Bayar"} {methodLabel[entry.method] ?? entry.method}<span>{stamp.format(new Date(entry.created_at))}</span></td>
              <td className="num">{entry.kind === "refund" ? "−" : ""}{money(entry.amount)}</td>
            </tr>,
            (entry.surcharge ?? 0) > 0 && entry.kind === "payment" ? <tr key={`${entry.id}-fee`} className="pay"><td>Biaya layanan Midtrans (dibayar pelanggan)</td><td className="num">{money(entry.surcharge!)}</td></tr> : null,
          ])}
          {!settings.show_payments && booking.paid > 0 && <tr><td>Sudah dibayar</td><td className="num">{money(booking.paid)}</td></tr>}
          {closed && booking.forfeited > 0 && <tr><td>Ditahan sebagai denda</td><td className="num">{money(booking.forfeited)}</td></tr>}
          {!closed && <tr className="due"><td>{remaining > 0 ? "Sisa tagihan" : "Sisa"}</td><td className="num">{money(remaining)}</td></tr>}
          {refundDue > 0 && <tr className="due"><td>Perlu dikembalikan</td><td className="num">{money(refundDue)}</td></tr>}
        </tfoot>
      </table>

      <footer className="receipt-foot">
        {settings.footer_note && <p>{settings.footer_note}</p>}
        <p className="muted">Kode booking {booking.code} · tunjukkan ke staf saat datang.</p>
      </footer>
    </article>
  );
});

/** Kepala nota yang sama untuk nota booking dan nota kasir. */
function Head({ venue, settings }: { venue: ReceiptVenue; settings: ReceiptSettings }) {
  const contacts = [venue.whatsapp && `WA +${venue.whatsapp}`, venue.phone, venue.email, venue.instagram && `@${venue.instagram}`].filter(Boolean);
  return (
    <header className="receipt-head">
      <ReceiptLogo venue={venue} settings={settings} />
      {venue.address && <span>{venue.address}</span>}
      {contacts.length > 0 && <span>{contacts.join(" · ")}</span>}
      {settings.header_note && <span className="receipt-note">{settings.header_note}</span>}
    </header>
  );
}


/** Nota transaksi langsung di kasir: sewa atau beli barang tanpa booking lapangan. Selalu lunas atau dibatalkan. */
export const SaleReceipt = forwardRef<HTMLElement, { data: SaleReceiptData }>(function SaleReceipt({ data }, ref) {
  const { sale, lines, venue, settings } = data;
  const roll = isRoll(settings.paper);
  const width = roll ? rollWidth(settings.paper, settings.custom_width) : 0;
  const size = roll ? (width < 64 ? "narrow" : "wide") : settings.paper;
  const voided = sale.status === "void" || sale.status === "expired";
  const renting = lines.some(line => line.type === "sewa");
  const duration = hours(sale.start_time, sale.end_time);
  return (
    <article ref={ref} className={`receipt ${roll ? "roll" : "sheet"} size-${size}`} style={roll ? { width: `${width}mm` } : undefined} aria-label={`Nota ${sale.number}`}>
      <Head venue={venue} settings={settings} />
      <div className="receipt-title"><h1>Nota</h1><span className={`receipt-state${voided ? " off" : " on"}`}>{voided ? "DIBATALKAN" : sale.status === "pending" ? "BELUM DIBAYAR" : "LUNAS"}</span></div>
      <dl className="receipt-meta">
        <div><dt>No. nota</dt><dd>{sale.number}</dd></div>
        <div><dt>Tanggal</dt><dd>{stamp.format(new Date(sale.created_at))}</dd></div>
        {settings.show_cashier && data.cashier && <div><dt>Kasir</dt><dd>{data.cashier}</dd></div>}
        <div><dt>Pelanggan</dt><dd>{sale.customer}</dd></div>
        {sale.phone && <div><dt>Telepon</dt><dd>{sale.phone}</dd></div>}
        {data.booking && <div><dt>Booking</dt><dd>{data.booking.court_name} {data.booking.start_time}–{data.booking.end_time} ({data.booking.code})</dd></div>}
        {renting && <div><dt>Sewa</dt><dd>{sale.start_time}–{sale.end_time}</dd></div>}
      </dl>
      <table className="receipt-lines">
        {!roll && <thead><tr><th>Rincian</th><th className="num">Jumlah</th></tr></thead>}
        <tbody>
          {lines.map(line => (
            <tr className="item" key={line.id}>
              <td><b>{line.name}</b><span>{line.quantity} × {money(line.unit_price)}{line.pricing === "per_hour" ? ` / jam × ${duration}` : ""}</span></td>
              <td className="num">{money(line.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {(sale.discount > 0 || sale.tax > 0 || (sale.member_discount ?? 0) > 0 || (sale.voucher_discount ?? 0) > 0) && <tr><td>Subtotal</td><td className="num">{money(sale.subtotal)}</td></tr>}
          {(sale.member_discount ?? 0) > 0 && <tr><td>Potongan member{sale.member_plan ? ` (${sale.member_plan})` : ""}</td><td className="num">−{money(sale.member_discount!)}</td></tr>}
          {(sale.voucher_discount ?? 0) > 0 && <tr><td>Voucher {sale.voucher_code}</td><td className="num">−{money(sale.voucher_discount!)}</td></tr>}
          {sale.discount > 0 && <tr><td>Potongan{sale.discount_note ? ` (${sale.discount_note})` : ""}</td><td className="num">−{money(sale.discount)}</td></tr>}
          {sale.tax > 0 && <tr><td>{taxName(sale)}</td><td className="num">{sale.tax_inclusive ? "" : "+"}{money(sale.tax)}</td></tr>}
          <tr className="total"><td>Total</td><td className="num">{money(sale.total)}</td></tr>
          {(sale.surcharge ?? 0) > 0 && <tr><td>Biaya layanan Midtrans</td><td className="num">+{money(sale.surcharge!)}</td></tr>}
          {settings.show_payments && <tr className="pay"><td>Bayar {methodName[sale.method] ?? sale.method}{sale.pay_order_id ? " (Midtrans)" : ""}</td><td className="num">{money(sale.tendered ?? sale.total + (sale.surcharge ?? 0))}</td></tr>}
          {settings.show_payments && sale.tendered !== null && sale.tendered > sale.total && <tr className="pay"><td>Kembali</td><td className="num">{money(sale.tendered - sale.total)}</td></tr>}
          {voided && <tr className="due"><td>Dibatalkan: {sale.void_reason}</td><td className="num">{money(sale.total)}</td></tr>}
        </tfoot>
      </table>
      <footer className="receipt-foot">
        {settings.footer_note && <p>{settings.footer_note}</p>}
        {renting && !voided && <p className="muted">Kembalikan barang sewa ke kasir paling lambat pukul {sale.end_time}.</p>}
      </footer>
    </article>
  );
});

export type ShiftReceiptData = { shift: Shift; venue: ReceiptVenue; settings: ReceiptSettings; cashier: string; printed_at: string };
/** Rekap tutup kasir untuk ditempel di buku kas atau diserahkan bersama setoran. */
export const ShiftReceipt = forwardRef<HTMLElement, { data: ShiftReceiptData }>(function ShiftReceipt({ data }, ref) {
  const { shift, venue, settings } = data;
  const roll = isRoll(settings.paper);
  const width = roll ? rollWidth(settings.paper, settings.custom_width) : 0;
  const size = roll ? (width < 64 ? "narrow" : "wide") : settings.paper;
  const sources = shiftSources(shift.summary).filter(row => row.amount);
  return (
    <article ref={ref} className={`receipt ${roll ? "roll" : "sheet"} size-${size}`} style={roll ? { width: `${width}mm` } : undefined} aria-label={`Rekap ${shift.number}`}>
      <Head venue={venue} settings={settings} />
      <div className="receipt-title"><h1>Tutup kasir</h1><span className={`receipt-state${shift.closed_at ? " on" : ""}`}>{shift.closed_at ? "DITUTUP" : "MASIH BUKA"}</span></div>
      <dl className="receipt-meta">
        <div><dt>No. shift</dt><dd>{shift.number}</dd></div>
        <div><dt>Kasir</dt><dd>{shift.user_name}</dd></div>
        <div><dt>Dibuka</dt><dd>{stamp.format(new Date(shift.opened_at))}</dd></div>
        {shift.closed_at && <div><dt>Ditutup</dt><dd>{stamp.format(new Date(shift.closed_at))}</dd></div>}
        {shift.closed_by_name && shift.closed_by_name !== shift.user_name && <div><dt>Ditutup oleh</dt><dd>{shift.closed_by_name}</dd></div>}
      </dl>
      <table className="receipt-lines">
        {!roll && <thead><tr><th>Metode</th><th className="num">Bersih</th></tr></thead>}
        <tbody>
          {shift.summary.methods.map(row => (
            <tr className="item" key={row.method}>
              <td><b>{methodName[row.method] ?? row.method}</b><span>{row.count} transaksi · masuk {money(row.received)}{row.returned ? ` · keluar ${money(row.returned)}` : ""}</span></td>
              <td className="num">{money(row.net)}</td>
            </tr>
          ))}
          {!shift.summary.methods.length && <tr className="item"><td>Tidak ada transaksi</td><td className="num">{money(0)}</td></tr>}
        </tbody>
        <tfoot>
          {sources.map(row => <tr key={row.label} className="pay"><td>{row.label}</td><td className="num">{row.sign < 0 ? "−" : ""}{money(row.amount)}</td></tr>)}
          <tr><td>Modal awal</td><td className="num">{money(shift.opening_cash)}</td></tr>
          <tr className="total"><td>Tunai seharusnya</td><td className="num">{money(shift.expected_cash)}</td></tr>
          {shift.counted_cash !== null && <tr><td>Tunai dihitung</td><td className="num">{money(shift.counted_cash)}</td></tr>}
          {shift.difference !== null && <tr className="due"><td>{differenceLabel(shift.difference)}</td><td className="num">{shift.difference < 0 ? "−" : shift.difference > 0 ? "+" : ""}{money(Math.abs(shift.difference))}</td></tr>}
        </tfoot>
      </table>
      <footer className="receipt-foot">
        {shift.close_note && <p>Catatan: {shift.close_note}</p>}
        <p className="muted">Tanda tangan kasir: ____________</p>
      </footer>
    </article>
  );
});
