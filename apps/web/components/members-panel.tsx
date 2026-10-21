"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarClock, CircleDollarSign, Clock3, Hourglass, Pencil, Plus, Settings2, Snowflake, Tags, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { formatShortDay } from "@/lib/shop";
import { type Member, type MemberDetail, type MemberSettings, type MemberSlot, type MemberStats, type Plan, discountSummary, methodName, monthsLabel, percentLabel, quotaSummary, stateLabel, stateTone } from "@/lib/members";
import { type PriceRule, dayShort, formatDays, timeSlots, weekOrder } from "@/lib/operations";
import { ErrorBox, Modal, Submit } from "./operation-ui";
import { DateInput, MoneyInput, Select } from "./form-controls";

type CourtBrief = { id: string; name: string; hourly_rate: number; active: number };
type Data = {
  members: Member[]; stats: MemberStats; plans: Plan[]; settings: MemberSettings; date: string; time: string; timezone: string;
  price_rules: PriceRule[]; courts: CourtBrief[]; member_slots: MemberSlot[];
};
type Tab = "member" | "paket" | "jam" | "pengaturan";
type Method = "cash" | "transfer" | "qris";
const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "member", label: "Daftar member", icon: Users },
  { id: "paket", label: "Paket & harga", icon: Tags },
  { id: "jam", label: "Jam khusus member", icon: Clock3 },
  { id: "pengaturan", label: "Pengaturan", icon: Settings2 },
];
const stateFilters: [string, string][] = [["", "Semua status"], ["active", "Aktif"], ["expiring", "Segera berakhir"], ["pending_payment", "Belum bayar"], ["pending_approval", "Menunggu persetujuan"], ["frozen", "Dibekukan"], ["expired", "Berakhir"], ["cancelled", "Dibatalkan"]];
const fail = (error: unknown) => toast.error((error as Error).message);

