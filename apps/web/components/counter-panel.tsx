"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, CalendarDays, Copy, MessageCircle, MonitorSmartphone, PackageCheck, Plus, Printer, QrCode, ReceiptText, RefreshCw, ShoppingBag } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { unitLabel } from "@/lib/addons";
import { billOf, taxName } from "@/lib/bill";
import { formatShortDay } from "@/lib/shop";
import { channelName, surchargeFor, type ChannelKey } from "@/lib/payments";
import { ChannelPicker } from "./channel-picker";
import { type SaleDetail, type SaleList, type SaleMethod, type SaleOptions, bookingLabel, cashPresets, durationLabel, durations, methodName, saleMethods, saleStatus, walkInName } from "@/lib/counter";
import { loadSnap } from "@/lib/snap";
import { type CustomerChoice, CustomerSelect } from "./customer-select";
import { AddonLinesEditor, type Draft, clampDrafts, draftPayload, draftsTotal } from "./addon-lines";
import { ErrorBox, Modal } from "./operation-ui";
import { MemberPicker } from "./member-picker";
import { type LookupMember, percentLabel } from "@/lib/members";
import { VoucherField } from "./voucher-field";
import { type VoucherCheck } from "@/lib/vouchers";
import { DateInput, MoneyInput, Select } from "./form-controls";
import { InfoTip, LabelTip } from "@/components/tooltip";

const printSale = (id: string) => window.open(`/cetak/nota/${id}?jenis=kasir&cetak=1`, "_blank", "noopener");

/**
 * Transaksi langsung di kasir: sewa raket, beli bola atau minuman, pakai pelatih, dengan atau tanpa
 * booking lapangan. Tunai/transfer/QRIS manual lunas saat dicatat; Midtrans menunggu pelanggan
 * membayar lewat QR atau layar kasir. Barang sewa ditagih kembali dari tab "Belum kembali".
 */
