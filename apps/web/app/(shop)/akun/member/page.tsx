"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CalendarDays, Clock3, CreditCard, KeyRound, Loader2, RefreshCw, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { claimMembership, fetchMembership, joinMembership, payMembership, renewMembership, useAccount, validPhone, type MemberCheckout, type MyMembership } from "@/lib/account";
import { money } from "@/lib/api";
import { type MemberInvoice, type PublicPlan, discountSummary, longDate, monthsLabel, percentLabel } from "@/lib/members";

/** Ke halaman bayar Midtrans; kembali ke halaman ini setelah selesai. */
const goPay = (checkout: MemberCheckout) => { window.location.href = checkout.redirect_url; };

export default function MemberPage() {
  const account = useAccount();
  const [data, setData] = useState<MyMembership | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (refresh = false) => {
    try { setData(await fetchMembership(refresh)); setError(""); }
    catch (problem) { setError((problem as Error).message); }
  }, []);
  // Kembali dari Midtrans (?order_id=…): tanyakan langsung statusnya, jangan menunggu webhook.
  useEffect(() => { void load(new URLSearchParams(window.location.search).has("order_id")); }, [load]);

  if (!account) return null;
  if (!data) return error
    ? <p className="shop-note error" role="alert">{error} <button type="button" className="shop-btn outline sm" onClick={() => void load()}>Coba lagi</button></p>
    : <div className="skeleton" style={{ minHeight: 260 }} aria-busy="true" />;

  const { membership, settings } = data;
  const pending = data.invoices.find(invoice => invoice.status === "pending");
  return (
    <div className="acct-home member-page">
      {!membership ? <>
        <Join data={data} defaults={{ name: account.name, phone: account.phone }} />
        <Claim done={setData} />
      </> : membership.status === "pending_payment" ? <>
        <PendingSignup data={data} invoice={pending} defaults={{ name: membership.name, phone: account.phone }} refresh={() => void load(true)} />
      </> : <>
        <section className={`member-pass ${membership.state}`} aria-label="Kartu member">
          <div className="member-pass-top"><span><BadgeCheck size={16} aria-hidden="true" /> {membership.plan.name}</span><code>{membership.code}</code></div>
          <h2>{membership.name}</h2>
          <p className="member-pass-perk">{discountSummary(membership.plan)}</p>
          <dl>
            <div><dt>{membership.state === "expired" ? "Berakhir" : "Berlaku sampai"}</dt><dd>{membership.ends_on ? longDate(membership.ends_on) : "Menunggu persetujuan"}</dd></div>
            {membership.days_left !== null && <div><dt>Sisa</dt><dd>{membership.days_left} hari</dd></div>}
            {data.totals && data.totals.saved > 0 && <div><dt>Sudah hemat</dt><dd>{money(data.totals.saved)}</dd></div>}
          </dl>
          <small>Sebutkan kode ini di kasir. Saat memesan online dari akun ini, harga member terpasang otomatis.</small>
        </section>
        {membership.status === "pending_approval" && <p className="shop-note warn"><Clock3 size={16} aria-hidden="true" /> Pembayaran diterima. Venue sedang memeriksa pendaftaran Anda; masa berlaku dimulai setelah disetujui dan Anda akan dikabari.</p>}
        {membership.state === "frozen" && <p className="shop-note warn"><Snowflake size={16} aria-hidden="true" /> Keanggotaan sedang dibekukan, jadi harga member tidak berlaku. Hari yang dibekukan ditambahkan ke masa berlaku saat diaktifkan lagi oleh venue.</p>}
        {membership.state === "expired" && <p className="shop-note warn"><Clock3 size={16} aria-hidden="true" /> Masa berlaku sudah habis. Perpanjang untuk memakai harga member lagi.</p>}
        {(membership.state === "active" || membership.state === "frozen" || membership.state === "expired") &&
          <Renew data={data} invoice={pending} refresh={() => void load(true)} />}
        <Link className="shop-btn primary wide" href="/ketersediaan"><CalendarDays size={18} aria-hidden="true" /> Pesan dengan harga member</Link>
      </>}
      {data.invoices.some(invoice => invoice.status === "paid") && <section className="acct-card">
        <h2>Riwayat iuran</h2>
        <ul className="member-invoices">{data.invoices.filter(invoice => invoice.status === "paid").map(invoice => (
          <li key={invoice.id}><span><b>{invoice.kind === "daftar" ? "Pendaftaran" : "Perpanjangan"} {invoice.plan_name}</b><small>{invoice.number}{invoice.period_start ? ` · ${longDate(invoice.period_start)} – ${longDate(invoice.period_end!)}` : ""}</small></span><strong>{money(invoice.amount)}</strong></li>
        ))}</ul>
      </section>}
      {settings.terms && <details className="acct-card member-terms"><summary>Syarat & ketentuan member</summary><p>{settings.terms}</p></details>}
    </div>
  );
}