/** Menu Operasional → Member: daftar member, paket dan potongannya, serta pengaturan pendaftaran. */
export function MembersPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("member");
  const [query, setQuery] = useState(""), [state, setState] = useState("");
  const [registering, setRegistering] = useState(false), [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async (q = query, s = state) => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (s) params.set("state", s);
      setData(await api<Data>(`/operations/members${params.size ? "?" + params : ""}`)); setError("");
    } catch (problem) { setError((problem as Error).message); }
  }, [query, state]);
  // Pencarian dikirim ke server setelah berhenti mengetik sebentar.
  useEffect(() => { const timer = setTimeout(() => void load(query, state), query ? 300 : 0); return () => clearTimeout(timer); }, [query, state, load]);
  const closeRegister = useCallback(() => setRegistering(false), []);
  const closeDetail = useCallback(() => setOpenId(null), []);
  const reload = useCallback(() => void load(), [load]);

  if (!data) return error ? <ErrorBox message={error} retry={() => void load()} /> : <p className="empty-state">Memuat data member…</p>;
  const { stats } = data, activePlans = data.plans.filter(plan => plan.active);
  const metrics = [
    { label: "Member aktif", value: String(stats.active), hint: stats.frozen ? `${stats.frozen} sedang dibekukan` : `${stats.joined} bergabung bulan ini`, Icon: BadgeCheck, tone: "violet" },
    { label: "Segera berakhir", value: String(stats.expiring), hint: stats.waiting ? `${stats.waiting} pendaftar belum selesai` : `Dalam ${Math.max(data.settings.reminder_days, 7)} hari ke depan`, Icon: Hourglass, tone: "orange" },
    { label: "Pendapatan member", value: money(stats.revenue), hint: `Diakui bulan ini · uang masuk ${money(stats.collected)}`, Icon: CircleDollarSign, tone: "lime" },
    { label: "Potongan member", value: money(stats.discount), hint: "Booking yang main dan transaksi kasir bulan ini", Icon: Tags, tone: "cyan" },
  ];

  return (
    <div className="cms">
      {error && <ErrorBox message={error} retry={() => void load()} />}
      <div className="cms-tabs" role="tablist" aria-label="Bagian member">
        {tabs.map(item => (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} onClick={() => setTab(item.id)}>
            <item.icon size={16} aria-hidden="true" /><span>{item.label}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-member" aria-labelledby="tab-member" hidden={tab !== "member"}>
        <div className="ops-actions">
          <p>Member mendapat potongan otomatis saat booking selama masa berlakunya. Daftarkan di kasir, atau biarkan pelanggan mendaftar sendiri dari akunnya.</p>
          <button className="ops-primary" disabled={!activePlans.length} title={activePlans.length ? undefined : "Buat paket member terlebih dahulu"} onClick={() => setRegistering(true)}><UserPlus size={16} /> Daftarkan member</button>
        </div>
        <div className="metric-grid addon-metrics">{metrics.map(({ label, value, hint, Icon, tone }) => <article key={label} className={`metric-card ${tone}`}><div className="metric-top"><span><Icon /></span></div><p>{label}</p><h2>{value}</h2><small>{hint}</small></article>)}</div>
        {!data.plans.length ? (
          <div className="ops-empty">
            <h2>Belum ada paket member</h2>
            <p>Buat paket lebih dulu, mis. “Member Bulanan” dengan diskon lapangan 20%. Setelah itu member bisa didaftarkan.</p>
            <button className="ops-primary" onClick={() => setTab("paket")}><Plus size={15} /> Buat paket</button>
          </div>
        ) : <>
          <div className="ops-filters">
            <label>Cari member<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nama, kode member, email, atau nomor HP" /></label>
            <label>Status<Select value={state} onChange={event => setState(event.target.value)}>{stateFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
          </div>
          <div className="manage-table-card ops-table table-cards">
            <table>
              <thead><tr><th>Member</th><th>Paket</th><th>Masa berlaku</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>{data.members.map(member => (
                <tr key={member.id}>
                  <td className="wide" data-label="Member"><b>{member.name}</b><small className="table-description">{member.code} · {member.phone}{member.account ? " · akun terhubung" : ""}</small></td>
                  <td data-label="Paket">{member.plan.name}<small className="table-description">{discountSummary(member.plan)}</small></td>
                  <td data-label="Masa berlaku">{member.starts_on && member.ends_on ? <>{formatShortDay(member.starts_on)} – {formatShortDay(member.ends_on)}</> : "—"}{member.days_left !== null && <small className="table-description">{member.state === "frozen" ? "Dibekukan sejak " + formatShortDay(member.frozen_on!) : `Sisa ${member.days_left} hari`}</small>}</td>
                  <td data-label="Status"><span className={`status-pill ${stateTone[member.state]}`}>{stateLabel[member.state]}</span><small className="table-description">{member.source === "online" ? "Daftar online" : "Daftar di kasir"}</small></td>
                  <td className="actions"><button className="ops-secondary" onClick={() => setOpenId(member.id)}>Buka</button></td>
                </tr>
              ))}</tbody>
            </table>
            {!data.members.length && <p className="empty-state">{query || state ? "Tidak ada member yang cocok." : "Belum ada member. Klik Daftarkan member untuk mulai."}</p>}
          </div>
        </>}
      </div>

      <div role="tabpanel" id="panel-paket" aria-labelledby="tab-paket" hidden={tab !== "paket"}>
        <PlansTab plans={data.plans} rules={data.price_rules} courts={data.courts} hasSlots={data.member_slots.length > 0} changed={reload} />
      </div>
      <div role="tabpanel" id="panel-jam" aria-labelledby="tab-jam" hidden={tab !== "jam"}>
        <SlotsTab slots={data.member_slots} courts={data.courts} plans={data.plans} saved={member_slots => setData(current => current && { ...current, member_slots })} />
      </div>
      <div role="tabpanel" id="panel-pengaturan" aria-labelledby="tab-pengaturan" hidden={tab !== "pengaturan"}>
        <SettingsTab key={data.settings.updated_at ?? "awal"} settings={data.settings} saved={settings => setData(current => current && { ...current, settings })} />
      </div>

      {registering && <RegisterModal plans={activePlans} close={closeRegister} done={detail => { closeRegister(); void load(); setOpenId(detail.member.id); }} />}
      {openId && <MemberModal id={openId} plans={activePlans} today={data.date} close={closeDetail} changed={reload} />}
    </div>
  );
}

function MethodField({ value, onChange, allowLater = false }: { value: Method | ""; onChange: (value: Method | "") => void; allowLater?: boolean }) {
  return (
    <fieldset className="chip-field"><legend>Pembayaran</legend>
      <div className="chip-group">
        {(["cash", "transfer", "qris"] as Method[]).map(method => <button type="button" key={method} aria-pressed={value === method} onClick={() => onChange(method)}>{methodName[method]}</button>)}
        {allowLater && <button type="button" aria-pressed={value === ""} onClick={() => onChange("")}>Bayar nanti</button>}
      </div>
    </fieldset>
  );
}

/** Ringkasan biaya paket: iuran, biaya daftar, total sebelum pajak. */
function PlanCost({ plan, registration }: { plan: Plan; registration: boolean }) {
  const fee = registration ? plan.registration_fee : 0;
  return (
    <div className="member-cost">
      <div className="ops-total"><span>Iuran {monthsLabel(plan.duration_months)}</span><strong>{money(plan.price)}</strong></div>
      {fee > 0 && <div className="ops-total"><span>Biaya pendaftaran</span><strong>{money(fee)}</strong></div>}
      <div className="ops-total"><span>Total{fee > 0 ? "" : " tagihan"}</span><strong>{money(plan.price + fee)}</strong></div>
      <p className="ops-muted">Potongan: {discountSummary(plan)}. Pajak, bila diatur di Keuangan, ditambahkan saat tagihan dibuat.</p>
    </div>
  );
}

function RegisterModal({ plans, close, done }: { plans: Plan[]; close: () => void; done: (detail: MemberDetail) => void }) {
  const [form, setForm] = useState({ plan_id: plans[0]?.id ?? "", name: "", phone: "", email: "", notes: "" });
  const [method, setMethod] = useState<Method | "">("cash");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const plan = plans.find(item => item.id === form.plan_id);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const detail = await api<MemberDetail>("/operations/members", { method: "POST", body: JSON.stringify({ ...form, method: method || null }) });
      toast.success(method ? `${detail.member.name} aktif sampai ${formatShortDay(detail.member.ends_on!)}` : `Tagihan pendaftaran ${detail.member.name} dibuat`);
      done(detail);
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Daftarkan member" close={close}>
      <form onSubmit={submit}>
        <div className="modal-fields">
          {error && <ErrorBox message={error} />}
          <label>Paket<Select required value={form.plan_id} onChange={event => setForm({ ...form, plan_id: event.target.value })}>{plans.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.price)} / {monthsLabel(item.duration_months)}</option>)}</Select></label>
          {plan && <PlanCost plan={plan} registration />}
          <div className="field-grid">
            <label>Nama lengkap<input autoFocus required minLength={2} maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
            <label>Nomor HP / WhatsApp<input required type="tel" minLength={9} maxLength={20} value={form.phone} placeholder="0812 3456 7890" onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
          </div>
          <label>Email (opsional)<input type="email" maxLength={120} value={form.email} placeholder="Untuk kwitansi dan pengingat masa berlaku" onChange={event => setForm({ ...form, email: event.target.value })} /></label>
          <label>Catatan (opsional)<input maxLength={300} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
          <MethodField value={method} onChange={setMethod} allowLater />
          <p className="ops-muted">{method ? "Pastikan uang sudah diterima. Keanggotaan langsung aktif mulai hari ini." : "Tagihan dibuat dan member aktif setelah pembayarannya dicatat dari detail member."}</p>
        </div>
        <div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy}>{method ? "Daftarkan & catat bayar" : "Daftarkan"}</Submit></div>
      </form>
    </Modal>
  );
}