export function CounterPanel({ changed }: { changed: () => void }) {
  const [data, setData] = useState<SaleList | null>(null);
  const [date, setDate] = useState(""), [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [error, setError] = useState(""), [creating, setCreating] = useState(false), [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (date) params.set("date", date); if (search) params.set("q", search);
    try { setData(await api<SaleList>(`/operations/counter?${params}`)); setError(""); } catch (e) { setError((e as Error).message); }
  }, [date, search]);
  useEffect(() => { void load(); }, [load]);
  const closeCreate = useCallback(() => setCreating(false), []);
  const closeDetail = useCallback(() => setSelected(null), []);
  const refresh = useCallback(() => { void load(); changed(); }, [load, changed]);
  const today = !data || data.date === data.today;
  const methods = data ? Object.entries(data.summary.by_method).filter(([, amount]) => amount).map(([method, amount]) => `${methodName[method] ?? method} ${money(amount!)}`) : [];

  return <>
    {error && <ErrorBox message={error} retry={load} />}
    <div className="ops-actions"><p>Sewa raket, beli bola atau minuman, dengan atau tanpa booking lapangan. Bayar tunai, transfer, atau lewat Midtrans.</p><button className="ops-primary" onClick={() => setCreating(true)}><Plus size={16} /> Transaksi baru</button></div>
    {data && <div className="metric-grid counter-metrics metric-grid-3">
      <article className="metric-card lime"><div className="metric-top"><span><Banknote /></span></div><p>Penjualan {today ? "hari ini" : formatShortDay(data.date)}</p><h2>{money(data.summary.total)}</h2><small>{methods.length ? methods.join(" · ") : "Belum ada transaksi"}</small></article>
      <article className="metric-card violet"><div className="metric-top"><span><ReceiptText /></span></div><p>Jumlah transaksi</p><h2>{data.summary.count}</h2><small>{data.summary.pending ? `${data.summary.pending} menunggu bayar` : data.sales.length > data.summary.count ? `${data.sales.length - data.summary.count} dibatalkan atau tidak dibayar` : "Tidak termasuk yang dibatalkan"}</small></article>
      <article className="metric-card cyan"><div className="metric-top"><span><PackageCheck /></span></div><p>Sewa belum kembali</p><h2>{data.sales.filter(sale => sale.open_rentals > 0).length}</h2><small>Transaksi pada tanggal ini</small></article>
    </div>}
    <div className="ops-filters"><label>Cari transaksi<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nama, telepon, atau nomor KSR" /></label><label>Tanggal<DateInput value={date || data?.date || ""} onChange={e => setDate(e.target.value)} /></label><button className="ops-secondary" onClick={() => { setDate(""); setQuery(""); }}>Hari ini</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Transaksi<InfoTip text="Nomor KSR: transaksi sewa atau jual langsung di kasir, terpisah dari tagihan booking lapangan."/></th><th>Barang</th><th>Status<InfoTip text="Lunas: uang sudah diterima. Menunggu bayar: QR Midtrans belum dibayar. Kedaluwarsa: QR tidak dibayar sampai batas waktu. Dibatalkan: transaksi dibatalkan dan stok kembali."/></th><th>Total</th><th>Aksi</th></tr></thead><tbody>{data?.sales.map(sale => <tr key={sale.id} className={sale.status === "void" || sale.status === "expired" ? "inactive" : ""}>
      <td className="wide" data-label="Transaksi"><b>{sale.customer}</b><small className="table-description">{sale.number} · {new Date(sale.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{sale.phone ? ` · ${sale.phone}` : ""}</small>{sale.booking_court && <small className="table-description counter-booking-tag"><CalendarDays size={12} aria-hidden="true" /> {bookingLabel({ court_name: sale.booking_court, start_time: sale.booking_start!, end_time: sale.booking_end! })}</small>}</td>
      <td className="wide" data-label="Barang">{sale.items}{sale.open_rentals > 0 && sale.status === "paid" && <small className="table-description addon-overdue">Sewa sampai {sale.end_time}, belum kembali</small>}</td>
      <td data-label="Status"><span className={`status-pill ${saleStatus[sale.status].pill}`}>{saleStatus[sale.status].label}</span><small className="table-description">{methodName[sale.method] ?? sale.method}{sale.status === "paid" && sale.pay_order_id ? " · Midtrans" : ""}</small></td>
      <td data-label="Total">{money(sale.total)}</td>
      <td className="actions"><div className="ops-row-buttons">{sale.status === "pending" ? <button className="ops-primary" onClick={() => setSelected(sale.id)}><QrCode size={14} /> Tagih</button> : <><button className="ops-secondary" onClick={() => printSale(sale.id)} aria-label={`Cetak nota ${sale.number}`} disabled={sale.status === "expired"}><Printer size={14} /> Nota</button><button className="ops-secondary" onClick={() => setSelected(sale.id)}>Detail</button></>}</div></td>
    </tr>)}</tbody></table>
      {!data ? <p className="empty-state">Memuat transaksi…</p> : !data.sales.length && <div className="ops-empty"><h2>{search ? "Tidak ada transaksi yang cocok" : "Belum ada transaksi"}</h2><p>Catat sewa raket atau penjualan barang, untuk pemesan lapangan maupun pelanggan yang datang langsung.</p></div>}
    </div>
    {creating && <SaleForm close={closeCreate} done={id => { closeCreate(); setSelected(id); refresh(); }} />}
    {selected && <SaleDetailModal id={selected} close={closeDetail} changed={refresh} />}
  </>;
}

