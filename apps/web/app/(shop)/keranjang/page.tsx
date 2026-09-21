"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, CircleUserRound, Clock3, CreditCard, Loader2, MessageCircle, PackagePlus, ShieldCheck, ShoppingBag, Trash2, TriangleAlert } from "lucide-react";
import { ApiError, money } from "@/lib/api";
import { AddonThumb } from "@/components/addon-icon";
import { QtyStepper } from "@/components/qty-stepper";
import { lineTotal, unitLabel } from "@/lib/addons";
import { formatDay, formatShortDay } from "@/lib/shop";
import { useVenueInfo } from "@/lib/use-venue-info";
import { policySummary, whatsappLink } from "@/lib/venue-info";
import {
  addonsTotal, cartPayload, clearCart, itemTotal, maxCartItems, removeFromCart, setCartAddon, useCart,
} from "@/lib/cart";
import { amountDue, quoteCart, startCheckout, type CartQuote } from "@/lib/payments";
import { useAccount } from "@/lib/account";

const durationLabel = (minutes: number) => `${(minutes / 60).toLocaleString("id-ID")} jam`;

export default function CartPage() {
  const items = useCart();
  const { data: venue } = useVenueInfo();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [checking, setChecking] = useState(false);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [form, setForm] = useState({ customer: "", phone: "", email: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const account = useAccount();

  // Pelanggan yang sudah masuk tidak perlu mengetik ulang datanya; isian yang sudah diubah dibiarkan.
  useEffect(() => {
    if (!account || account.needs_profile) return;
    setForm(current => ({
      ...current,
      customer: current.customer || account.name,
      phone: current.phone || account.phone,
      email: current.email || account.email,
    }));
  }, [account]);

  // Harga dan ketersediaan selalu datang dari server, bukan dari angka yang tersimpan di browser.
  useEffect(() => {
    if (!items.length) { setQuote(null); return; }
    let active = true;
    setChecking(true);
    const timer = window.setTimeout(() => {
      quoteCart(cartPayload(items))
        .then(result => { if (active) setQuote(result); })
        .catch(() => { if (active) setQuote(null); })
        .finally(() => { if (active) setChecking(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); setChecking(false); };
  }, [items]);

  const info = venue?.info;
  const payment = venue?.payment;
  const catalog = venue?.addons ?? [];
  const priced = useMemo(() => items.map((item, index) => {
    const checked = quote?.items[index];
    const matches = checked && checked.court_id === item.court_id && checked.date === item.date && checked.start_time === item.start_time;
    return {
      item,
      courtTotal: matches ? checked.court_total : item.court_total,
      total: matches ? checked.total : itemTotal(item),
      problem: matches && !checked.ok ? checked.reason || "Sesi ini tidak dapat dipesan." : "",
    };
  }), [items, quote]);
  const total = priced.reduce((sum, entry) => sum + (entry.problem ? 0 : entry.total), 0);
  const blocked = priced.some(entry => entry.problem);
  const payNow = payment ? amountDue(payment, total) : total;
  const later = total - payNow;
  const policyLine = venue ? policySummary(venue.policies) : null;
  const phoneDigits = form.phone.replace(/[^0-9]/g, "");
  const ready = items.length > 0 && !blocked && !checking && form.customer.trim().length >= 2 && phoneDigits.length >= 9;

  const message = items.length ? [
    `Halo${info?.name ? ` ${info.name}` : ""}, saya ingin memesan:`,
    "",
    ...priced.flatMap(({ item, total: itemPrice }) => [
      `• ${item.court_name}${item.floor ? ` (${item.floor})` : ""} — ${formatDay(item.date)}, ${item.start_time}–${item.end_time}: ${money(itemPrice)}`,
      ...item.addons.map(line => `   – ${line.quantity}× ${line.name}`),
    ]),
    "",
    `Total: ${money(total)}`,
    "",
    "Apakah jadwal ini masih tersedia?",
  ].join("\n") : "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true); setError("");
    try {
      const result = await startCheckout({
        items: cartPayload(items),
        customer: form.customer.trim(), phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(),
      });
      // Sesi sudah menjadi pesanan di server; keranjang tidak perlu disimpan lagi.
      clearCart();
      window.location.assign(result.redirect_url);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Pemesanan gagal. Coba lagi sebentar lagi.");
      setBusy(false);
      // Tandai sesi mana yang bermasalah supaya pelanggan tahu apa yang harus dihapus.
      quoteCart(cartPayload(items)).then(setQuote).catch(() => { });
    }
  }

  if (!items.length) {
    return (
      <section className="shop-band shop-wrap">
        <div className="cart-empty">
          <span><ShoppingBag size={30} aria-hidden="true" /></span>
          <h1>Keranjang masih kosong</h1>
          <p>Pilih jam main di halaman jadwal, lalu tambahkan ke keranjang. Anda bisa memesan beberapa sesi sekaligus dan membayarnya satu kali.</p>
          <Link className="shop-btn primary" href="/ketersediaan"><CalendarDays size={18} aria-hidden="true" /> Lihat jadwal</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="shop-band shop-wrap">
      <div className="book-head">
        <div>
          <h1>Keranjang</h1>
          <p>{items.length} sesi dipilih{checking ? " · memeriksa ketersediaan…" : ""}</p>
        </div>
        <Link className="shop-btn outline sm" href="/ketersediaan"><CalendarDays size={16} aria-hidden="true" /> Tambah sesi</Link>
      </div>

      <div className="cart-grid">
        <div className="cart-list">
          {priced.map(({ item, courtTotal, total: itemPrice, problem }) => {
            const open = openPicker === item.key;
            return (
              <article className={`cart-item${problem ? " problem" : ""}`} key={item.key}>
                <header>
                  <div className="what">
                    <h2>{item.court_name}</h2>
                    <p><CalendarDays size={15} aria-hidden="true" /> {formatDay(item.date)}</p>
                    <p><Clock3 size={15} aria-hidden="true" /> {item.start_time} – {item.end_time} · {durationLabel(item.duration)}</p>
                    {item.floor && <span className="floor">{item.floor}</span>}
                  </div>
                  <div className="cost">
                    <b>{money(courtTotal)}</b>
                    <small>sewa lapangan</small>
                  </div>
                </header>

                {problem && (
                  <p className="cart-problem" role="alert">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>{problem}</span>
                    <button type="button" onClick={() => removeFromCart(item.key)}>Hapus sesi</button>
                  </p>
                )}

                {item.addons.length > 0 && (
                  <ul className="cart-lines">
                    {item.addons.map(line => (
                      <li key={line.addon_id}>
                        <span>{line.quantity}× {line.name}</span>
                        <b>{money(lineTotal(line.unit_price, line.quantity, line.pricing, item.duration))}</b>
                      </li>
                    ))}
                  </ul>
                )}

                {catalog.length > 0 && (
                  <>
                    <button type="button" className="cart-more" aria-expanded={open} onClick={() => setOpenPicker(open ? null : item.key)}>
                      <PackagePlus size={16} aria-hidden="true" />
                      {item.addons.length ? "Ubah sewa & tambahan" : "Tambah sewa raket, bola & lainnya"}
                      <ChevronDown size={15} aria-hidden="true" className="chevron" />
                    </button>
                    {open && (
                      <ul className="cart-picker">
                        {catalog.map(option => {
                          const chosen = item.addons.find(line => line.addon_id === option.id);
                          return (
                            <li key={option.id} className={chosen ? "chosen" : ""}>
                              <AddonThumb category={option.category} photoId={option.photo_id} />
                              <div className="info">
                                <b>{option.name}</b>
                                <small>{money(option.price)} {unitLabel(option.type, option.pricing)}</small>
                              </div>
                              <QtyStepper
                                value={chosen?.quantity ?? 0}
                                max={option.max_per_booking}
                                onChange={value => setCartAddon(item.key, option, value)}
                                label={`${option.name} untuk ${item.court_name}`}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}

                <footer>
                  <button type="button" className="cart-remove" onClick={() => removeFromCart(item.key)}>
                    <Trash2 size={15} aria-hidden="true" /> Hapus sesi
                  </button>
                  <div>
                    {addonsTotal(item) > 0 && <small>termasuk tambahan {money(addonsTotal(item))}</small>}
                    <strong>{money(itemPrice)}</strong>
                  </div>
                </footer>
              </article>
            );
          })}
          {items.length >= maxCartItems && <p className="cart-note">Keranjang penuh: maksimal {maxCartItems} sesi dalam satu pesanan.</p>}
        </div>

        <aside className="cart-summary">
          <div className="cart-card">
            <h2>Ringkasan pesanan</h2>
            <dl className="cart-bill">
              {priced.map(({ item, total: itemPrice, problem }) => (
                <div key={item.key} className={problem ? "muted" : ""}>
                  <dt>{item.court_name} · {formatShortDay(item.date)} {item.start_time}</dt>
                  <dd>{problem ? "—" : money(itemPrice)}</dd>
                </div>
              ))}
              <div className="total"><dt>Total</dt><dd>{money(total)}</dd></div>
              {payment?.enabled && later > 0 && (
                <>
                  <div className="now"><dt>Dibayar sekarang (DP {payment.dp_percent}%)</dt><dd>{money(payNow)}</dd></div>
                  <div><dt>Sisa dibayar di venue</dt><dd>{money(later)}</dd></div>
                </>
              )}
            </dl>

            {blocked && <p className="shop-note error" role="alert">Ada sesi yang tidak bisa dipesan. Hapus sesi itu untuk melanjutkan.</p>}
            {error && <p className="shop-note error" role="alert">{error}</p>}

            {payment?.enabled ? (
              <form ref={formRef} onSubmit={submit} className="cart-form">
                <h3>Data pemesan</h3>
                {account ? (
                  <p className="cart-account"><CircleUserRound size={16} aria-hidden="true" /> Tersimpan di akun <b>{account.email || account.name}</b></p>
                ) : venue?.login.enabled && account === null ? (
                  <Link className="cart-account invite" href="/masuk?lanjut=%2Fkeranjang">
                    <CircleUserRound size={16} aria-hidden="true" />
                    <span><b>Masuk dengan Google</b> supaya pesanan ini tersimpan di riwayat Anda dan data terisi otomatis.</span>
                  </Link>
                ) : null}
                <label>Nama pemesan
                  <input required minLength={2} maxLength={80} value={form.customer} onChange={event => setForm({ ...form, customer: event.target.value })} />
                </label>
                <label>Nomor WhatsApp
                  <input required inputMode="tel" minLength={9} maxLength={18} placeholder="08xxxxxxxxxx" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
                </label>
                <label>Email (opsional)
                  <input type="email" maxLength={60} placeholder="untuk bukti pembayaran" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
                </label>
                <label>Catatan (opsional)
                  <input maxLength={300} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} />
                </label>
                <button className="shop-btn primary wide" type="submit" disabled={!ready || busy}>
                  {busy ? <><Loader2 size={18} className="spin" aria-hidden="true" /> Menyiapkan…</> : <><CreditCard size={18} aria-hidden="true" /> Bayar {money(payNow)}</>}
                </button>
                <p className="cart-note">
                  <ShieldCheck size={15} aria-hidden="true" />
                  Slot dikunci {payment.hold_minutes} menit setelah pembayaran dimulai. Pembayaran diproses Midtrans: QRIS, virtual account, e-wallet, atau kartu.
                </p>
                {payment.note && <p className="cart-note">{payment.note}</p>}
              </form>
            ) : (
              <div className="cart-form">
                {info?.whatsapp ? (
                  <>
                    <a className="shop-btn primary wide" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener">
                      <MessageCircle size={18} aria-hidden="true" /> Pesan via WhatsApp
                    </a>
                    <p className="cart-note">Pembayaran online belum aktif. Kirim daftar ini ke staf venue; slot baru terkunci setelah staf mengonfirmasi.</p>
                  </>
                ) : (
                  <p className="cart-note">Pemesanan online belum aktif. Tunjukkan daftar ini ke staf venue.</p>
                )}
              </div>
            )}

            {policyLine && <Link className="shop-tlink" href="/kebijakan#pembatalan">{policyLine} <ArrowRight size={15} aria-hidden="true" /></Link>}
          </div>
        </aside>
      </div>

      <div className="cart-bar">
        <div>
          <small>{items.length} sesi</small>
          <b>{money(payment?.enabled ? payNow : total)}</b>
        </div>
        <button type="button" className="shop-btn primary sm" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          Isi data pemesan <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