type Action = "" | "renew" | "edit" | "cancel";
function MemberModal({ id, plans, today, close, changed }: { id: string; plans: Plan[]; today: string; close: () => void; changed: () => void }) {
  const [data, setData] = useState<MemberDetail | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [action, setAction] = useState<Action>("");
  const load = useCallback(async () => { try { setData(await api<MemberDetail>(`/operations/members/${id}`)); setError(""); } catch (problem) { setError((problem as Error).message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function run(path: string, body: unknown, message: string) {
    setBusy(true); setError("");
    try { setData(await api<MemberDetail>(`/operations/members/${id}${path}`, { method: path ? "POST" : "PUT", body: JSON.stringify(body) })); setAction(""); toast.success(message); changed(); return true; }
    catch (problem) { setError((problem as Error).message); return false; } finally { setBusy(false); }
  }
  const member = data?.member;
  const pending = data?.invoices.find(invoice => invoice.status === "pending");
  const [payMethod, setPayMethod] = useState<Method | "">("cash");
  const canRenew = member && (member.status === "active" || member.status === "frozen");

  return (
    <Modal title="Detail member" close={close}>
      <div className="modal-fields">
        {error && <ErrorBox message={error} retry={!data ? load : undefined} />}
        {!member || !data ? <p>Memuat member…</p> : <>
          <div className="member-card" aria-label="Kartu member">
            <div><small>{member.plan.name}</small><h3>{member.name}</h3><p>{member.phone}{member.email ? ` · ${member.email}` : ""}</p></div>
            <div className="member-card-side"><span className={`status-pill ${stateTone[member.state]}`}>{stateLabel[member.state]}</span><code>{member.code}</code></div>
          </div>
          <dl className="member-facts">
            <div><dt>Masa berlaku</dt><dd>{member.starts_on && member.ends_on ? `${formatShortDay(member.starts_on)} – ${formatShortDay(member.ends_on)}` : "Belum dimulai"}</dd></div>
            <div><dt>{member.state === "frozen" ? "Dibekukan sejak" : "Sisa"}</dt><dd>{member.state === "frozen" ? formatShortDay(member.frozen_on!) : member.days_left !== null ? `${member.days_left} hari` : "—"}</dd></div>
            <div><dt>Potongan</dt><dd>{discountSummary(member.plan)}</dd></div>
            <div><dt>Total hemat</dt><dd>{money(data.totals.saved)} · {data.totals.bookings} booking{data.totals.sales ? ` · ${data.totals.sales} transaksi kasir` : ""}</dd></div>
          </dl>
          {member.notes && <p className="ops-muted">Catatan: {member.notes}</p>}
          {member.state === "cancelled" && <p className="ops-muted">Dibatalkan: {member.cancel_reason}{member.refund_amount ? ` · dikembalikan ${money(member.refund_amount)}` : ""}</p>}

          {member.status === "pending_approval" && <section className="ops-payment">
            <h3>Menunggu persetujuan</h3>
            <p className="ops-muted">Iuran sudah dibayar online. Setujui agar masa berlakunya dimulai hari ini, atau batalkan dan kembalikan iurannya.</p>
            <button type="button" className="ops-primary" disabled={busy} onClick={() => void run("/approve", {}, `${member.name} disetujui`)}><BadgeCheck size={15} /> Setujui member</button>
          </section>}

          {pending && member.status !== "cancelled" && <section className="ops-payment">
            <h3>Tagihan belum dibayar · {money(pending.amount)}</h3>
            <p className="ops-muted">{pending.number} · {pending.kind === "daftar" ? "Pendaftaran" : "Perpanjangan"} {pending.plan_name} {monthsLabel(pending.months)}{pending.pay_url ? ". Pelanggan juga sedang dapat membayarnya online." : "."}</p>
            <MethodField value={payMethod} onChange={setPayMethod} />
            <button type="button" className="ops-primary" disabled={busy || !payMethod} onClick={() => void run(`/invoices/${pending.id}/pay`, { method: payMethod }, "Pembayaran member dicatat")}>Catat pembayaran</button>
          </section>}

          {member.state !== "cancelled" && <div className="member-actions">
            {canRenew && <button type="button" className="ops-secondary" disabled={busy} aria-pressed={action === "renew"} onClick={() => setAction(action === "renew" ? "" : "renew")}><CalendarClock size={14} /> Perpanjang</button>}
            {member.state === "active" && <button type="button" className="ops-secondary" disabled={busy} onClick={() => { if (confirm(`Bekukan keanggotaan ${member.name}? Harga member tidak berlaku selama dibekukan, dan hari yang dibekukan ditambahkan saat diaktifkan lagi.`)) void run("/freeze", { frozen: true }, "Keanggotaan dibekukan"); }}><Snowflake size={14} /> Bekukan</button>}
            {member.state === "frozen" && <button type="button" className="ops-secondary" disabled={busy} onClick={() => void run("/freeze", { frozen: false }, "Keanggotaan aktif kembali")}><Snowflake size={14} /> Aktifkan lagi</button>}
            <button type="button" className="ops-secondary" disabled={busy} aria-pressed={action === "edit"} onClick={() => setAction(action === "edit" ? "" : "edit")}><Pencil size={14} /> Ubah data</button>
            <button type="button" className="ops-danger" disabled={busy} aria-pressed={action === "cancel"} onClick={() => setAction(action === "cancel" ? "" : "cancel")}>Batalkan</button>
          </div>}
          {action === "renew" && member && <RenewForm member={member} plans={plans} busy={busy} today={today} submit={(body, message) => run("/renew", body, message)} />}
          {action === "edit" && <EditForm detail={data} busy={busy} submit={body => run("", body, "Data member disimpan")} />}
          {action === "cancel" && <CancelForm detail={data} busy={busy} submit={body => run("/cancel", body, "Keanggotaan dibatalkan")} />}

          {!member.account && data.account_suggestions.length > 0 && member.state !== "cancelled" && <section className="booking-account" aria-label="Akun pelanggan">
            <h3>Akun pelanggan</h3>
            <p>Ada akun Google dengan nomor yang sama. Hubungkan hanya bila Anda yakin itu orang yang sama. Setelah terhubung, harga member berlaku juga saat ia memesan online.</p>
            {data.account_suggestions.map(account => <div className="booking-account-row" key={account.id}><div><b>{account.name}</b><small>{account.email}</small></div><button type="button" className="ops-secondary" disabled={busy} onClick={() => void run("", { name: member.name, phone: member.phone, email: member.email, notes: member.notes, account_id: account.id }, "Akun terhubung")}>Hubungkan</button></div>)}
          </section>}
          {member.account && <section className="booking-account" aria-label="Akun pelanggan">
            <h3>Akun pelanggan</h3>
            <div className="booking-account-row"><div><b>{member.account.name}</b><small>{member.account.email}</small></div>{member.state !== "cancelled" && <button type="button" className="ops-link-button" disabled={busy} onClick={() => void run("", { name: member.name, phone: member.phone, email: member.email, notes: member.notes, account_id: null }, "Kaitan akun dilepas")}>Lepas kaitan</button>}</div>
          </section>}

          <h3>Tagihan & iuran</h3>
          {data.invoices.map(invoice => (
            <div className="ops-history" key={invoice.id}>
              <div><b>{invoice.kind === "daftar" ? "Pendaftaran" : "Perpanjangan"} · {invoice.plan_name} {monthsLabel(invoice.months)}</b>
                <small>{invoice.number} · {invoice.status === "paid" ? `Lunas ${new Date(invoice.paid_at!).toLocaleDateString("id-ID", { dateStyle: "medium" })} · ${methodName[invoice.method ?? ""] ?? (invoice.online ? "Online" : invoice.method)}` : invoice.status === "pending" ? "Belum dibayar" : "Ditutup"}{invoice.period_start ? ` · ${formatShortDay(invoice.period_start)} – ${formatShortDay(invoice.period_end!)}` : ""}</small></div>
              <strong>{money(invoice.amount)}</strong>
            </div>
          ))}
          <h3>Booking dengan harga member</h3>
          {data.bookings.length ? data.bookings.map(booking => (
            <div className="ops-history" key={booking.id}>
              <div><b>{booking.court_name} · {formatShortDay(booking.date)} {booking.start_time}</b><small>{booking.code} · hemat {money(booking.member_discount)}{booking.status === "cancelled" || booking.status === "expired" ? " · batal" : ""}</small></div>
              <strong>{money(booking.total)}</strong>
            </div>
          )) : <p className="ops-muted">Belum ada booking yang memakai harga member.</p>}
        </>}
      </div>
      <div className="modal-actions"><button type="button" onClick={close}>Tutup</button></div>
    </Modal>
  );
}

function RenewForm({ member, plans, busy, today, submit }: { member: Member; plans: Plan[]; busy: boolean; today: string; submit: (body: unknown, message: string) => Promise<boolean> }) {
  const [planId, setPlanId] = useState(plans.some(plan => plan.id === member.plan.id) ? member.plan.id : plans[0]?.id ?? "");
  const [method, setMethod] = useState<Method | "">("cash");
  const plan = plans.find(item => item.id === planId);
  const continues = !!member.ends_on && member.ends_on >= today;
  return (
    <form className="ops-payment" onSubmit={event => { event.preventDefault(); void submit({ plan_id: planId, method: method || null }, method ? "Keanggotaan diperpanjang" : "Tagihan perpanjangan dibuat"); }}>
      <h3>Perpanjang keanggotaan</h3>
      <label>Paket<Select value={planId} onChange={event => setPlanId(event.target.value)}>{plans.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.price)} / {monthsLabel(item.duration_months)}</option>)}</Select></label>
      {plan && <PlanCost plan={plan} registration={false} />}
      <p className="ops-muted">{continues ? `Periode baru menyambung setelah ${formatShortDay(member.ends_on!)}, jadi sisa hari tidak hilang.` : "Masa berlaku sudah lewat, jadi periode baru dimulai hari ini."}</p>
      <MethodField value={method} onChange={setMethod} allowLater />
      <Submit busy={busy || !plan}>{method ? "Perpanjang & catat bayar" : "Buat tagihan"}</Submit>
    </form>
  );
}

function EditForm({ detail, busy, submit }: { detail: MemberDetail; busy: boolean; submit: (body: unknown) => Promise<boolean> }) {
  const { member } = detail;
  const [form, setForm] = useState({ name: member.name, phone: member.phone, email: member.email, notes: member.notes, ends_on: member.ends_on ?? "" });
  const dated = member.status === "active" || member.status === "frozen";
  return (
    <form className="ops-payment" onSubmit={event => { event.preventDefault(); void submit({ ...form, account_id: member.account?.id ?? null, ends_on: dated ? form.ends_on : undefined }); }}>
      <h3>Ubah data member</h3>
      <div className="field-grid">
        <label>Nama<input required minLength={2} maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Nomor HP<input required type="tel" minLength={9} maxLength={20} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label>
      </div>
      <label>Email<input type="email" maxLength={120} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
      <label>Catatan<input maxLength={300} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      {dated && <label>Berlaku sampai<DateInput required min={member.starts_on ?? undefined} value={form.ends_on} onChange={event => setForm({ ...form, ends_on: event.target.value })} /><small className="field-hint">Ubah hanya untuk koreksi atau kompensasi, mis. lapangan tutup seminggu. Perubahan tercatat di log aktivitas.</small></label>}
      <Submit busy={busy}>Simpan data</Submit>
    </form>
  );
}

function CancelForm({ detail, busy, submit }: { detail: MemberDetail; busy: boolean; submit: (body: unknown) => Promise<boolean> }) {
  const [reason, setReason] = useState(""), [refund, setRefund] = useState(0), [method, setMethod] = useState<Method | "">("cash");
  return (
    <form className="ops-payment" onSubmit={event => { event.preventDefault(); if (confirm(`Batalkan keanggotaan ${detail.member.name}? Tindakan ini tidak dapat dibatalkan.`)) void submit({ reason, refund, method: method || "cash" }); }}>
      <h3>Batalkan keanggotaan</h3>
      <p className="ops-muted">Iuran yang belum terpakai: <b>{money(detail.unearned)}</b>. Boleh dikembalikan sebagian atau seluruhnya; sisanya diakui sebagai pendapatan. Biaya pendaftaran tidak dikembalikan.</p>
      <label>Alasan<input required minLength={3} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} placeholder="Mis. pindah kota" /></label>
      <div className="field-grid">
        <label>Dikembalikan<MoneyInput min={0} max={detail.unearned} value={refund} onChange={event => setRefund(Number(event.target.value) || 0)} /></label>
        {refund > 0 && <label>Lewat<Select value={method} onChange={event => setMethod(event.target.value as Method)}><option value="cash">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option></Select></label>}
      </div>
      <button type="submit" className="ops-danger" disabled={busy || reason.trim().length < 3 || refund > detail.unearned}>Batalkan keanggotaan</button>
    </form>
  );
}