function SaleForm({ close, done }: { close: () => void; done: (id: string) => void }) {
  const [form, setForm] = useState({ id: crypto.randomUUID(), phone: "", duration: 60, booking_id: "", method: "cash" as SaleMethod, tendered: "" as number | "", discount: 0, discount_note: "", notes: "", channel: null as ChannelKey | null });
  const [customer, setCustomer] = useState<CustomerChoice | null>(null);
  const [member, setMember] = useState<LookupMember | null>(null);
  const [options, setOptions] = useState<SaleOptions | null>(null), [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDiscount, setShowDiscount] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  // Sisa raket bergantung pada jam sewa (lama sewa, atau jam booking yang dihubungkan), jadi dimuat ulang setiap berubah.
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ duration: String(form.duration) });
    if (form.booking_id) params.set("booking_id", form.booking_id);
    api<SaleOptions>(`/operations/counter/options?${params}`).then(result => { if (!active) return; setOptions(result); setDrafts(current => clampDrafts(current, result.addons)); }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [form.duration, form.booking_id]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));
  const booking = options?.bookings.find(entry => entry.id === form.booking_id) ?? null;
  /** Booking yang belum selesai menentukan jam sewa; yang sudah selesai memakai jam sekarang. */
  const followsBooking = !!booking && !!options && options.window.start === booking.start_time && options.window.end === booking.end_time;
  /** Pelanggan member (dari riwayat atau booking yang dihubungkan) langsung dipasang harga membernya; kasir bisa melepasnya. */
  const suggestMember = useCallback(async (code: string | null | undefined, date: string) => {
    if (!code) return;
    try {
      const found = (await api<{ members: LookupMember[] }>(`/operations/members/lookup?q=${encodeURIComponent(code)}&date=${date}`)).members.find(entry => entry.code === code);
      if (found?.valid) setMember(current => current ?? found);
    } catch { /* kasir tetap bisa mencari member manual */ }
  }, []);
  /** Member dipilih lebih dulu: nama dan nomornya dipakai sebagai pelanggan transaksi. */
  function pickMember(next: LookupMember | null) {
    setMember(next);
    if (next && !customer) setCustomer({ customer_id: null, name: next.name, phone: next.phone.replace(/\D/g, ""), visits: 0, last_visit: "", booking: null });
  }
  function chooseCustomer(choice: CustomerChoice | null) {
    setCustomer(choice);
    set("phone", "");
    // Pelanggan yang punya booking hari ini langsung dihubungkan, kecuali kasir sudah memilih booking lain.
    if (choice?.booking && !form.booking_id) set("booking_id", choice.booking.id);
    if (options) void suggestMember(choice?.member_code ?? choice?.booking?.member_code, options.window.date);
  }
  function chooseBooking(id: string) {
    set("booking_id", id);
    const picked = options?.bookings.find(entry => entry.id === id);
    if (picked && !customer) setCustomer({ customer_id: picked.customer_id, name: picked.customer, phone: picked.phone, visits: 0, last_visit: "", booking: picked });
    if (picked && options) void suggestMember(picked.member_code, options.window.date);
  }
  const chosen = drafts.filter(draft => draft.quantity > 0);
  const renting = chosen.some(draft => draft.type === "sewa");
  const timed = renting || chosen.some(draft => draft.pricing === "per_hour");
  const windowMinutes = options ? (Number(options.window.end.slice(0, 2)) * 60 + Number(options.window.end.slice(3))) - (Number(options.window.start.slice(0, 2)) * 60 + Number(options.window.start.slice(3))) : form.duration;
  const duration = followsBooking ? windowMinutes : options ? Math.max(30, Math.min(form.duration, 1440 - Number(options.window.start.slice(0, 2)) * 60 - Number(options.window.start.slice(3)))) : form.duration;
  const subtotal = draftsTotal(chosen, duration);
  // Diskon tambahan member untuk barang katalog; biaya lain yang diketik tidak ikut (sama dengan server).
  // Voucher memotong sisa tagihan setelah potongan member.
  const memberRate = member?.valid ? member.plan.addon_discount : 0;
  const discountable = draftsTotal(chosen.filter(draft => draft.type !== "lainnya"), duration);
  const memberDiscount = Math.round(discountable * memberRate / 10000);
  const discount = showDiscount ? Math.min(form.discount, subtotal - memberDiscount) : 0;
  const [voucher, setVoucher] = useState<VoucherCheck | null>(null);
  const voucherCut = voucher?.ok ? voucher.amount : 0;
  const bill = billOf(subtotal, discount + memberDiscount + voucherCut, options?.tax);
  const salePhone = customer?.customer_id || !customer?.isNew ? customer?.phone ?? "" : form.phone.trim();
  const tendered = form.tendered === "" ? null : Number(form.tendered);
  const change = form.method === "cash" && tendered !== null ? tendered - bill.total : 0;
  const midtrans = form.method === "midtrans";
  // Biaya admin Midtrans yang ditanggung pelanggan: kasir memilih metodenya, totalnya ikut naik.
  const fees = options?.midtrans.fees;
  const customerPays = midtrans && fees?.fee_bearer === "customer" && fees.channels.length > 0;
  const channel = customerPays ? fees.channels.find(entry => entry.key === form.channel) ?? fees.channels.find(entry => entry.key === "qris") ?? fees.channels[0] : undefined;
  const surcharge = customerPays ? surchargeFor(fees, channel, bill.total) : 0;
  const charge = bill.total + surcharge;
  const name = customer?.name.trim() ?? "";
  const ready = chosen.length > 0 && bill.total > 0 && (!renting || name.length >= 2) && (form.method !== "cash" || tendered === null || tendered >= bill.total) && (!midtrans || (!!options?.midtrans.enabled && bill.total >= 1000));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<SaleDetail>("/operations/counter", { method: "POST", body: JSON.stringify({
        id: form.id, customer: name, phone: customer?.customer_id ? "" : (customer?.isNew ? form.phone.trim() : customer?.phone ?? ""), customer_id: customer?.customer_id ?? null,
        booking_id: form.booking_id || null, membership_id: member?.valid ? member.id : null, duration: form.duration, lines: draftPayload(chosen), method: form.method, channel: channel?.key ?? null,
        tendered: form.method === "cash" ? tendered : null, discount, discount_note: discount ? form.discount_note : "", notes: form.notes,
        voucher_code: voucher?.ok ? voucher.code : "",
      }) });
      toast.success(result.sale.status === "pending" ? `${result.sale.number} menunggu pembayaran Midtrans` : `${result.sale.number} tercatat · ${money(result.sale.total)}`);
      done(result.sale.id);
    } catch (e) { setError((e as Error).message); setForm(f => ({ ...f, id: crypto.randomUUID() })); } finally { setBusy(false); }
  }

  return <Modal title="Transaksi kasir" close={close}><form onSubmit={submit}><div className="modal-fields">{error && <ErrorBox message={error} />}
    <h3 className="modal-subhead">Pelanggan <small>dari riwayat, atau ketik nama baru</small></h3>
    <label>Nama pelanggan{renting ? "" : " (opsional)"}<CustomerSelect value={customer} onChange={chooseCustomer} required={renting} placeholder={renting ? "Wajib untuk barang sewa · cari atau ketik nama baru" : `Cari riwayat, ketik nama baru, atau kosongkan untuk "${walkInName}"`} /></label>
    {customer?.isNew && <label>Nomor WhatsApp (opsional)<input maxLength={18} inputMode="tel" value={form.phone} placeholder="0812…" onChange={e => set("phone", e.target.value)} /><small className="ops-muted">Diisi: pelanggan disimpan ke daftar Pelanggan dan muncul sebagai rekomendasi berikutnya.</small></label>}
    <label><LabelTip tip="Barang sewa ikut jam main booking itu dan transaksinya tampil di detail booking. Pembayarannya tetap terpisah dari tagihan booking.">Hubungkan ke booking lapangan (opsional)</LabelTip><Select value={form.booking_id} onChange={e => chooseBooking(e.target.value)}>
      <option value="">Tanpa booking · datang langsung</option>
      {options?.bookings.map(entry => <option key={entry.id} value={entry.id}>{`${bookingLabel(entry)} · ${entry.customer} · ${entry.code}`}</option>)}
    </Select></label>
    {booking && <p className="ops-muted">{followsBooking ? <>Barang sewa dipakai selama booking <b>{bookingLabel(booking)}</b> dan tercatat di detail booking itu.</> : <>Booking {bookingLabel(booking)} sudah selesai; jam sewa dihitung dari sekarang. Transaksi tetap tercatat di detail booking.</>}</p>}
    {booking && customer && customer.name.trim().toLowerCase() !== booking.customer.trim().toLowerCase() && <p className="ops-muted">Pelanggan berbeda dari pemesan booking ({booking.customer}). Tidak masalah bila memang teman satu lapangan.</p>}
    <MemberPicker date={options?.window.date ?? ""} value={member} onChange={pickMember} />
    {member?.valid && !memberRate && <p className="ops-muted">Paket {member.plan.name} tidak memberi diskon raket & barang, jadi harga kasir tetap normal.</p>}

    <h3 className="modal-subhead">Barang <small>sewa, beli, atau layanan</small></h3>
    <AddonLinesEditor options={options?.addons ?? null} drafts={drafts} onChange={setDrafts} duration={duration} allowCustom walkIn />
    {!followsBooking && <div className="field-grid">
      <label><LabelTip tip="Berlaku untuk barang sewa dan harga per jam. Stok raket dihitung bersama booking lapangan pada jam yang sama.">Lama sewa</LabelTip><Select value={String(form.duration)} onChange={e => set("duration", Number(e.target.value))}>{durations.map(value => <option key={value} value={String(value)}>{durationLabel(value)}</option>)}</Select></label>
      <p className="ops-muted counter-window">{options ? `Mulai ${options.window.start}, kembali paling lambat ${options.window.end}.` : "Memeriksa stok…"} {timed ? "Stok raket dihitung bersama booking lapangan." : "Hanya berpengaruh untuk barang sewa dan harga per jam."}</p>
    </div>}
    {followsBooking && timed && options && <p className="ops-muted">Sewa {options.window.start}–{options.window.end} ({durationLabel(windowMinutes)}), mengikuti booking.</p>}
    {renting && <p className="ops-muted">Barang sewa masuk daftar <b>Belum kembali</b> sampai ditandai kembali. Simpan KTP atau jaminan lain sesuai kebijakan venue.</p>}

    {!showDiscount ? <button type="button" className="ops-link-button counter-discount-toggle" onClick={() => setShowDiscount(true)}>Beri potongan harga</button>
      : <div className="field-grid"><label>Potongan<MoneyInput min={0} max={subtotal - memberDiscount} value={form.discount} onChange={e => set("discount", Number(e.target.value))} /></label><label>Alasan potongan<input required={form.discount > 0} minLength={form.discount > 0 ? 3 : undefined} maxLength={120} value={form.discount_note} placeholder="Mis. pelanggan tetap" onChange={e => set("discount_note", e.target.value)} /></label></div>}

    {subtotal > 0 && <VoucherField extras={discountable} subtotal={subtotal} cap={subtotal - discount - memberDiscount} phone={salePhone} value={voucher} onChange={setVoucher} disabled={busy} />}

    <div className="ops-total"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
    {memberDiscount > 0 && <div className="ops-total"><span>Potongan member · {member!.plan.name} {percentLabel(memberRate)}</span><strong>−{money(memberDiscount)}</strong></div>}
    {discount > 0 && <div className="ops-total"><span>Potongan</span><strong>−{money(discount)}</strong></div>}
    {voucherCut > 0 && <div className="ops-total"><span>Voucher · {voucher!.code}</span><strong>−{money(voucherCut)}</strong></div>}
    {bill.tax > 0 && options?.tax && <div className="ops-total"><span>{taxName(options.tax)}</span><strong>{money(bill.tax)}</strong></div>}
    {surcharge > 0 && <div className="ops-total"><span>Biaya layanan {channel?.label}</span><strong>{money(surcharge)}</strong></div>}
    <div className="ops-total counter-grand"><span>Total bayar<InfoTip text="Subtotal − potongan member, potongan manual, dan voucher + pajak + biaya layanan Midtrans bila ditanggung pelanggan."/></span><strong>{money(charge)}</strong></div>

    <fieldset className="chip-field"><legend>Metode bayar<InfoTip text="Tunai, transfer, dan QRIS statis dicatat lunas saat disimpan. Midtrans menampilkan QR tagihan dan lunas otomatis setelah pelanggan membayar."/></legend><div className="chip-group">{saleMethods.map(method => <button type="button" key={method.value} aria-pressed={form.method === method.value} disabled={method.value === "midtrans" && options !== null && !options.midtrans.enabled} onClick={() => set("method", method.value)}>{method.value === "midtrans" && <QrCode size={13} aria-hidden="true" />}{method.label}</button>)}</div>
      {options && !options.midtrans.enabled && <small className="ops-muted">Midtrans belum aktif. Admin dapat mengaktifkannya di menu Pembayaran.</small>}
      {customerPays && <ChannelPicker compact fees={fees} base={bill.total} value={channel?.key ?? null} onChange={key => set("channel", key)} name="metode-kasir" />}
      {midtrans && <small className="ops-muted">Setelah disimpan, layar menampilkan QR tagihan. Pelanggan memindainya dengan ponsel dan {customerPays ? `membayar lewat ${channel?.label ?? "metode yang dipilih"}; biaya admin Midtrans ditanggung pelanggan` : "memilih QRIS, e-wallet, virtual account, atau kartu"}. Lunas otomatis begitu pembayaran masuk; tidak dibayar dalam {options?.midtrans.minutes ?? 15} menit berarti batal dan stok kembali.</small>}
      {form.method === "qris" && <small className="ops-muted">QRIS statis venue (dicek manual). Pilih Midtrans untuk QRIS yang terkonfirmasi otomatis.</small>}
    </fieldset>
    {form.method === "cash" && bill.total > 0 && <div className="counter-cash">
      <label><LabelTip tip="Isi uang yang diserahkan pelanggan untuk menghitung kembalian. Tidak memengaruhi pembukuan.">Uang diterima (opsional)</LabelTip><MoneyInput min={0} value={form.tendered} onChange={e => set("tendered", e.target.value === "" ? "" : Number(e.target.value))} /></label>
      <div className="chip-group">{cashPresets(bill.total).map(value => <button type="button" key={value} aria-pressed={tendered === value} onClick={() => set("tendered", value)}>{value === bill.total ? "Uang pas" : money(value)}</button>)}</div>
      {tendered !== null && <p className={`counter-change${change < 0 ? " short" : ""}`}>{change < 0 ? `Kurang ${money(-change)}` : `Kembalian ${money(change)}`}</p>}
    </div>}
    <label>Catatan (opsional)<input maxLength={300} value={form.notes} placeholder="Mis. jaminan KTP" onChange={e => set("notes", e.target.value)} /></label>
  </div><div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><button className="ops-primary" type="submit" disabled={busy || !ready || !options}>{busy ? "Menyimpan…" : midtrans ? `Buat tagihan Midtrans ${bill.total > 0 ? money(charge) : ""}` : `Simpan & lunas ${bill.total > 0 ? money(bill.total) : ""}`}</button></div></form></Modal>;
}