function PlanChoice({ plans, value, onChange, registration }: { plans: PublicPlan[]; value: string; onChange: (id: string) => void; registration: boolean }) {
  return (
    <div className="member-plans" role="radiogroup" aria-label="Pilih paket member">
      {plans.map(plan => (
        <label key={plan.id} className="member-plan" data-checked={value === plan.id}>
          <input type="radio" name="plan" value={plan.id} checked={value === plan.id} onChange={() => onChange(plan.id)} />
          <span className="member-plan-head"><b>{plan.name}</b><strong>{money(plan.price)}<small> / {monthsLabel(plan.duration_months)}</small></strong></span>
          <span className="member-plan-perk">Hemat {percentLabel(plan.court_discount)} sewa lapangan{plan.addon_discount ? `, ${percentLabel(plan.addon_discount)} raket & tambahan` : ""}</span>
          {plan.description && <small>{plan.description}</small>}
          {registration && plan.registration_fee > 0 && <small>Biaya pendaftaran sekali {money(plan.registration_fee)}</small>}
        </label>
      ))}
    </div>
  );
}

/** Belum ada pembayaran online: alasannya, dan apa yang bisa dilakukan pelanggan. */
function closedReason(data: MyMembership) {
  if (!data.settings.open) return "Pendaftaran member online sedang ditutup. Silakan daftar langsung di kasir venue.";
  if (!data.settings.online_payment) return "Pembayaran online belum tersedia. Daftar atau perpanjang member langsung di kasir venue.";
  if (!data.plans.length) return "Belum ada paket member yang dijual lewat situs. Tanyakan ke kasir venue.";
  return "";
}

function Join({ data, defaults }: { data: MyMembership; defaults: { name: string; phone: string } }) {
  const [planId, setPlanId] = useState(data.plans[0]?.id ?? "");
  const [name, setName] = useState(defaults.name), [phone, setPhone] = useState(defaults.phone), [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const plan = data.plans.find(item => item.id === planId), closed = closedReason(data);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { goPay(await joinMembership({ plan_id: planId, name: name.trim(), phone, agree })); }
    catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  return (
    <section className="acct-card">
      <h2>Jadi member</h2>
      <p>Member membayar iuran untuk masa berlaku tertentu, lalu mendapat potongan setiap kali memesan selama masa itu.</p>
      {data.plans.length > 0 && <PlanChoice plans={data.plans} value={planId} onChange={setPlanId} registration />}
      {closed ? <p className="shop-note warn">{closed}</p> : (
        <form className="acct-form" onSubmit={submit}>
          <label>Nama di kartu member<input required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Nomor WhatsApp<input required inputMode="tel" maxLength={20} value={phone} aria-invalid={phone !== "" && !validPhone(phone)} onChange={event => setPhone(event.target.value)} /><small>Untuk kabar masa berlaku dan pengingat perpanjangan.</small></label>
          <label className="member-agree"><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} /> <span>Saya menyetujui {data.settings.terms ? "syarat & ketentuan member di bawah" : "syarat & ketentuan member venue"}.</span></label>
          {data.settings.approval && <p className="shop-note">Pendaftaran diperiksa venue setelah dibayar. Masa berlaku dimulai saat disetujui.</p>}
          {error && <p className="shop-note error" role="alert">{error}</p>}
          <button className="shop-btn primary wide" type="submit" disabled={busy || !plan || !agree || !validPhone(phone)}>
            {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />} Bayar {plan ? money(plan.price + plan.registration_fee) : ""}
          </button>
          <small className="member-fine">Pajak, bila ada, ditambahkan di halaman pembayaran.</small>
        </form>
      )}
    </section>
  );
}

