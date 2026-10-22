"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, CircleUserRound, CreditCard, Loader2, Lock, MessageCircle, PackagePlus, Plus, ShieldCheck, ShoppingBag, TicketPercent, Trash2, TriangleAlert, X } from "lucide-react";
import { ApiError, money } from "@/lib/api";
import { ShopAddonPicker } from "@/components/shop-addons";
import { ShopSteps } from "@/components/shop-steps";
import { startRouteProgress } from "@/components/route-progress";
import { lineTotal } from "@/lib/addons";
import { formatDay } from "@/lib/shop";
import { useVenueInfo } from "@/lib/use-venue-info";
import { policySummary, whatsappLink } from "@/lib/venue-info";
import {
  cartPayload, clearCart, itemTotal, maxCartItems, removeFromCart, setCartAddon, useCart, useCartReady,
} from "@/lib/cart";
import { amountDue, quoteCart, startCheckout, surchargeFor, type CartQuote, type ChannelKey } from "@/lib/payments";
import { ChannelPicker, cheapestChannel } from "@/components/channel-picker";
import { billOf, taxName } from "@/lib/bill";
import { useAccount, validPhone } from "@/lib/account";

const durationLabel = (minutes: number) => `${(minutes / 60).toLocaleString("id-ID")} jam`;
const dayNumber = (date: string) => Number(date.slice(8, 10));
const monthShort = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });

