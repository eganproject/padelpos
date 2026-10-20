"use client";
import { useCallback, useEffect, useState } from "react";
import { Banknote, PackageCheck, Plus, Printer, ReceiptText, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { unitLabel } from "@/lib/addons";
import { billOf, taxName } from "@/lib/bill";
import { formatShortDay } from "@/lib/shop";
import { type SaleDetail, type SaleList, type SaleMethod, type SaleOptions, cashPresets, durationLabel, durations, saleMethods, walkInName } from "@/lib/counter";
import { AddonLinesEditor, type Draft, clampDrafts, draftPayload, draftsTotal } from "./addon-lines";
import { ErrorBox, Modal, Submit } from "./operation-ui";
import { DateInput, MoneyInput, Select } from "./form-controls";

const methodName: Record<string, string> = { cash: "Tunai", transfer: "Transfer", qris: "QRIS" };
const printSale = (id: string) => window.open(`/cetak/nota/${id}?jenis=kasir&cetak=1`, "_blank", "noopener");

/**
 * Transaksi langsung di kasir tanpa booking lapangan: sewa raket untuk latihan sendiri, beli bola
 * atau minuman, pakai pelatih. Dibayar lunas saat dicatat; barang sewa ditagih kembali dari tab
 * "Belum kembali".
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
  const methods = data ? saleMethods.filter(method => data.summary.by_method[method.value]).map(method => `${method.label} ${money(data.summary.by_method[method.value]!)}`) : [];

  return <>
    {error && <ErrorBox message={error} retry={load} />}
    <div className="ops-actions"><p>Sewa raket, beli bola atau minuman tanpa booking lapangan. Lunas saat dicatat dan langsung masuk pembukuan.</p><button className="ops-primary" onClick={() => setCreating(true)}><Plus size={16} /> Transaksi baru</button></div>
    {data && <div className="metric-grid counter-metrics metric-grid-3">
      <article className="metric-card lime"><div className="metric-top"><span><Banknote /></span></div><p>Penjualan {today ? "hari ini" : formatShortDay(data.date)}</p><h2>{money(data.summary.total)}</h2><small>{methods.length ? methods.join(" · ") : "Belum ada transaksi"}</small></article>
      <article className="metric-card violet"><div className="metric-top"><span><ReceiptText /></span></div><p>Jumlah transaksi</p><h2>{data.summary.count}</h2><small>{data.sales.length > data.summary.count ? `${data.sales.length - data.summary.count} dibatalkan` : "Tidak termasuk yang dibatalkan"}</small></article>
      <article className="metric-card cyan"><div className="metric-top"><span><PackageCheck /></span></div><p>Sewa belum kembali</p><h2>{data.sales.filter(sale => sale.open_rentals > 0).length}</h2><small>Transaksi pada tanggal ini</small></article>
    </div>}
    <div className="ops-filters"><label>Cari transaksi<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nama, telepon, atau nomor KSR" /></label><label>Tanggal<DateInput value={date || data?.date || ""} onChange={e => setDate(e.target.value)} /></label><button className="ops-secondary" onClick={() => { setDate(""); setQuery(""); }}>Hari ini</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Transaksi</th><th>Barang</th><th>Status</th><th>Total</th><th>Aksi</th></tr></thead><tbody>{data?.sales.map(sale => <tr key={sale.id} className={sale.status === "void" ? "inactive" : ""}>
      <td className="wide" data-label="Transaksi"><b>{sale.customer}</b><small className="table-description">{sale.number} · {new Date(sale.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{sale.phone ? ` · ${sale.phone}` : ""}</small></td>
      <td className="wide" data-label="Barang">{sale.items}{sale.open_rentals > 0 && sale.status === "paid" && <small className="table-description addon-overdue">Sewa sampai {sale.end_time}, belum kembali</small>}</td>
      <td data-label="Status"><span className={`status-pill ${sale.status === "paid" ? "done" : "off"}`}>{sale.status === "paid" ? "Lunas" : "Dibatalkan"}</span><small className="table-description">{methodName[sale.method]}</small></td>
      <td data-label="Total">{money(sale.total)}</td>
      <td className="actions"><div className="ops-row-buttons"><button className="ops-secondary" onClick={() => printSale(sale.id)} aria-label={`Cetak nota ${sale.number}`}><Printer size={14} /> Nota</button><button className="ops-secondary" onClick={() => setSelected(sale.id)}>Detail</button></div></td>
    </tr>)}</tbody></table>
      {!data ? <p className="empty-state">Memuat transaksi…</p> : !data.sales.length && <div className="ops-empty"><h2>{search ? "Tidak ada transaksi yang cocok" : "Belum ada transaksi"}</h2><p>Catat sewa raket atau penjualan barang untuk pelanggan yang tidak memesan lapangan.</p></div>}
    </div>
    {creating && <SaleForm close={closeCreate} done={id => { closeCreate(); setSelected(id); refresh(); }} />}
    {selected && <SaleDetailModal id={selected} close={closeDetail} changed={refresh} />}
  </>;
}

function SaleForm({ close, done }: { close: () => void; done: (id: string) => void }) {
  const [form, setForm] = useState({ id: crypto.randomUUID(), customer: "", phone: "", duration: 60, method: "cash" as SaleMethod, tendered: "" as number | "", discount: 0, discount_note: "", notes: "" });
  const [options, setOptions] = useState<SaleOptions | null>(null), [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDiscount, setShowDiscount] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  // Sisa raket bergantung pada lama sewa, jadi dimuat ulang setiap lamanya berubah.
  useEffect(() => {
    let active = true;
    api<SaleOptions>(`/operations/counter/options?duration=${form.duration}`).then(result => { if (!active) return; setOptions(result); setDrafts(current => clampDrafts(current, result.addons)); }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [form.duration]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));
  const chosen = drafts.filter(draft => draft.quantity > 0);
  const renting = chosen.some(draft => draft.type === "sewa");
  const timed = renting || chosen.some(draft => draft.pricing === "per_hour");
  const duration = options ? Math.max(30, Math.min(form.duration, 1440 - Number(options.window.start.slice(0, 2)) * 60 - Number(options.window.start.slice(3)))) : form.duration;
  const subtotal = draftsTotal(chosen, duration);
  const discount = showDiscount ? Math.min(form.discount, subtotal) : 0;
  const bill = billOf(subtotal, discount, options?.tax);
  const tendered = form.tendered === "" ? null : Number(form.tendered);
  const change = form.method === "cash" && tendered !== null ? tendered - bill.total : 0;
  const ready = chosen.length > 0 && bill.total > 0 && (!renting || form.customer.trim().length >= 2) && (form.method !== "cash" || tendered === null || tendered >= bill.total);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<SaleDetail>("/operations/counter", { method: "POST", body: JSON.stringify({
        id: form.id, customer: form.customer.trim(), phone: form.phone.trim(), duration: form.duration, lines: draftPayload(chosen), method: form.method,
        tendered: form.method === "cash" ? tendered : null, discount, discount_note: discount ? form.discount_note : "", notes: form.notes,
      }) });
      toast.success(`${result.sale.number} tercatat · ${money(result.sale.total)}`);
      done(result.sale.id);
    } catch (e) { setError((e as Error).message); setForm(f => ({ ...f, id: crypto.randomUUID() })); } finally { setBusy(false); }
  }

  return <Modal title="Transaksi kasir" close={close}><form onSubmit={submit}><div className="modal-fields">{error && <ErrorBox message={error} />}
    <h3 className="modal-subhead">Barang <small>sewa, beli, atau layanan</small></h3>
    <AddonLinesEditor options={options?.addons ?? null} drafts={drafts} onChange={setDrafts} duration={duration} allowCustom walkIn />
    <div className="field-grid">
      <label>Lama sewa<Select value={String(form.duration)} onChange={e => set("duration", Number(e.target.value))}>{durations.map(value => <option key={value} value={String(value)}>{durationLabel(value)}</option>)}</Select></label>
      <p className="ops-muted counter-window">{options ? `Mulai ${options.window.start}, kembali paling lambat ${options.window.end}.` : "Memeriksa stok…"} {timed ? "Stok raket dihitung bersama booking lapangan." : "Hanya berpengaruh untuk barang sewa dan harga per jam."}</p>
    </div>
    <div className="field-grid">
      <label>Nama pelanggan{renting ? "" : " (opsional)"}<input required={renting} minLength={renting ? 2 : undefined} maxLength={80} value={form.customer} placeholder={renting ? "Wajib untuk barang sewa" : walkInName} onChange={e => set("customer", e.target.value)} /></label>
      <label>Nomor telepon (opsional)<input maxLength={18} inputMode="tel" value={form.phone} onChange={e => set("phone", e.target.value)} /></label>
    </div>
    {renting && <p className="ops-muted">Barang sewa masuk daftar <b>Belum kembali</b> sampai ditandai kembali. Simpan KTP atau jaminan lain sesuai kebijakan venue.</p>}

    {!showDiscount ? <button type="button" className="ops-link-button counter-discount-toggle" onClick={() => setShowDiscount(true)}>Beri potongan harga</button>
      : <div className="field-grid"><label>Potongan<MoneyInput min={0} max={subtotal} value={form.discount} onChange={e => set("discount", Number(e.target.value))} /></label><label>Alasan potongan<input required={form.discount > 0} minLength={form.discount > 0 ? 3 : undefined} maxLength={120} value={form.discount_note} placeholder="Mis. pelanggan tetap" onChange={e => set("discount_note", e.target.value)} /></label></div>}

    <div className="ops-total"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
    {discount > 0 && <div className="ops-total"><span>Potongan</span><strong>−{money(discount)}</strong></div>}
    {bill.tax > 0 && options?.tax && <div className="ops-total"><span>{taxName(options.tax)}</span><strong>{money(bill.tax)}</strong></div>}
    <div className="ops-total counter-grand"><span>Total bayar</span><strong>{money(bill.total)}</strong></div>

    <fieldset className="chip-field"><legend>Metode bayar</legend><div className="chip-group">{saleMethods.map(method => <button type="button" key={method.value} aria-pressed={form.method === method.value} onClick={() => set("method", method.value)}>{method.label}</button>)}</div></fieldset>
    {form.method === "cash" && bill.total > 0 && <div className="counter-cash">
      <label>Uang diterima (opsional)<MoneyInput min={0} value={form.tendered} onChange={e => set("tendered", e.target.value === "" ? "" : Number(e.target.value))} /></label>
      <div className="chip-group">{cashPresets(bill.total).map(value => <button type="button" key={value} aria-pressed={tendered === value} onClick={() => set("tendered", value)}>{value === bill.total ? "Uang pas" : money(value)}</button>)}</div>
      {tendered !== null && <p className={`counter-change${change < 0 ? " short" : ""}`}>{change < 0 ? `Kurang ${money(-change)}` : `Kembalian ${money(change)}`}</p>}
    </div>}
    <label>Catatan (opsional)<input maxLength={300} value={form.notes} placeholder="Mis. jaminan KTP" onChange={e => set("notes", e.target.value)} /></label>
  </div><div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy || !ready || !options}>Simpan & lunas {bill.total > 0 ? money(bill.total) : ""}</Submit></div></form></Modal>;
}

/** Detail transaksi kasir: rincian, tanda kembali untuk barang sewa, cetak nota, dan pembatalan. */
export function SaleDetailModal({ id, close, changed }: { id: string; close: () => void; changed: () => void }) {
  const [data, setData] = useState<SaleDetail | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reason, setReason] = useState("");
  const load = useCallback(async () => { try { setData(await api<SaleDetail>(`/operations/counter/${id}`)); setError(""); } catch (e) { setError((e as Error).message); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function markReturned(lineIds: string[], returned: boolean) {
    setBusy(true); setError("");
    try { setData(await api<SaleDetail>(`/operations/counter/${id}/returned`, { method: "PATCH", body: JSON.stringify({ line_ids: lineIds, returned }) })); toast.success(returned ? "Barang ditandai sudah kembali" : "Tanda kembali dibatalkan"); changed(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!confirm("Batalkan transaksi ini? Uang perlu dikembalikan ke pelanggan dan stok barang jual dikembalikan.")) return;
    setBusy(true); setError("");
    try { setData(await api<SaleDetail>(`/operations/counter/${id}/void`, { method: "POST", body: JSON.stringify({ reason }) })); toast.success("Transaksi dibatalkan"); changed(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const sale = data?.sale, lines = data?.lines ?? [];
  const duration = sale ? (Number(sale.end_time.slice(0, 2)) * 60 + Number(sale.end_time.slice(3))) - (Number(sale.start_time.slice(0, 2)) * 60 + Number(sale.start_time.slice(3))) : 0;
  const open = lines.filter(line => line.type === "sewa" && !line.returned_at);
  return <Modal title="Detail transaksi kasir" close={close}><div className="modal-fields">{error && <ErrorBox message={error} retry={!data ? load : undefined} />}
    {!sale ? <p>Memuat transaksi…</p> : <>
      <div className="ops-detail-head"><div><h3>{sale.customer}</h3>{sale.phone && <p>{sale.phone}</p>}<small>{sale.number}</small></div><span className={`status-pill ${sale.status === "paid" ? "done" : "off"}`}>{sale.status === "paid" ? "Lunas" : "Dibatalkan"}</span></div>
      <p className="ops-muted">{formatShortDay(sale.date)} · {new Date(sale.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{lines.some(line => line.type === "sewa") ? ` · sewa ${sale.start_time}–${sale.end_time}` : ""}</p>
      {sale.notes && <p>Catatan: {sale.notes}</p>}
      <section className="ops-addons" aria-label="Barang">
        <div className="ops-card-head"><h3><ShoppingBag size={15} aria-hidden="true" /> Barang</h3></div>
        <ul className="addon-summary-lines">{lines.map(line => <li key={line.id}>
          <div><b>{line.quantity}× {line.name}</b><small>{money(line.unit_price)} {unitLabel(line.type, line.pricing, true)}{line.pricing === "per_hour" ? ` × ${durationLabel(duration)}` : ""}{line.type === "lainnya" ? " · biaya lain" : ""}</small>
            {line.type === "sewa" && <span className="addon-return-row"><span className={`addon-return${line.returned_at ? " done" : ""}`}>{line.returned_at ? "Sudah kembali" : "Belum kembali"}</span>{sale.status === "paid" && <button type="button" className="ops-link-button" disabled={busy} onClick={() => void markReturned([line.id], !line.returned_at)}>{line.returned_at ? "Batalkan tanda" : "Tandai kembali"}</button>}</span>}
          </div><strong>{money(line.subtotal)}</strong>
        </li>)}</ul>
        {sale.status === "paid" && open.length > 1 && <button type="button" className="ops-secondary addon-return-all" disabled={busy} onClick={() => void markReturned(open.map(line => line.id), true)}><PackageCheck size={14} /> Tandai semua kembali</button>}
      </section>
      <div className="ops-total"><span>Subtotal</span><strong>{money(sale.subtotal)}</strong></div>
      {sale.discount > 0 && <div className="ops-total"><span>Potongan · {sale.discount_note}</span><strong>−{money(sale.discount)}</strong></div>}
      {sale.tax > 0 && <div className="ops-total"><span>{taxName(sale)}</span><strong>{money(sale.tax)}</strong></div>}
      <div className="ops-total"><span>Total · {methodName[sale.method]}</span><strong>{money(sale.total)}</strong></div>
      {sale.tendered !== null && <div className="ops-total"><span>Diterima {money(sale.tendered)}</span><strong>Kembali {money(sale.tendered - sale.total)}</strong></div>}
      {sale.status === "void" ? <p>Dibatalkan{sale.voided_at ? ` ${new Date(sale.voided_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` : ""}: {sale.void_reason}</p>
        : <div className="ops-status-actions"><h3>Batalkan transaksi</h3><p className="ops-muted">Untuk salah input atau pelanggan tidak jadi. Pembukuan dibalik pada tanggal hari ini dan stok barang jual kembali.</p><label>Alasan pembatalan<input minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="Wajib diisi untuk membatalkan" /></label><button className="ops-danger" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()}>Batalkan transaksi</button></div>}
    </>}
  </div><div className="modal-actions">{sale && <button type="button" onClick={() => printSale(sale.id)}><Printer size={14} /> Cetak nota</button>}<button type="button" onClick={close}>Tutup</button></div></Modal>;
}
