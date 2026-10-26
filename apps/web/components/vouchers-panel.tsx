"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Copy, Pencil, Plus, Receipt, TicketPercent, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { formatShortDay } from "@/lib/shop";
import { type Redemption, type Voucher, channelLabel, stateLabel, stateTone, valueText } from "@/lib/vouchers";
import { ErrorBox, Modal, Submit } from "./operation-ui";
import { DateInput, MoneyInput, Select } from "./form-controls";
import { InfoTip, LabelTip } from "@/components/tooltip";

type Data = { vouchers: Voucher[]; today: string };
const fail = (error: unknown) => toast.error((error as Error).message);
const filters: [string, string][] = [["", "Semua"], ["running", "Berjalan"], ["scheduled", "Terjadwal"], ["ended", "Berakhir"], ["inactive", "Nonaktif"]];

/** Menu Operasional → Voucher & Promo: buat kode promo, pantau pemakaian dan total potongannya. */
export function VouchersPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(""), [state, setState] = useState("");
  const [editing, setEditing] = useState<Voucher | null | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<Data>("/operations/vouchers")); setError(""); } catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const close = useCallback(() => setEditing(undefined), []);
  const list = useMemo(() => (data?.vouchers ?? []).filter(voucher => (!state || voucher.state === state)
    && (!query.trim() || `${voucher.code} ${voucher.name}`.toLowerCase().includes(query.trim().toLowerCase()))), [data, query, state]);

  if (!data) return error ? <ErrorBox message={error} retry={() => void load()} /> : <p className="empty-state">Memuat voucher…</p>;
  const running = data.vouchers.filter(voucher => voucher.state === "running");
  const metrics = [
    { label: "Voucher berjalan", tip: "Voucher aktif yang sedang dalam masa berlaku dan kuotanya belum habis. Terjadwal = aktif tapi tanggal mulainya belum tiba.", value: String(running.length), hint: `${data.vouchers.filter(voucher => voucher.state === "scheduled").length} terjadwal`, Icon: TicketPercent, tone: "violet" },
    { label: "Kali dipakai", tip: "Jumlah pesanan online dan transaksi kasir yang memakai voucher. Pesanan yang dibatalkan tidak dihitung dan kuotanya kembali.", value: String(data.vouchers.reduce((sum, voucher) => sum + voucher.used, 0)), hint: "Pesanan dan transaksi yang masih berlaku", Icon: Users, tone: "cyan" },
    { label: "Total potongan", tip: "Total rupiah yang dipotong voucher. Di laporan Laba Rugi tercatat sebagai Potongan Voucher yang mengurangi pendapatan.", value: money(data.vouchers.reduce((sum, voucher) => sum + voucher.discount_given, 0)), hint: "Dicatat di akun Potongan Voucher", Icon: CircleDollarSign, tone: "orange" },
  ];

  async function remove(voucher: Voucher) {
    if (!confirm(`Hapus voucher ${voucher.code}?`)) return;
    try { await api(`/operations/vouchers/${voucher.id}`, { method: "DELETE" }); toast.success(`${voucher.code} dihapus`); void load(); } catch (problem) { fail(problem); }
  }
  return (
    <div className="cms">
      {error && <ErrorBox message={error} retry={() => void load()} />}
      <div className="ops-actions">
        <p>Pelanggan mengetik kode di keranjang situs, kasir memasukkannya di booking atau transaksi kasir. Potongannya mengurangi pendapatan lewat akun Potongan Voucher.</p>
        <button className="ops-primary" onClick={() => setEditing(null)}><Plus size={16} /> Buat voucher</button>
      </div>
      <div className="metric-grid addon-metrics">{metrics.map(({ label, tip, value, hint, Icon, tone }) => <article key={label} className={`metric-card ${tone}`}><div className="metric-top"><span><Icon /></span></div><p><span className="metric-label">{label}</span><InfoTip text={tip} /></p><h2>{value}</h2><small>{hint}</small></article>)}</div>
      {!data.vouchers.length ? (
        <div className="ops-empty">
          <h2>Belum ada voucher</h2>
          <p>Contoh: kode <b>MAINPAGI</b> potongan 20% sewa lapangan untuk jam pagi, atau <b>BARU50K</b> potongan Rp50.000 sekali per nomor HP.</p>
          <button className="ops-primary" onClick={() => setEditing(null)}><Plus size={15} /> Buat voucher</button>
        </div>
      ) : <>
        <div className="ops-filters">
          <label>Cari voucher<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Kode atau nama promo" /></label>
          <label>Status<Select value={state} onChange={event => setState(event.target.value)}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        </div>
        <div className="manage-table-card ops-table table-cards">
          <table>
            <thead><tr><th>Kode<InfoTip text="Kode yang diketik pelanggan di keranjang atau oleh kasir. Huruf besar/kecil dianggap sama."/></th><th>Potongan</th><th>Berlaku</th><th>Pemakaian<InfoTip text="Sudah dipakai berapa kali dibanding kuota total."/></th><th>Status<InfoTip text="Berjalan: bisa dipakai sekarang. Terjadwal: tanggal mulainya belum tiba. Berakhir: lewat tanggal atau kuota habis. Nonaktif: dimatikan manual."/></th><th>Aksi</th></tr></thead>
            <tbody>{list.map(voucher => (
              <tr key={voucher.id} className={voucher.state === "inactive" ? "inactive" : ""}>
                <td className="wide" data-label="Kode"><b className="voucher-code">{voucher.code}</b><small className="table-description">{voucher.name}</small></td>
                <td data-label="Potongan">{valueText(voucher)}{voucher.target === "court" ? " lapangan" : ""}<small className="table-description">{voucher.min_order ? `Min. ${money(voucher.min_order)}` : "Tanpa minimal"} · {channelLabel[voucher.channel]}</small></td>
                <td data-label="Berlaku">{periodText(voucher)}</td>
                <td data-label="Pemakaian">{voucher.used}{voucher.quota ? ` / ${voucher.quota}` : "×"}<small className="table-description">{money(voucher.discount_given)}{voucher.per_customer ? ` · maks ${voucher.per_customer}× per pelanggan` : ""}</small></td>
                <td data-label="Status"><span className={`status-pill ${stateTone[voucher.state]}`}>{voucher.quota && voucher.used >= voucher.quota && voucher.state === "running" ? "Kuota habis" : stateLabel[voucher.state]}</span></td>
                <td className="actions"><div className="row-actions">
                  <button onClick={() => setOpenId(voucher.id)} aria-label={`Riwayat ${voucher.code}`} data-tip="Riwayat pemakaian"><Receipt /></button>
                  <button onClick={() => setEditing(voucher)} aria-label={`Ubah ${voucher.code}`} data-tip={`Ubah ${voucher.code}`}><Pencil /></button>
                  <button className="delete" disabled={voucher.used > 0} onClick={() => void remove(voucher)} aria-label={`Hapus ${voucher.code}`} data-tip={voucher.used ? "Sudah dipakai. Nonaktifkan saja." : "Hapus"}><Trash2 /></button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
          {!list.length && <p className="empty-state">Tidak ada voucher yang cocok.</p>}
        </div>
      </>}
      {editing !== undefined && <VoucherModal voucher={editing} today={data.today} close={close} done={() => { close(); void load(); }} />}
      {openId && <HistoryModal id={openId} close={() => setOpenId(null)} />}
    </div>
  );
}

function periodText(voucher: Pick<Voucher, "starts_on" | "ends_on">) {
  if (voucher.starts_on && voucher.ends_on) return `${formatShortDay(voucher.starts_on)} – ${formatShortDay(voucher.ends_on)}`;
  if (voucher.starts_on) return `Mulai ${formatShortDay(voucher.starts_on)}`;
  if (voucher.ends_on) return `Sampai ${formatShortDay(voucher.ends_on)}`;
  return "Tanpa batas waktu";
}

type Form = {
  code: string; name: string; description: string; kind: "percent" | "amount"; percent: number; amount: number; max_discount: number;
  min_order: number; target: "all" | "court"; channel: "all" | "online" | "kasir"; quota: string; per_customer: string; starts_on: string; ends_on: string; active: boolean;
};
const formOf = (voucher: Voucher | null, today: string): Form => ({
  code: voucher?.code ?? "", name: voucher?.name ?? "", description: voucher?.description ?? "", kind: voucher?.kind ?? "percent",
  percent: voucher?.kind === "percent" ? voucher.value / 100 : 10, amount: voucher?.kind === "amount" ? voucher.value : 25000,
  max_discount: voucher?.max_discount ?? 0, min_order: voucher?.min_order ?? 0, target: voucher?.target ?? "all", channel: voucher?.channel ?? "all",
  quota: voucher?.quota ? String(voucher.quota) : "", per_customer: voucher?.per_customer ? String(voucher.per_customer) : voucher ? "" : "1",
  starts_on: voucher ? voucher.starts_on ?? "" : today, ends_on: voucher?.ends_on ?? "", active: voucher ? !!voucher.active : true,
});
/** Kode acak yang mudah dibacakan: tanpa huruf/angka yang mirip (O/0, I/1). */
const randomCode = () => "PROMO" + Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join("");

function VoucherModal({ voucher, today, close, done }: { voucher: Voucher | null; today: string; close: () => void; done: () => void }) {
  const [form, setForm] = useState<Form>(() => formOf(voucher, today));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  const used = (voucher?.used ?? 0) > 0;
  // Contoh hitungan agar admin yakin dengan angkanya sebelum menyimpan.
  const sample = Math.max(form.min_order, 300000);
  const cut = form.kind === "percent" ? Math.min(Math.round(sample * form.percent / 100), form.max_discount || Infinity) : Math.min(form.amount, sample);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = {
        code: form.code, name: form.name, description: form.description, kind: form.kind,
        value: form.kind === "percent" ? Math.round(form.percent * 100) : form.amount,
        max_discount: form.kind === "percent" && form.max_discount > 0 ? form.max_discount : null,
        min_order: form.min_order, target: form.target, channel: form.channel,
        quota: form.quota ? Number(form.quota) : null, per_customer: form.per_customer ? Number(form.per_customer) : null,
        starts_on: form.starts_on || null, ends_on: form.ends_on || null, active: form.active,
      };
      await api(`/operations/vouchers${voucher ? "/" + voucher.id : ""}`, { method: voucher ? "PUT" : "POST", body: JSON.stringify(body) });
      toast.success(voucher ? "Voucher diperbarui" : `Voucher ${form.code.toUpperCase()} dibuat`); done();
    } catch (problem) { setError((problem as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal title={voucher ? `Ubah voucher ${voucher.code}` : "Buat voucher"} close={close}>
      <form onSubmit={submit}>
        <div className="modal-fields">
          {error && <ErrorBox message={error} />}
          <div className="field-grid">
            <label>Kode voucher
              <span className="voucher-code-field">
                <input autoFocus={!voucher} required minLength={3} maxLength={32} value={form.code} disabled={used} pattern="[A-Za-z0-9_\-]+" data-tip="Huruf, angka, tanda hubung, atau garis bawah"
                  onChange={event => set("code", event.target.value.toUpperCase().replace(/\s+/g, ""))} placeholder="Mis. MAINPAGI" />
                {!used && <button type="button" className="ops-secondary" onClick={() => set("code", randomCode())}>Acak</button>}
              </span>
              <small className="field-hint">{used ? "Sudah dipakai, jadi kodenya tidak dapat diganti." : "Yang diketik pelanggan. Huruf besar/kecil dianggap sama."}</small>
            </label>
            <label>Nama promo<input required minLength={3} maxLength={120} value={form.name} onChange={event => set("name", event.target.value)} placeholder="Mis. Promo main pagi" /></label>
          </div>
          <label>Keterangan internal (opsional)<textarea rows={2} maxLength={500} value={form.description} onChange={event => set("description", event.target.value)} placeholder="Mis. Untuk kampanye Instagram bulan November." /></label>

          <fieldset className="chip-field"><legend>Jenis potongan<InfoTip text="Persen: potongan mengikuti besar belanja, bisa dibatasi nominal maksimal. Nominal: potongan rupiah tetap."/></legend>
            <div className="chip-group">
              <button type="button" aria-pressed={form.kind === "percent"} onClick={() => set("kind", "percent")}>Persen (%)</button>
              <button type="button" aria-pressed={form.kind === "amount"} onClick={() => set("kind", "amount")}>Nominal (Rp)</button>
            </div>
          </fieldset>
          {form.kind === "percent" ? (
            <div className="field-grid">
              <label>Besar potongan (%)<input type="number" required min={1} max={99} step={0.5} value={form.percent} onChange={event => set("percent", Number(event.target.value))} /></label>
              <label><LabelTip tip="Batas atas potongan persen, mis. diskon 20% maksimal Rp50.000.">Potongan maksimal (opsional)</LabelTip><MoneyInput min={0} max={240000000} value={form.max_discount} onChange={event => set("max_discount", Number(event.target.value) || 0)} /><small className="field-hint">0 = tanpa batas</small></label>
            </div>
          ) : (
            <label>Besar potongan<MoneyInput required min={1000} max={240000000} value={form.amount} onChange={event => set("amount", Number(event.target.value) || 0)} /></label>
          )}
          <div className="field-grid">
            <label><LabelTip tip="Bagian tagihan yang didiskon. Sewa lapangan saja: raket dan tambahan tetap harga penuh.">Berlaku untuk</LabelTip><Select value={form.target} onChange={event => set("target", event.target.value as Form["target"])}><option value="all">Seluruh belanja (lapangan + sewa & tambahan)</option><option value="court">Sewa lapangan saja</option></Select></label>
            <label>Minimal belanja<MoneyInput min={0} max={240000000} value={form.min_order} onChange={event => set("min_order", Number(event.target.value) || 0)} /><small className="field-hint">Dihitung dari subtotal sebelum potongan. 0 = tanpa minimal.</small></label>
          </div>
          <p className="ops-muted">Contoh: belanja {money(sample)} mendapat potongan <b>{money(cut)}</b>. Biaya lain yang diketik manual oleh kasir tidak ikut dipotong.</p>

          <label><LabelTip tip="Situs pelanggan: diketik sendiri saat checkout. Kasir: dimasukkan staf saat booking atau transaksi di kasir.">Bisa dipakai di</LabelTip><Select value={form.channel} onChange={event => set("channel", event.target.value as Form["channel"])}><option value="all">Situs pelanggan dan kasir</option><option value="online">Situs pelanggan saja</option><option value="kasir">Kasir saja</option></Select></label>
          <div className="field-grid">
            <label>Kuota total (opsional)<input type="number" min={1} max={1000000} value={form.quota} onChange={event => set("quota", event.target.value)} placeholder="Tanpa batas" /><small className="field-hint">Satu pesanan online dihitung sekali, berapa pun sesinya.</small></label>
            <label>Maksimal per pelanggan (opsional)<input type="number" min={1} max={1000} value={form.per_customer} onChange={event => set("per_customer", event.target.value)} placeholder="Tanpa batas" /><small className="field-hint">Dikenali dari nomor HP atau akun pelanggan.</small></label>
          </div>
          <div className="field-grid">
            <label>Mulai berlaku<DateInput value={form.starts_on} onChange={event => set("starts_on", event.target.value)} /></label>
            <label>Berakhir (opsional)<DateInput min={form.starts_on || undefined} value={form.ends_on} onChange={event => set("ends_on", event.target.value)} /><small className="field-hint">Masih berlaku sampai akhir hari ini.</small></label>
          </div>
          <label className="switch-field"><input type="checkbox" checked={form.active} onChange={event => set("active", event.target.checked)} /> Voucher aktif</label>
          {voucher && <p className="ops-muted">Mengubah voucher tidak mengubah booking atau transaksi yang sudah memakainya.</p>}
        </div>
        <div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy}>{voucher ? "Simpan" : "Buat voucher"}</Submit></div>
      </form>
    </Modal>
  );
}

const refLabel = (row: Redemption) => row.sale_number ? `Kasir ${row.sale_number}` : row.order_code ? `Pesanan ${row.order_code}` : row.booking_id ? `Booking ${row.booking_id.slice(0, 8).toUpperCase()}` : "—";
const statusText = (row: Redemption) => {
  if (row.live) return row.sale_status === "pending" || row.booking_status === "pending" ? "Menunggu bayar" : "Terpakai";
  return row.sale_status === "void" || row.booking_status?.includes("cancelled") ? "Dibatalkan" : "Tidak jadi";
};

function HistoryModal({ id, close }: { id: string; close: () => void }) {
  const [data, setData] = useState<{ voucher: Voucher; redemptions: Redemption[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<{ voucher: Voucher; redemptions: Redemption[] }>(`/operations/vouchers/${id}`).then(setData).catch(problem => setError((problem as Error).message)); }, [id]);
  const voucher = data?.voucher;
  async function copy() {
    if (!voucher) return;
    try { await navigator.clipboard.writeText(voucher.code); toast.success("Kode disalin"); } catch { toast.message(voucher.code); }
  }
  return (
    <Modal title={voucher ? `Voucher ${voucher.code}` : "Riwayat voucher"} close={close}>
      <div className="modal-fields">
        {error && <ErrorBox message={error} />}
        {!voucher ? <p>Memuat riwayat…</p> : <>
          <div className="ops-detail-head">
            <div><h3 className="voucher-code">{voucher.code}</h3><p>{voucher.name}</p><small>{voucher.summary} · {channelLabel[voucher.channel]}</small></div>
            <span className={`status-pill ${stateTone[voucher.state]}`}>{stateLabel[voucher.state]}</span>
          </div>
          <button type="button" className="ops-secondary" onClick={() => void copy()}><Copy size={14} /> Salin kode</button>
          <div className="ops-total"><span>Berlaku</span><strong>{periodText(voucher)}</strong></div>
          <div className="ops-total"><span>Dipakai</span><strong>{voucher.used}{voucher.quota ? ` dari ${voucher.quota}` : "×"}</strong></div>
          <div className="ops-total"><span>Total potongan diberikan</span><strong>{money(voucher.discount_given)}</strong></div>
          <h3>Riwayat pemakaian</h3>
          {data!.redemptions.length ? data!.redemptions.map(row => (
            <div className={`ops-history${row.live ? "" : " muted"}`} key={row.id}>
              <div><b>{row.customer || "Pelanggan"} · {refLabel(row)}</b><small>{new Date(row.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · {row.channel === "online" ? "Situs" : "Kasir"} · {statusText(row)}</small></div>
              <strong>−{money(row.amount)}</strong>
            </div>
          )) : <p className="ops-muted">Belum pernah dipakai.</p>}
          {data!.redemptions.some(row => !row.live) && <p className="ops-muted">Pesanan yang kedaluwarsa atau dibatalkan tidak dihitung ke kuota.</p>}
        </>}
      </div>
      <div className="modal-actions"><button type="button" onClick={close}>Tutup</button></div>
    </Modal>
  );
}