// --- Paket ------------------------------------------------------------------------

type PlanForm = {
  name: string; description: string; price: number; registration_fee: number; duration_months: number; court_discount: number; addon_discount: number; online: boolean; active: boolean;
  daily_hours: number; monthly_hours: number; member_slots: boolean;
  /** Tarif tetap per tarif lapangan; kosong = pakai diskon persen. */
  rates: Record<string, number | "">;
};
const planForm = (plan: Plan | null): PlanForm => plan
  ? {
    name: plan.name, description: plan.description, price: plan.price, registration_fee: plan.registration_fee, duration_months: plan.duration_months, court_discount: plan.court_discount / 100, addon_discount: plan.addon_discount / 100, online: !!plan.online, active: !!plan.active,
    daily_hours: (plan.daily_minutes ?? 0) / 60, monthly_hours: (plan.monthly_minutes ?? 0) / 60, member_slots: plan.member_slots === undefined ? true : !!plan.member_slots,
    rates: Object.fromEntries(plan.rates.map(rate => [rate.rule_key, rate.hourly_rate])),
  }
  : { name: "", description: "", price: 300000, registration_fee: 0, duration_months: 1, court_discount: 20, addon_discount: 0, online: true, active: true, daily_hours: 0, monthly_hours: 0, member_slots: true, rates: {} };