export default function CartPage() {
  const items = useCart();
  const cartReady = useCartReady();
  const router = useRouter();
  /** Pesanan sudah dibuat dan halaman pembayaran sedang dibuka. */
  const [leaving, setLeaving] = useState(false);
  const placed = useRef(false);
  const { data: venue } = useVenueInfo();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [checking, setChecking] = useState(false);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [form, setForm] = useState({ customer: "", phone: "", email: "", notes: "" });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState<ChannelKey | null>(null);
  /** Kode promo yang sedang dipakai, dan isian kotak kodenya. */
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherOpen, setVoucherOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const account = useAccount();

  // Keranjang baru dikosongkan setelah halaman ini ditinggalkan. Bila dikosongkan sebelum pindah,
  // tampilan "Keranjang masih kosong" sempat muncul dan indikator memuat ikut hilang.
  useEffect(() => () => { if (placed.current) clearCart(); }, []);

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
  // Nomor HP ikut dikirim agar batas pemakaian voucher per pelanggan sudah terlihat sebelum bayar.
  const quotePhone = voucherCode && validPhone(form.phone) ? form.phone.trim() : "";
  useEffect(() => {
    if (!items.length) { setQuote(null); return; }
    let active = true;
    setChecking(true);
    const timer = window.setTimeout(() => {
      quoteCart(cartPayload(items), { voucher_code: voucherCode, phone: quotePhone })
        .then(result => { if (active) setQuote(result); })
        .catch(() => { if (active) setQuote(null); })
        .finally(() => { if (active) setChecking(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); setChecking(false); };
  }, [items, account?.id, voucherCode, quotePhone]);

  const info = venue?.info;
  const payment = venue?.payment;
  const catalog = venue?.addons ?? [];
  const priced = useMemo(() => items.map((item, index) => {
    const checked = quote?.items[index];
    const matches = checked && checked.court_id === item.court_id && checked.date === item.date && checked.start_time === item.start_time;
    return {
      item,
      courtTotal: matches ? checked.court_total : item.court_total,
      // Sebelum server menjawab, pajak dihitung dengan rumus yang sama supaya angkanya tidak melompat.
      ...(matches ? { tax: checked.tax, total: checked.total } : billOf(itemTotal(item), 0, payment?.tax)),
      /** Subtotal tambahan menurut server; harga di browser bisa sudah usang. */
      lineTotals: new Map(matches ? checked.addons.map(line => [line.addon_id, line.subtotal]) : []),
      problem: matches && !checked.ok ? checked.reason || "Sesi ini tidak dapat dipesan." : "",
      matches: !!matches,
      memberCut: matches ? checked.member_discount ?? 0 : 0,
      memberPlan: matches ? checked.member_plan ?? "" : "",
      memberNote: matches ? checked.member_note ?? "" : "",
      voucherCut: matches ? checked.voucher_discount ?? 0 : 0,
    };
  }), [items, quote, payment?.tax]);
  const valid = priced.filter(entry => !entry.problem);
  const total = valid.reduce((sum, entry) => sum + entry.total, 0);
  const tax = valid.reduce((sum, entry) => sum + entry.tax, 0);
  const inclusive = quote ? quote.tax_inclusive : !!payment?.tax?.tax_inclusive;
  const memberCut = valid.reduce((sum, entry) => sum + entry.memberCut, 0);
  const memberPlan = valid.find(entry => entry.memberPlan)?.memberPlan ?? "";
  const voucherCut = valid.reduce((sum, entry) => sum + entry.voucherCut, 0);
  const voucher = voucherCode && quote?.voucher && quote.voucher.code === voucherCode.toUpperCase() ? quote.voucher : null;
  const subtotal = valid.reduce((sum, entry) => sum + entry.total - (inclusive ? 0 : entry.tax), 0) + memberCut + voucherCut;
  const blocked = priced.some(entry => entry.problem);
  // DP dibulatkan per sesi oleh server, jadi nominalnya dijumlah per sesi, bukan dari total keranjang.
  const payNow = quote && priced.every(entry => entry.matches)
    ? quote.amount
    : payment ? valid.reduce((sum, entry) => sum + amountDue(payment, entry.total), 0) : total;
  const later = total - payNow;
  // Biaya admin Midtrans yang ditanggung pelanggan berbeda per metode, jadi metodenya dipilih di sini.
  const fees = payment?.fees;
  const customerPays = fees?.fee_bearer === "customer" && fees.channels.length > 0;
  const picked = customerPays ? fees.channels.find(entry => entry.key === channel) ?? null : null;
  const surcharge = customerPays ? surchargeFor(fees, picked ?? undefined, payNow) : 0;
  const charge = payNow + surcharge;
  useEffect(() => {
    if (customerPays && (!channel || !fees.channels.some(entry => entry.key === channel))) setChannel(cheapestChannel(fees, payNow));
  }, [customerPays, fees, channel, payNow]);
  const policyLine = venue ? policySummary(venue.policies) : null;
  const phoneValid = validPhone(form.phone);
  const nameValid = form.customer.trim().length >= 2;
  const ready = items.length > 0 && !blocked && !checking && nameValid && phoneValid && (!customerPays || !!picked);

  const message = items.length ? [
    `Halo${info?.name ? ` ${info.name}` : ""}, saya ingin memesan:`,
    "",
    ...valid.flatMap(({ item, total: itemPrice }) => [
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
    setTouched(true);
    if (!ready) return;
    setBusy(true); setError("");
    try {
      const result = await startCheckout({
        items: cartPayload(items),
        customer: form.customer.trim(), phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(),
        channel: customerPays ? channel : null,
        voucher_code: voucher?.ok ? voucher.code : "",
      });
      // Sesi sudah menjadi pesanan di server; keranjang dikosongkan saat halaman ini ditinggalkan.
      placed.current = true;
      setLeaving(true);
      // Pembayaran dibuka di halaman pesanan sendiri (Snap tertanam), bukan di situs Midtrans.
      startRouteProgress();
      router.push(`/pesanan/${encodeURIComponent(result.order_id)}`);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : "Pemesanan gagal. Coba lagi sebentar lagi.");
      setBusy(false);
      // Tandai sesi mana yang bermasalah supaya pelanggan tahu apa yang harus dihapus.
      quoteCart(cartPayload(items), { voucher_code: voucherCode, phone: quotePhone }).then(setQuote).catch(() => { });
    }
  }

  /** Tombol di bilah bawah: kirim bila lengkap, bila belum bawa ke isian yang kurang. */
  function payFromBar() {
    if (payment?.enabled && ready) { formRef.current?.requestSubmit(); return; }
    setTouched(true);
    const target = formRef.current?.querySelector<HTMLElement>("[aria-invalid=true], input:invalid") ?? formRef.current ?? summaryRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (target instanceof HTMLInputElement) window.setTimeout(() => target.focus({ preventScroll: true }), 350);
  }

  // Isi keranjang tersimpan di browser; sebelum terbaca, tampilkan kerangka, bukan "kosong".
  if (!cartReady) {
    return (
      <div className="cart shop-wrap">
        <ShopSteps current={1} />
        <div aria-busy="true" aria-label="Memuat keranjang" className="skeleton-stack">
          <div className="skeleton" /><div className="skeleton" />
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="cart shop-wrap">
        <ShopSteps current={1} />
        <div className="empty-state">
          <span className="empty-icon"><ShoppingBag size={30} aria-hidden="true" /></span>
          <h1>Keranjang masih kosong</h1>
          <p>Pilih jam main di halaman booking, lalu masukkan ke keranjang. Beberapa sesi bisa dibayar sekaligus.</p>
          <Link className="shop-btn primary lg" href="/ketersediaan"><CalendarDays size={18} aria-hidden="true" /> Pilih jadwal</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart shop-wrap has-bar">
      <ShopSteps current={1} />
      <header className="page-head">
        <div>
          <h1>Keranjang</h1>
          <p>{items.length} sesi{checking ? " · memeriksa ketersediaan…" : " · ketersediaan sudah dicek"}</p>
        </div>
        {items.length < maxCartItems && <Link className="shop-btn outline sm" href="/ketersediaan"><Plus size={16} aria-hidden="true" /> Tambah sesi</Link>}
      </header>

      <div className="cart-grid">
        <div className="cart-list">
          {priced.map(({ item, courtTotal, total: itemPrice, lineTotals, problem, memberCut: itemCut, memberNote }) => {
            const open = openPicker === item.key;
            const picks = Object.fromEntries(item.addons.map(line => [line.addon_id, line.quantity]));
            return (
              <article className={`cart-item${problem ? " problem" : ""}`} key={item.key}>
                <div className="cart-item-main">
                  <div className="date-tile" aria-hidden="true"><b>{dayNumber(item.date)}</b><small>{monthShort.format(new Date(item.date + "T12:00:00Z"))}</small></div>
                  <div className="what">
                    <h2>{item.court_name}{item.floor && <small> · {item.floor}</small>}</h2>
                    <p>{formatDay(item.date)}</p>
                    <p className="time">{item.start_time} – {item.end_time} <span>· {durationLabel(item.duration)}</span></p>
                  </div>
                  <b className="cost">{problem ? "—" : money(itemPrice)}</b>
                </div>

                {problem && (
                  <p className="cart-problem" role="alert">
                    <TriangleAlert size={17} aria-hidden="true" />
                    <span>{problem}</span>
                  </p>
                )}

                <ul className="cart-lines">
                  <li><span>Sewa lapangan</span><span>{money(courtTotal)}</span></li>
                  {item.addons.map(line => (
                    <li key={line.addon_id}>
                      <span>{line.quantity}× {line.name}</span>
                      <span>{money(lineTotals.get(line.addon_id) ?? lineTotal(line.unit_price, line.quantity, line.pricing, item.duration))}</span>
                    </li>
                  ))}
                  {!problem && itemCut > 0 && <li className="member-cut"><span>Harga member</span><span>−{money(itemCut)}</span></li>}
                </ul>
                {!problem && memberNote && <p className="cart-member-note">{memberNote}</p>}

                {open && catalog.length > 0 && (
                  <ShopAddonPicker options={catalog} picks={picks} loading={false}
                    onChange={(id, quantity) => { const option = catalog.find(entry => entry.id === id); if (option) setCartAddon(item.key, option, quantity); }} />
                )}

                <footer>
                  {catalog.length > 0 && !problem && (
                    <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpenPicker(open ? null : item.key)}>
                      <PackagePlus size={16} aria-hidden="true" /> {open ? "Selesai" : item.addons.length ? "Ubah tambahan" : "Tambah sewa raket"}
                      <ChevronDown size={15} aria-hidden="true" className="chevron" />
                    </button>
                  )}
                  <button type="button" className="link-btn danger" onClick={() => removeFromCart(item.key)}>
                    <Trash2 size={16} aria-hidden="true" /> Hapus
                  </button>
                </footer>
              </article>
            );
          })}
          {items.length >= maxCartItems && <p className="muted small">Keranjang penuh: maksimal {maxCartItems} sesi dalam satu pesanan.</p>}
        </div>

        <aside className="cart-side" ref={summaryRef}>
          <section className="card">
            <h2 className="card-title">Rincian pembayaran</h2>
            <dl className="bill">
              <div><dt>Subtotal ({valid.length} sesi)</dt><dd>{money(subtotal)}</dd></div>
              {memberCut > 0 && <div className="member-cut"><dt>Potongan member · {memberPlan}</dt><dd>−{money(memberCut)}</dd></div>}
              {voucherCut > 0 && voucher?.ok && <div className="member-cut"><dt>Voucher · {voucher.code}</dt><dd>−{money(voucherCut)}</dd></div>}
              {tax > 0 && payment?.tax && <div><dt>{taxName(payment.tax)}</dt><dd>{money(tax)}</dd></div>}
              <div className="total"><dt>Total</dt><dd>{money(total)}</dd></div>
              {payment?.enabled && later > 0 && (
                <>
                  <div className={surcharge > 0 ? "" : "now"}><dt>Bayar sekarang (DP {payment.dp_percent}%)</dt><dd>{money(payNow)}</dd></div>
                  <div><dt>Sisa, dibayar di venue</dt><dd>{money(later)}</dd></div>
                </>
              )}
              {payment?.enabled && surcharge > 0 && (
                <>
                  <div className="fee"><dt>Biaya layanan · {picked?.label}<small>Biaya admin Midtrans, ditanggung pemesan</small></dt><dd>{money(surcharge)}</dd></div>
                  <div className="now"><dt>Dibayar sekarang</dt><dd>{money(charge)}</dd></div>
                </>
              )}
            </dl>
            {payment?.enabled && <VoucherBox open={voucherOpen || !!voucherCode} onOpen={() => setVoucherOpen(true)} input={voucherInput} setInput={setVoucherInput}
              applied={voucherCode} result={voucher} checking={checking}
              apply={() => { const code = voucherInput.trim().toUpperCase(); if (code) setVoucherCode(code); }}
              remove={() => { setVoucherCode(""); setVoucherInput(""); }} />}
            {blocked && <p className="shop-note error" role="alert">Ada sesi yang tidak bisa dipesan. Hapus sesi itu untuk melanjutkan.</p>}
            {policyLine && <Link className="policy-chip" href="/kebijakan#pembatalan"><ShieldCheck size={16} aria-hidden="true" /> {policyLine}</Link>}
          </section>

          {payment?.enabled ? (
            <form ref={formRef} onSubmit={submit} className="card checkout" noValidate>
              <h2 className="card-title">Data pemesan</h2>
              {account ? (
                <p className="account-note"><CircleUserRound size={17} aria-hidden="true" /> Pesanan tersimpan di akun <b>{account.email || account.name}</b></p>
              ) : venue?.login.enabled && account === null ? (
                <Link className="account-note invite" href="/masuk?lanjut=%2Fkeranjang">
                  <CircleUserRound size={17} aria-hidden="true" />
                  <span><b>Masuk dengan Google</b> agar data terisi otomatis dan pesanan tersimpan.</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ) : null}
              <label className="field">
                <span>Nama pemesan</span>
                <input required minLength={2} maxLength={80} autoComplete="name" placeholder="Nama lengkap" value={form.customer}
                  aria-invalid={touched && !nameValid} onChange={event => setForm({ ...form, customer: event.target.value })} />
                {touched && !nameValid && <small className="field-error">Isi nama pemesan, minimal 2 huruf.</small>}
              </label>
              <label className="field">
                <span>Nomor WhatsApp</span>
                <input required inputMode="tel" autoComplete="tel" maxLength={20} placeholder="0812 3456 7890" value={form.phone}
                  aria-invalid={(touched || form.phone !== "") && !phoneValid} onChange={event => setForm({ ...form, phone: event.target.value })} />
                {(touched || form.phone !== "") && !phoneValid
                  ? <small className="field-error">Masukkan nomor WhatsApp Indonesia yang aktif, mis. 0812 3456 7890.</small>
                  : <small>Untuk konfirmasi jadwal dari venue.</small>}
              </label>
              <label className="field">
                <span>Email <em>opsional</em></span>
                <input type="email" maxLength={60} autoComplete="email" placeholder="Untuk bukti pembayaran" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
              </label>
              <label className="field">
                <span>Catatan <em>opsional</em></span>
                <input maxLength={300} placeholder="Mis. datang ber-4" value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} />
              </label>
              {customerPays && <ChannelPicker fees={fees} base={payNow} value={channel} onChange={setChannel} />}
              {error && <p className="shop-note error" role="alert">{error}</p>}
              <button className="shop-btn primary lg wide" type="submit" disabled={busy || checking || blocked}>
                {busy ? <><Loader2 size={18} className="spin" aria-hidden="true" /> {leaving ? "Membuka pembayaran…" : "Menyiapkan pembayaran…"}</> : <><Lock size={17} aria-hidden="true" /> Bayar {money(charge)}</>}
              </button>
              <p className="fine">
                <ShieldCheck size={15} aria-hidden="true" />
                <span>Slot dikunci {payment.hold_minutes} menit selama pembayaran. Diproses aman oleh Midtrans{customerPays
                  ? `; biaya layanan mengikuti tarif Midtrans untuk metode yang dipilih.`
                  : ": QRIS, virtual account, e-wallet, atau kartu."}</span>
              </p>
              {payment.note && <p className="fine">{payment.note}</p>}
            </form>
          ) : (
            <section className="card checkout">
              {info?.whatsapp ? (
                <>
                  <h2 className="card-title">Kirim pesanan</h2>
                  <p className="muted">Pembayaran online belum aktif. Kirim daftar ini ke staf venue; slot terkunci setelah staf mengonfirmasi.</p>
                  <a className="shop-btn primary lg wide" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener">
                    <MessageCircle size={18} aria-hidden="true" /> Pesan via WhatsApp
                  </a>
                </>
              ) : (
                <p className="muted">Pemesanan online belum aktif. Tunjukkan daftar ini ke staf venue.</p>
              )}
            </section>
          )}
        </aside>
      </div>

      <div className="pay-bar">
        <div>
          <small>{payment?.enabled && (later > 0 || surcharge > 0) ? "Bayar sekarang" : "Total"}</small>
          <b>{money(payment?.enabled ? charge : total)}</b>
        </div>
        {payment?.enabled ? (
          <button type="button" className="shop-btn primary" onClick={payFromBar} disabled={busy || checking || blocked}>
            {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />} {ready ? "Bayar" : "Isi data"}
          </button>
        ) : info?.whatsapp ? (
          <a className="shop-btn primary" href={whatsappLink(info.whatsapp, message)} target="_blank" rel="noopener"><MessageCircle size={18} aria-hidden="true" /> Kirim</a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Kotak kode promo. Kode dikirim ke server bersama isi keranjang, jadi potongan yang tampil sama
 * dengan yang ditagih. Kode yang tidak berlaku tetap tampil dengan alasannya agar mudah diperbaiki.
 */
function VoucherBox({ open, onOpen, input, setInput, applied, result, checking, apply, remove }: {
  open: boolean; onOpen: () => void; input: string; setInput: (value: string) => void; applied: string;
  result: CartQuote["voucher"] | null; checking: boolean; apply: () => void; remove: () => void;
}) {
  if (!open) return (
    <button type="button" className="link-btn voucher-toggle" onClick={onOpen}><TicketPercent size={16} aria-hidden="true" /> Punya kode promo?</button>
  );
  if (applied && result?.ok) return (
    <div className="voucher-applied" role="status">
      <TicketPercent size={18} aria-hidden="true" />
      <div><b>{result.code}</b><small>{result.name}{result.summary ? ` · ${result.summary}` : ""}</small></div>
      <button type="button" className="icon-btn" aria-label="Hapus kode promo" onClick={remove}><X size={16} aria-hidden="true" /></button>
    </div>
  );
  return (
    <div className="voucher-box">
      <label className="field">
        <span>Kode promo</span>
        <div className="voucher-input">
          <input value={input} maxLength={32} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="Mis. MAINPAGI"
            aria-invalid={!!applied && !!result && !result.ok}
            onChange={event => setInput(event.target.value.toUpperCase().replace(/\s+/g, ""))}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} />
          <button type="button" className="shop-btn outline sm" disabled={!input.trim() || (checking && applied === input.trim())} onClick={apply}>
            {checking && applied && applied === input.trim() ? <Loader2 size={16} className="spin" aria-hidden="true" /> : "Pakai"}
          </button>
        </div>
        {applied && result && !result.ok && <small className="field-error">{result.message}</small>}
      </label>
    </div>
  );
}