/** Sisa waktu bayar dalam mm:ss, diperbarui tiap detik. */
function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!until) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [until]);
  if (!until) return null;
  const left = Math.max(0, Math.round(until - now / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` };
}

/**
 * Layar menunggu bayar Midtrans: QR tautan bayar untuk dipindai ponsel pelanggan, atau Snap di layar
 * kasir. Status diperiksa ke Midtrans tiap beberapa detik, jadi tidak bergantung pada webhook.
 */
function PaymentWait({ data, refreshed }: { data: SaleDetail; refreshed: (next: SaleDetail) => void }) {
  const sale = data.sale;
  const [qr, setQr] = useState(""), [checking, setChecking] = useState(false), [problem, setProblem] = useState("");
  const countdown = useCountdown(sale.pay_expires_at);
  const latest = useRef(refreshed); latest.current = refreshed;
  useEffect(() => {
    if (!sale.pay_url) return;
    QRCode.toDataURL(sale.pay_url, { margin: 1, width: 440, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(""));
  }, [sale.pay_url]);
  const check = useCallback(async (manual = false) => {
    if (manual) setChecking(true);
    try { latest.current(await api<SaleDetail>(`/operations/counter/${sale.id}/refresh`, { method: "POST", body: "{}" })); setProblem(""); }
    catch (e) { if (manual) setProblem((e as Error).message); } finally { if (manual) setChecking(false); }
  }, [sale.id]);
  useEffect(() => { const timer = setInterval(() => void check(), 5000); return () => clearInterval(timer); }, [check]);
  async function payHere() {
    setProblem("");
    try {
      const options = await api<SaleOptions>("/operations/counter/options");
      const snap = await loadSnap(options.midtrans.client_key, options.midtrans.environment);
      snap.pay(sale.snap_token!, { onSuccess: () => void check(), onPending: () => void check(), onError: () => void check() });
    } catch (e) { setProblem(`${(e as Error).message} Minta pelanggan memindai QR, atau buka tautannya.`); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(sale.pay_url!); toast.success("Tautan bayar disalin"); } catch { toast.error("Tidak dapat menyalin. Salin manual dari kolom tautan."); }
  }
  const digits = sale.phone.replace(/\D/g, ""), wa = digits.length >= 9 ? (digits.startsWith("0") ? "62" + digits.slice(1) : digits) : "";
  const message = `Tagihan ${sale.number} sebesar ${money(sale.total + (sale.surcharge ?? 0))}. Bayar lewat tautan ini: ${sale.pay_url}`;
  if (!sale.pay_url) return <p className="ops-muted">Menyiapkan halaman bayar…</p>;
  return <section className="counter-pay" aria-label="Pembayaran Midtrans">
    <div className="counter-pay-amount"><span>Total tagihan{(sale.surcharge ?? 0) > 0 ? ` · termasuk biaya layanan ${money(sale.surcharge!)}` : ""}</span><strong>{money(sale.total + (sale.surcharge ?? 0))}</strong>{countdown && <small className={countdown.left < 120 ? "late" : ""}>{countdown.left ? `Berlaku ${countdown.label} lagi` : "Batas bayar lewat, memeriksa status…"}</small>}</div>
    <div className="counter-pay-qr">{qr ? <img src={qr} alt={`QR tagihan ${sale.number}`} width={220} height={220} /> : <span className="ops-muted">Membuat QR…</span>}</div>
    <p className="counter-pay-hint">Minta pelanggan memindai QR ini dengan kamera ponsel, lalu {sale.channel ? `bayar lewat ${channelName(sale.channel)}` : "pilih QRIS, GoPay/ShopeePay, virtual account, atau kartu"} di halaman Midtrans.</p>
    <p className="counter-pay-live"><span className="counter-pay-dot" aria-hidden="true" /> Menunggu pembayaran. Status diperbarui otomatis.</p>
    {problem && <ErrorBox message={problem} />}
    <div className="counter-pay-actions">
      {sale.snap_token && <button type="button" className="ops-secondary" onClick={() => void payHere()}><MonitorSmartphone size={14} /> Bayar di layar ini</button>}
      <button type="button" className="ops-secondary" onClick={() => void copy()}><Copy size={14} /> Salin tautan</button>
      {wa && <a className="ops-secondary" href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> Kirim WhatsApp</a>}
      <button type="button" className="ops-secondary" disabled={checking} onClick={() => void check(true)}><RefreshCw size={14} /> {checking ? "Memeriksa…" : "Periksa status"}</button>
    </div>
  </section>;
}

/** Detail transaksi kasir: rincian, tanda kembali untuk barang sewa, cetak nota, dan pembatalan. */
export function SaleDetailModal({ id, close, changed }: { id: string; close: () => void; changed: () => void }) {
  const [data, setData] = useState<SaleDetail | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reason, setReason] = useState("");
  const load = useCallback(async () => { try { setData(await api<SaleDetail>(`/operations/counter/${id}`)); setError(""); } catch (e) { setError((e as Error).message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  // Hasil periksa status dari layar menunggu bayar; perubahan ke lunas atau batal diberitahukan sekali.
  const refreshed = useCallback((next: SaleDetail) => {
    setData(current => {
      if (current?.sale.status === "pending" && next.sale.status !== "pending") {
        if (next.sale.status === "paid") toast.success(`Pembayaran ${next.sale.number} diterima · ${money(next.sale.total)}`);
        else toast.error(`Tagihan ${next.sale.number} ${next.sale.status === "expired" ? "kedaluwarsa" : "dibatalkan"}`);
        setTimeout(changed, 0);
      }
      return next;
    });
  }, [changed]);
  async function markReturned(lineIds: string[], returned: boolean) {
    setBusy(true); setError("");
    try { setData(await api<SaleDetail>(`/operations/counter/${id}/returned`, { method: "PATCH", body: JSON.stringify({ line_ids: lineIds, returned }) })); toast.success(returned ? "Barang ditandai sudah kembali" : "Tanda kembali dibatalkan"); changed(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!confirm(data?.sale.status === "pending" ? "Batalkan tagihan ini? Halaman bayar Midtrans dihentikan dan stok dikembalikan." : "Batalkan transaksi ini? Uang perlu dikembalikan ke pelanggan dan stok barang jual dikembalikan.")) return;
    setBusy(true); setError("");
    try { setData(await api<SaleDetail>(`/operations/counter/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) })); toast.success("Transaksi dibatalkan"); changed(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const sale = data?.sale, lines = data?.lines ?? [];
  const duration = sale ? (Number(sale.end_time.slice(0, 2)) * 60 + Number(sale.end_time.slice(3))) - (Number(sale.start_time.slice(0, 2)) * 60 + Number(sale.start_time.slice(3))) : 0;
  const open = lines.filter(line => line.type === "sewa" && !line.returned_at);
  const state = sale ? saleStatus[sale.status] : null, pending = sale?.status === "pending";
  return <Modal title={pending ? "Tagihan Midtrans" : "Detail transaksi kasir"} close={close}><div className="modal-fields">{error && <ErrorBox message={error} retry={!data ? load : undefined} />}
    {!sale ? <p>Memuat transaksi…</p> : <>
      <div className="ops-detail-head"><div><h3>{sale.customer}</h3>{sale.phone && <p>{sale.phone}</p>}<small>{sale.number}</small></div><span className={`status-pill ${state!.pill}`}>{state!.label}</span></div>
      <p className="ops-muted">{formatShortDay(sale.date)} · {new Date(sale.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{lines.some(line => line.type === "sewa") ? ` · sewa ${sale.start_time}–${sale.end_time}` : ""}</p>
      {data.booking && <p className="counter-booking-link"><CalendarDays size={14} aria-hidden="true" /> <span>Booking <b>{bookingLabel(data.booking)}</b> · {data.booking.customer} · {data.booking.code}</span></p>}
      {pending && <PaymentWait data={data} refreshed={refreshed} />}
      {sale.notes && <p>Catatan: {sale.notes}</p>}
      <section className="ops-addons" aria-label="Barang">
        <div className="ops-card-head"><h3><ShoppingBag size={15} aria-hidden="true" /> Barang</h3></div>
        <ul className="addon-summary-lines">{lines.map(line => <li key={line.id}>
          <div><b>{line.quantity}× {line.name}</b><small>{money(line.unit_price)} {unitLabel(line.type, line.pricing, true)}{line.pricing === "per_hour" ? ` × ${durationLabel(duration)}` : ""}{line.type === "lainnya" ? " · biaya lain" : ""}</small>
            {line.type === "sewa" && !pending && <span className="addon-return-row"><span className={`addon-return${line.returned_at ? " done" : ""}`}>{line.returned_at ? "Sudah kembali" : "Belum kembali"}</span>{sale.status === "paid" && <button type="button" className="ops-link-button" disabled={busy} onClick={() => void markReturned([line.id], !line.returned_at)}>{line.returned_at ? "Batalkan tanda" : "Tandai kembali"}</button>}</span>}
          </div><strong>{money(line.subtotal)}</strong>
        </li>)}</ul>
        {sale.status === "paid" && open.length > 1 && <button type="button" className="ops-secondary addon-return-all" disabled={busy} onClick={() => void markReturned(open.map(line => line.id), true)}><PackageCheck size={14} /> Tandai semua kembali</button>}
      </section>
      <div className="ops-total"><span>Subtotal</span><strong>{money(sale.subtotal)}</strong></div>
      {(sale.member_discount ?? 0) > 0 && <div className="ops-total"><span>Potongan member · {sale.member_plan}</span><strong>−{money(sale.member_discount!)}</strong></div>}
      {sale.discount > 0 && <div className="ops-total"><span>Potongan · {sale.discount_note}</span><strong>−{money(sale.discount)}</strong></div>}
      {(sale.voucher_discount ?? 0) > 0 && <div className="ops-total"><span>Voucher · {sale.voucher_code}</span><strong>−{money(sale.voucher_discount!)}</strong></div>}
      {sale.tax > 0 && <div className="ops-total"><span>{taxName(sale)}</span><strong>{money(sale.tax)}</strong></div>}
      <div className="ops-total"><span>Total{pending ? "" : ` · ${methodName[sale.method] ?? sale.method}${sale.pay_order_id && sale.status === "paid" ? " via Midtrans" : ""}`}</span><strong>{money(sale.total)}</strong></div>
      {(sale.surcharge ?? 0) > 0 && <div className="ops-total"><span>Biaya layanan Midtrans · dibayar pelanggan</span><strong>{money(sale.surcharge!)}</strong></div>}
      {sale.fee > 0 && sale.status === "paid" && <p className="ops-muted">Potongan Midtrans {money(sale.fee)} dicatat sebagai beban payment gateway{(sale.surcharge ?? 0) > 0 ? `, biaya layanan ${money(sale.surcharge!)} sebagai pendapatan` : ""}.</p>}
      {sale.tendered !== null && <div className="ops-total"><span>Diterima {money(sale.tendered)}</span><strong>Kembali {money(sale.tendered - sale.total)}</strong></div>}
      {sale.status === "void" || sale.status === "expired" ? <p>{sale.status === "void" ? "Dibatalkan" : "Kedaluwarsa"}{sale.voided_at ? ` ${new Date(sale.voided_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` : ""}: {sale.void_reason}</p>
        : <div className="ops-status-actions"><h3>{pending ? "Batalkan tagihan" : "Batalkan transaksi"}</h3><p className="ops-muted">{pending ? "Pelanggan tidak jadi atau ingin bayar dengan cara lain. Halaman bayar Midtrans dihentikan dan stok kembali; buat transaksi baru untuk metode lain." : sale.pay_order_id ? "Untuk salah input atau pelanggan tidak jadi. Pembukuan dibalik dan stok kembali. Dana Midtrans dikembalikan manual (dari dashboard Midtrans atau tunai)." : "Untuk salah input atau pelanggan tidak jadi. Pembukuan dibalik pada tanggal hari ini dan stok barang jual kembali."}</p><label>Alasan pembatalan<input minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="Wajib diisi untuk membatalkan" /></label><button className="ops-danger" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>{pending ? "Batalkan tagihan" : "Batalkan transaksi"}</button></div>}
    </>}
  </div><div className="modal-actions">{sale && sale.status !== "pending" && sale.status !== "expired" && <button type="button" onClick={() => printSale(sale.id)}><Printer size={14} /> Cetak nota</button>}<button type="button" onClick={close}>Tutup</button></div></Modal>;
}