/** Sudah mengisi pendaftaran tetapi belum membayar: lanjutkan, atau ganti paket. */
function PendingSignup({ data, invoice, defaults, refresh }: { data: MyMembership; invoice?: MemberInvoice; defaults: { name: string; phone: string }; refresh: () => void }) {
  const [changing, setChanging] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function pay() {
    if (!invoice) return;
    setBusy(true); setError("");
    try { goPay(await payMembership(invoice.id)); } catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  if (changing) return <Join data={data} defaults={defaults} />;
  return (
    <section className="acct-card">
      <h2>Selesaikan pendaftaran member</h2>
      {invoice ? <p>{invoice.plan_name} · {monthsLabel(invoice.months)} · <b>{money(invoice.amount)}</b>. Keanggotaan aktif begitu pembayaran diterima.</p> : <p>Tagihan pendaftaran tidak ditemukan. Pilih paket lagi untuk membuat tagihan baru.</p>}
      {error && <p className="shop-note error" role="alert">{error}</p>}
      <div className="member-row-actions">
        {invoice && <button type="button" className="shop-btn primary" disabled={busy} onClick={() => void pay()}>{busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />} Bayar sekarang</button>}
        <button type="button" className="shop-btn outline" disabled={busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Cek status</button>
        <button type="button" className="shop-btn outline" disabled={busy} onClick={() => setChanging(true)}>Ganti paket</button>
      </div>
    </section>
  );
}

function Renew({ data, invoice, refresh }: { data: MyMembership; invoice?: MemberInvoice; refresh: () => void }) {
  const member = data.membership!;
  const [planId, setPlanId] = useState(data.plans.some(plan => plan.id === member.plan.id) ? member.plan.id : data.plans[0]?.id ?? "");
  const [open, setOpen] = useState(member.state === "expired" || (member.days_left ?? 99) <= 14);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const plan = data.plans.find(item => item.id === planId), closed = data.settings.online_payment ? (data.plans.length ? "" : "Perpanjangan lewat situs belum tersedia. Silakan perpanjang di kasir venue.") : "Pembayaran online belum tersedia. Silakan perpanjang di kasir venue.";
  async function run(work: () => Promise<MemberCheckout>) {
    setBusy(true); setError("");
    try { goPay(await work()); } catch (problem) { setError((problem as Error).message); setBusy(false); }
  }
  if (invoice) return (
    <section className="acct-card">
      <h2>Perpanjangan belum dibayar</h2>
      <p>{invoice.plan_name} · {monthsLabel(invoice.months)} · <b>{money(invoice.amount)}</b>. Periode baru menyambung setelah masa berlaku sekarang.</p>
      {error && <p className="shop-note error" role="alert">{error}</p>}
      <div className="member-row-actions">
        <button type="button" className="shop-btn primary" disabled={busy} onClick={() => void run(() => payMembership(invoice.id))}><CreditCard size={18} aria-hidden="true" /> Bayar sekarang</button>
        <button type="button" className="shop-btn outline" disabled={busy} onClick={refresh}><RefreshCw size={16} aria-hidden="true" /> Cek status</button>
      </div>
    </section>
  );
  return (
    <section className="acct-card">
      <h2>Perpanjang member</h2>
      <p>{member.state === "expired" ? "Masa berlaku baru dimulai hari pembayaran diterima." : "Bayar sekarang pun tidak ada hari yang hilang: periode baru menyambung setelah masa berlaku sekarang."}</p>
      {!open ? <button type="button" className="shop-btn outline" onClick={() => setOpen(true)}>Lihat paket perpanjangan</button> : closed ? <p className="shop-note warn">{closed}</p> : <>
        <PlanChoice plans={data.plans} value={planId} onChange={setPlanId} registration={false} />
        {error && <p className="shop-note error" role="alert">{error}</p>}
        <button type="button" className="shop-btn primary wide" disabled={busy || !plan} onClick={() => void run(() => renewMembership(planId))}>
          {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <CreditCard size={18} aria-hidden="true" />} Perpanjang {plan ? money(plan.price) : ""}
        </button>
      </>}
    </section>
  );
}

/** Member yang didaftarkan kasir menghubungkan kartunya ke akun ini. */
function Claim({ done }: { done: (data: MyMembership) => void }) {
  const [code, setCode] = useState(""), [phone, setPhone] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { done(await claimMembership({ code, phone })); toast.success("Kartu member terhubung ke akun Anda"); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="acct-card">
      <h2>Sudah daftar di kasir?</h2>
      <p>Hubungkan kartu member Anda supaya harga member juga berlaku saat memesan online.</p>
      <form className="acct-form" onSubmit={submit}>
        <div className="member-claim-fields">
          <label>Kode member<input required maxLength={20} value={code} placeholder="MBR-XXXXXX" autoCapitalize="characters" onChange={event => setCode(event.target.value)} /></label>
          <label>Nomor HP saat daftar<input required inputMode="tel" maxLength={20} value={phone} placeholder="0812 3456 7890" onChange={event => setPhone(event.target.value)} /></label>
        </div>
        {error && <p className="shop-note error" role="alert">{error}</p>}
        <button className="shop-btn outline wide" type="submit" disabled={busy || code.trim().length < 4 || !validPhone(phone)}>
          {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <KeyRound size={18} aria-hidden="true" />} Hubungkan kartu member
        </button>
      </form>
    </section>
  );
}