/** Nama tarif lapangan untuk tarif tetap; `normal` = tarif dasar lapangan di luar tarif khusus. */
function rateRows(rules: PriceRule[], courts: CourtBrief[]) {
  const active = courts.filter(court => court.active);
  const low = Math.min(...active.map(court => court.hourly_rate)), high = Math.max(...active.map(court => court.hourly_rate));
  const range = !active.length ? "" : low === high ? `${money(low)}/jam` : `${money(low)}–${money(high)}/jam`;
  return [
    { key: "normal", label: "Tarif reguler", hint: `Jam tanpa tarif khusus${range ? " · normal " + range : ""}` },
    ...rules.map(rule => {
      // Tarif khusus bisa bernama sama untuk lapangan berbeda; nama lapangan membedakannya.
      const names = rule.court_ids.map(id => courts.find(court => court.id === id)?.name).filter(Boolean);
      return { key: rule.id, label: rule.label, hint: `${names.length === courts.length ? "Semua lapangan" : names.join(", ")} · ${formatDays(rule.days)} ${rule.start_time}–${rule.end_time} · normal ${money(rule.hourly_rate)}/jam` };
    }),
  ];
}

function PlansTab({ plans, rules, courts, hasSlots, changed }: { plans: Plan[]; rules: PriceRule[]; courts: CourtBrief[]; hasSlots: boolean; changed: () => void }) {
  const [editing, setEditing] = useState<Plan | null | undefined>();
  const close = useCallback(() => setEditing(undefined), []);
  const names = useMemo(() => new Map(rateRows(rules, courts).map(row => [row.key, row.label])), [rules, courts]);
  async function remove(plan: Plan) {
    if (!confirm(`Hapus paket ${plan.name}?`)) return;
    try { await api(`/operations/members/plans/${plan.id}`, { method: "DELETE" }); toast.success(`${plan.name} dihapus`); changed(); } catch (problem) { fail(problem); }
  }
  return <>
    <div className="ops-actions">
      <p>Harga member berupa potongan persen dari harga normal, atau tarif tetap per jam untuk tarif lapangan tertentu (mis. jam sepi). Mengubah paket tidak mengubah booking yang sudah dibuat.</p>
      <button className="ops-primary" onClick={() => setEditing(null)}><Plus size={16} /> Tambah paket</button>
    </div>
    <div className="manage-table-card ops-table table-cards">
      <table>
        <thead><tr><th>Paket</th><th>Iuran</th><th>Harga member</th><th>Member</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>{plans.map(plan => {
          const fixed = plan.rates.filter(rate => names.has(rate.rule_key)), quota = quotaSummary(plan);
          return (
            <tr key={plan.id} className={plan.active ? "" : "inactive"}>
              <td className="wide" data-label="Paket"><b>{plan.name}</b>{plan.description && <small className="table-description">{plan.description}</small>}</td>
              <td data-label="Iuran">{money(plan.price)}<small className="table-description">per {monthsLabel(plan.duration_months)}{plan.registration_fee ? ` · daftar ${money(plan.registration_fee)}` : ""}</small></td>
              <td className="wide" data-label="Harga member">Lapangan {percentLabel(plan.court_discount)} · tambahan {percentLabel(plan.addon_discount)}
                {fixed.map(rate => <small key={rate.rule_key} className="table-description">Tarif tetap {names.get(rate.rule_key)}: {money(rate.hourly_rate)}/jam</small>)}
                {quota && <small className="table-description">Maks {quota}</small>}
                {hasSlots && <small className="table-description">{plan.member_slots ? "Boleh jam khusus member" : "Tanpa jam khusus member"}</small>}
              </td>
              <td data-label="Member">{plan.members}</td>
              <td data-label="Status"><span className={`status-pill ${plan.active ? "on" : "off"}`}>{plan.active ? "Dijual" : "Tidak dijual"}</span><small className="table-description">{!plan.active ? "Member lama tetap berlaku" : plan.online ? "Kasir & online" : "Khusus kasir"}</small></td>
              <td className="actions"><div className="row-actions">
                <button onClick={() => setEditing(plan)} aria-label={`Ubah ${plan.name}`}><Pencil /></button>
                <button className="delete" disabled={plan.members > 0} onClick={() => void remove(plan)} aria-label={`Hapus ${plan.name}`} title={plan.members ? "Masih dipakai member. Hentikan penjualannya saja." : "Hapus"}><Trash2 /></button>
              </div></td>
            </tr>
          );
        })}</tbody>
      </table>
      {!plans.length && <div className="ops-empty"><h2>Belum ada paket</h2><p>Contoh: Member Bulanan Rp300.000 per bulan dengan diskon lapangan 20%, atau Member Tahunan dengan diskon lebih besar.</p></div>}
    </div>
    {editing !== undefined && <PlanModal plan={editing} rules={rules} courts={courts} close={close} done={() => { close(); changed(); }} />}
  </>;
}

function PlanModal({ plan, rules, courts, close, done }: { plan: Plan | null; rules: PriceRule[]; courts: CourtBrief[]; close: () => void; done: () => void }) {
  const [form, setForm] = useState<PlanForm>(() => planForm(plan));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm(current => ({ ...current, [key]: value }));
  const example = useMemo(() => Math.round(200000 * form.court_discount / 100), [form.court_discount]);
  const rows = useMemo(() => rateRows(rules, courts), [rules, courts]);
  const [showRates, setShowRates] = useState(() => !!plan?.rates.length);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const rates = rows.flatMap(row => form.rates[row.key] === "" || form.rates[row.key] === undefined ? [] : [{ rule_key: row.key, hourly_rate: Number(form.rates[row.key]) }]);
    try {
      await api(`/operations/members/plans${plan ? "/" + plan.id : ""}`, { method: plan ? "PUT" : "POST", body: JSON.stringify({ ...form, rates: showRates ? rates : [] }) });
      toast.success(plan ? "Paket diperbarui" : "Paket ditambahkan"); done();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={plan ? `Ubah ${plan.name}` : "Tambah paket member"} close={close}>
      <form onSubmit={submit}>
        <div className="modal-fields">
          {error && <ErrorBox message={error} />}
          <label>Nama paket<input autoFocus required minLength={2} maxLength={60} value={form.name} onChange={event => set("name", event.target.value)} placeholder="Mis. Member Bulanan" /></label>
          <label>Deskripsi untuk pelanggan (opsional)<textarea rows={2} maxLength={400} value={form.description} onChange={event => set("description", event.target.value)} placeholder="Mis. Cocok untuk yang main tiap minggu." /></label>
          <div className="field-grid">
            <label>Iuran<MoneyInput required min={1000} max={100000000} value={form.price} onChange={event => set("price", Number(event.target.value) || 0)} /></label>
            <label>Masa berlaku<Select value={String(form.duration_months)} onChange={event => set("duration_months", Number(event.target.value))}>{[1, 3, 6, 12, 24].map(months => <option key={months} value={months}>{monthsLabel(months)}</option>)}</Select></label>
          </div>
          <label>Biaya pendaftaran (opsional)<MoneyInput min={0} max={100000000} value={form.registration_fee} onChange={event => set("registration_fee", Number(event.target.value) || 0)} /><small className="field-hint">Ditagih sekali saat mendaftar, tidak saat perpanjangan.</small></label>
          <h3 className="modal-subhead">Harga member</h3>
          <div className="field-grid">
            <label>Diskon sewa lapangan (%)<input type="number" required min={0} max={100} step={0.5} value={form.court_discount} onChange={event => set("court_discount", Number(event.target.value))} /></label>
            <label>Diskon raket & tambahan (%)<input type="number" min={0} max={100} step={0.5} value={form.addon_discount} onChange={event => set("addon_discount", Number(event.target.value))} /></label>
          </div>
          <p className="ops-muted">Contoh: sewa {money(200000)} menjadi <b>{money(200000 - example)}</b> untuk member. Diskon tambahan juga berlaku di transaksi kasir. Biaya lain yang diketik manual tidak didiskon.</p>
          {!showRates ? <button type="button" className="ops-link-button" onClick={() => setShowRates(true)}><Plus size={13} aria-hidden="true" /> Tarif tetap per jam untuk tarif tertentu</button> : (
            <fieldset className="member-rates">
              <legend>Tarif tetap member per jam <small>kosongkan untuk memakai diskon persen</small></legend>
              {rows.map(row => (
                <label key={row.key} className="member-rate-row">
                  <span className="member-rate-name"><b>{row.label}</b><small>{row.hint}</small></span>
                  <MoneyInput min={0} max={10000000} value={form.rates[row.key] ?? ""} placeholder={`Diskon ${form.court_discount.toLocaleString("id-ID")}%`}
                    onChange={event => set("rates", { ...form.rates, [row.key]: event.target.value === "" ? "" : Number(event.target.value) })} />
                </label>
              ))}
              <small className="field-hint">Mis. jam sepi normal Rp200.000, member Rp150.000. Bila tarif tetap lebih mahal dari harga normal, member membayar harga normal.</small>
            </fieldset>
          )}
          <h3 className="modal-subhead">Batas & akses</h3>
          <div className="field-grid">
            <label>Maks jam harga member per hari<input type="number" min={0} max={24} step={0.5} value={form.daily_hours} onChange={event => set("daily_hours", Number(event.target.value))} /></label>
            <label>Maks jam per bulan<input type="number" min={0} max={744} step={0.5} value={form.monthly_hours} onChange={event => set("monthly_hours", Number(event.target.value))} /></label>
          </div>
          <p className="ops-muted">Isi 0 untuk tanpa batas. Lewat batas, member tetap bisa booking dengan harga lapangan normal. Mencegah harga member dipakai untuk memesan atas nama orang lain.</p>
          <label className="switch-field"><input type="checkbox" checked={form.member_slots} onChange={event => set("member_slots", event.target.checked)} /> Boleh memesan jam khusus member</label>
          <label className="switch-field"><input type="checkbox" checked={form.active} onChange={event => set("active", event.target.checked)} /> Paket dijual</label>
          <label className="switch-field"><input type="checkbox" checked={form.online && form.active} disabled={!form.active} onChange={event => set("online", event.target.checked)} /> Bisa dibeli pelanggan lewat situs</label>
        </div>
        <div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy} /></div>
      </form>
    </Modal>
  );
}

// --- Jam khusus member ------------------------------------------------------------

function SlotsTab({ slots, courts, plans, saved }: { slots: MemberSlot[]; courts: CourtBrief[]; plans: Plan[]; saved: (slots: MemberSlot[]) => void }) {
  const [editing, setEditing] = useState<MemberSlot | null | undefined>();
  const close = useCallback(() => setEditing(undefined), []);
  const courtName = (id: string) => courts.find(court => court.id === id)?.name ?? "Lapangan dihapus";
  const excluded = plans.filter(plan => plan.active && !plan.member_slots).map(plan => plan.name);
  async function remove(slot: MemberSlot) {
    if (!confirm(`Hapus jam khusus ${slot.label}? Jam itu kembali bisa dipesan semua pelanggan.`)) return;
    try { saved((await api<{ member_slots: MemberSlot[] }>(`/operations/members/slots/${slot.id}`, { method: "DELETE" })).member_slots); toast.success(`${slot.label} dihapus`); } catch (problem) { fail(problem); }
  }
  return <>
    <div className="ops-actions">
      <p>Jam yang hanya bisa dipesan member, mis. Sabtu pagi. Di situs, jam ini tampil dengan label Member dan hanya bisa dipesan pelanggan yang masuk dengan akun member. Booking yang sudah ada tidak berubah.{excluded.length ? ` Paket ${excluded.join(", ")} tidak termasuk.` : ""}</p>
      <button className="ops-primary" disabled={!courts.length} onClick={() => setEditing(null)}><Plus size={16} /> Tambah jam khusus</button>
    </div>
    <div className="manage-table-card ops-table table-cards">
      <table>
        <thead><tr><th>Nama</th><th>Hari</th><th>Jam</th><th>Lapangan</th><th>Aksi</th></tr></thead>
        <tbody>{slots.map(slot => (
          <tr key={slot.id}>
            <td data-label="Nama"><b>{slot.label}</b></td>
            <td data-label="Hari">{formatDays(slot.days)}</td>
            <td data-label="Jam">{slot.start_time} – {slot.end_time}</td>
            <td className="wide" data-label="Lapangan">{slot.court_ids.length ? slot.court_ids.map(courtName).join(", ") : "Semua lapangan"}</td>
            <td className="actions"><div className="row-actions">
              <button onClick={() => setEditing(slot)} aria-label={`Ubah ${slot.label}`}><Pencil /></button>
              <button className="delete" onClick={() => void remove(slot)} aria-label={`Hapus ${slot.label}`}><Trash2 /></button>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
      {!slots.length && <div className="ops-empty"><h2>Belum ada jam khusus member</h2><p>Semua jam bisa dipesan siapa saja. Tambahkan mis. “Pagi member” Sabtu–Minggu 06.00–08.00 sebagai keuntungan member.</p></div>}
    </div>
    {editing !== undefined && <SlotModal slot={editing} courts={courts} close={close} done={next => { close(); saved(next); }} />}
  </>;
}

function SlotModal({ slot, courts, close, done }: { slot: MemberSlot | null; courts: CourtBrief[]; close: () => void; done: (slots: MemberSlot[]) => void }) {
  const [form, setForm] = useState({ label: slot?.label ?? "Pagi member", days: slot?.days ?? [0, 6], start_time: slot?.start_time ?? "06:00", end_time: slot?.end_time ?? "08:00", court_ids: slot?.court_ids ?? [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  const presets: [string, number[]][] = [["Hari kerja", [1, 2, 3, 4, 5]], ["Akhir pekan", [0, 6]], ["Setiap hari", [0, 1, 2, 3, 4, 5, 6]]];
  const same = (a: number[], b: number[]) => a.length === b.length && a.every(value => b.includes(value));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ member_slots: MemberSlot[] }>(`/operations/members/slots${slot ? "/" + slot.id : ""}`, { method: slot ? "PUT" : "POST", body: JSON.stringify(form) });
      toast.success("Jam khusus member disimpan"); done(result.member_slots);
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={slot ? "Ubah jam khusus member" : "Tambah jam khusus member"} close={close}>
      <form onSubmit={submit}>
        <div className="modal-fields">
          {error && <ErrorBox message={error} />}
          <label>Nama<input autoFocus required minLength={2} maxLength={60} value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Mis. Pagi member" /></label>
          <fieldset className="chip-field"><legend>Hari</legend><div className="chip-group days">{weekOrder.map(day => <button type="button" key={day} aria-pressed={form.days.includes(day)} onClick={() => setForm({ ...form, days: toggle(form.days, day) })}>{dayShort[day]}</button>)}</div>
            <div className="chip-presets">{presets.map(([label, days]) => <button type="button" key={label} aria-pressed={same(form.days, days)} onClick={() => setForm({ ...form, days })}>{label}</button>)}</div></fieldset>
          <div className="field-grid">
            <label>Mulai<Select value={form.start_time} onChange={event => setForm({ ...form, start_time: event.target.value })}>{timeSlots(0, 1410).map(time => <option key={time}>{time}</option>)}</Select></label>
            <label>Selesai<Select value={form.end_time} onChange={event => setForm({ ...form, end_time: event.target.value })}>{timeSlots(30, 1440).map(time => <option key={time} disabled={time <= form.start_time}>{time}</option>)}</Select></label>
          </div>
          <fieldset className="chip-field"><legend>Lapangan <small>tidak dipilih = semua lapangan</small></legend><div className="chip-group">{courts.map(court => <button type="button" key={court.id} aria-pressed={form.court_ids.includes(court.id)} onClick={() => setForm({ ...form, court_ids: toggle(form.court_ids, court.id) })}>{court.name}</button>)}</div></fieldset>
          {form.days.length > 0 && <p className="ops-muted">{formatDays(form.days)}, {form.start_time}–{form.end_time} di {form.court_ids.length ? form.court_ids.map(id => courts.find(court => court.id === id)?.name).join(", ") : "semua lapangan"} hanya untuk member.</p>}
        </div>
        <div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy || !form.days.length || form.end_time <= form.start_time} /></div>
      </form>
    </Modal>
  );
}

// --- Pengaturan -------------------------------------------------------------------

function SettingsTab({ settings, saved }: { settings: MemberSettings; saved: (settings: MemberSettings) => void }) {
  const [form, setForm] = useState({ enabled: settings.enabled, approval: settings.approval, terms: settings.terms, reminder_days: settings.reminder_days });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { saved((await api<{ settings: MemberSettings }>("/operations/members/settings", { method: "PUT", body: JSON.stringify(form) })).settings); toast.success("Pengaturan member disimpan"); }
    catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="cms-form" onSubmit={submit}>
      {error && <ErrorBox message={error} />}
      <section className="settings-card member-settings">
        <h2>Pendaftaran online</h2>
        <label className="switch-field"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> Pelanggan dapat mendaftar dan memperpanjang dari akunnya</label>
        <label className="switch-field"><input type="checkbox" checked={form.approval} disabled={!form.enabled} onChange={event => setForm({ ...form, approval: event.target.checked })} /> Pendaftar baru perlu disetujui admin setelah membayar</label>
        <p className="ops-muted">Pendaftaran online memakai pembayaran Midtrans dan login Google pelanggan. Member yang didaftarkan kasir selalu langsung aktif.</p>
        <label>Pengingat masa berlaku<Select value={String(form.reminder_days)} onChange={event => setForm({ ...form, reminder_days: Number(event.target.value) })}><option value="0">Tidak ada pengingat</option>{[3, 7, 14, 30].map(days => <option key={days} value={days}>{days} hari sebelum berakhir</option>)}</Select></label>
        <label>Syarat & ketentuan member<textarea rows={8} maxLength={3000} value={form.terms} onChange={event => setForm({ ...form, terms: event.target.value })} placeholder={"Mis.\n1. Kartu member hanya untuk pemilik nama.\n2. Iuran tidak dapat dikembalikan setelah masa berlaku dimulai.\n3. Harga member berlaku untuk booking selama masa aktif."} /><small className="field-hint">Ditampilkan di halaman pendaftaran dan wajib disetujui pelanggan.</small></label>
      </section>
      <div><Submit busy={busy}>Simpan pengaturan</Submit></div>
    </form>
  );
}

