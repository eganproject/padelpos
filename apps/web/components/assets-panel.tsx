"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ListOrdered, Pencil, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { type Account, type Partner, formatDate, money } from "@/lib/finance";
import { ErrorBox, Modal } from "./operation-ui";
import { AmountField, Empty, StatCard } from "./finance-ui";
import { DateInput, Select } from "./form-controls";

type Asset = {
  id:string; number:string; name:string; category:string; acquired_on:string; cost:number; salvage:number; life_months:number; depreciate_from:string;
  asset_account_id:string; accumulated_account_id:string; expense_account_id:string; status:"aktif"|"dilepas"; disposed_on:string|null; disposal_amount:number|null;
  note:string; record_id:string|null; accumulated:number; prior:number; months_done:number; last_period:string|null; monthly:number; book_value:number; ends:string; remaining_months:number;
};
type Overview = {
  assets:Asset[]; summary:{ count:number; cost:number; accumulated:number; book_value:number; monthly:number };
  options:{ asset_accounts:Account[]; accumulated_accounts:Account[]; expense_accounts:Account[]; cash_accounts:Account[]; partners:Partner[]; defaults:{ asset:string; accumulated:string; expense:string } };
  locked_until:string; date:string;
};
type Schedule = { asset:Asset; rows:{ period:string; amount:number; book_value:number; state:"sebelum"|"tercatat"|"terjadwal"|"dilepas" }[] };

const monthLabel = (period:string) => new Date(period+"-01T12:00:00Z").toLocaleDateString("id-ID",{month:"short",year:"numeric"});
const lifeText = (months:number) => { const years=Math.floor(months/12), rest=months%12; return [years?`${years} th`:"", rest?`${rest} bln`:""].filter(Boolean).join(" ")||"0 bln" };

/** Aset tetap: daftar peralatan, penyusutan bulanan otomatis, dan pelepasan (dijual/rusak). */
export function AssetsPanel() {
  const [data,setData] = useState<Overview|null>(null);
  const [error,setError] = useState("");
  const [editing,setEditing] = useState<Asset|"new"|null>(null);
  const [disposing,setDisposing] = useState<Asset|null>(null);
  const [schedule,setSchedule] = useState<Asset|null>(null);
  const [showAll,setShowAll] = useState(false);
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await api<Overview>("/operations/finance/assets")); setError("") } catch (e) { setError((e as Error).message) } }, []);
  useEffect(() => { void load() }, [load]);
  async function depreciate() {
    setBusy(true);
    try {
      const result = await api<{ posted:number; skipped:number; through:string }>("/operations/finance/assets/depreciate", { method:"POST", body:"{}" });
      toast.success(result.posted ? `${result.posted} penyusutan bulanan dicatat sampai ${monthLabel(result.through)}` : `Penyusutan sampai ${monthLabel(result.through)} sudah lengkap`);
      if (result.skipped) toast.warning(`${result.skipped} bulan dilewati karena pembukuannya terkunci.`);
      await load();
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  async function remove(asset:Asset) {
    if (!confirm(`Hapus ${asset.number} ${asset.name}? Penyusutannya ikut dihapus${asset.record_id?", begitu juga catatan pembeliannya":""}. Pakai ini hanya untuk data yang salah input; aset yang dijual atau rusak sebaiknya dilepas.`)) return;
    try { await api(`/operations/finance/assets/${asset.id}`, { method:"DELETE" }); toast.success("Aset dihapus"); await load() } catch (e) { toast.error((e as Error).message) }
  }
  async function undo(asset:Asset) {
    if (!confirm(`Batalkan pelepasan ${asset.name}? Jurnal pelepasannya dihapus dan penyusutan dilanjutkan.`)) return;
    try { await api(`/operations/finance/assets/${asset.id}/undo-dispose`, { method:"POST", body:"{}" }); toast.success("Pelepasan dibatalkan"); await load() } catch (e) { toast.error((e as Error).message) }
  }
  if (error && !data) return <ErrorBox message={error} retry={load}/>;
  if (!data) return <p className="empty-state">Memuat aset tetap…</p>;
  const s = data.summary;
  const list = data.assets.filter(asset => showAll || asset.status==="aktif");
  const disposedCount = data.assets.length - data.summary.count;
  return (
    <div className="fin">
      <div className="fin-stats">
        <StatCard label="Aset aktif" value={String(s.count)} hint={disposedCount?`${disposedCount} sudah dilepas`:undefined}/>
        <StatCard label="Harga perolehan" value={money(s.cost)}/>
        <StatCard label="Akumulasi penyusutan" value={money(s.accumulated)}/>
        <StatCard label="Nilai buku" value={money(s.book_value)} hint={`Penyusutan ${money(s.monthly)} per bulan`}/>
      </div>
      <div className="fin-toolbar asset-toolbar">
        <p className="fin-note"><CalendarClock size={14}/> Penyusutan bulan lalu dicatat otomatis tiap awal bulan. Bulan di periode yang dikunci dilewati.</p>
        <div className="fin-toolbar-actions">
          {disposedCount>0 && <label className="fin-check"><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/> Tampilkan yang dilepas</label>}
          <button type="button" className="ops-secondary" disabled={busy} onClick={()=>void depreciate()}><RotateCcw size={14}/> {busy?"Mencatat…":"Catat penyusutan"}</button>
          <button type="button" className="ops-primary" onClick={()=>setEditing("new")}><Plus size={14}/> Tambah aset</button>
        </div>
      </div>
      {list.length ? <div className="manage-table-card ops-table table-cards"><table>
        <thead><tr><th>Aset</th><th>Perolehan</th><th>Umur</th><th className="right">Per bulan</th><th className="right">Akumulasi</th><th className="right">Nilai buku</th><th>Aksi</th></tr></thead>
        <tbody>{list.map(asset => (
          <tr key={asset.id} className={asset.status==="dilepas"?"muted-row":""}>
            <td className="wide" data-label="Aset"><b>{asset.name}</b><small className="table-description">{asset.number}{asset.category?` · ${asset.category}`:""}{asset.status==="dilepas"?` · dilepas ${formatDate(asset.disposed_on??"")}${asset.disposal_amount?` seharga ${money(asset.disposal_amount)}`:""}`:""}</small></td>
            <td data-label="Perolehan">{money(asset.cost)}<small className="table-description">{formatDate(asset.acquired_on)}</small></td>
            <td data-label="Umur">{lifeText(asset.life_months)}<small className="table-description">{asset.status==="aktif"?(asset.remaining_months?`sisa ${lifeText(asset.remaining_months)}`:"sudah habis"):"—"}</small></td>
            <td className="right" data-label="Per bulan">{money(asset.monthly)}</td>
            <td className="right" data-label="Akumulasi">{money(asset.accumulated+asset.prior)}{asset.prior>0&&<small className="table-description">{money(asset.prior)} sebelum dicatat</small>}</td>
            <td className="right" data-label="Nilai buku"><b>{money(asset.book_value)}</b><span className="asset-bar" aria-hidden="true"><i style={{width:`${Math.max(0,Math.min(100,Math.round(asset.book_value/asset.cost*100)))}%`}}/></span></td>
            <td className="actions"><div className="ops-row-buttons asset-actions">
              <button type="button" className="ops-secondary" onClick={()=>setSchedule(asset)} title="Jadwal penyusutan"><ListOrdered size={14}/> Jadwal</button>
              {asset.status==="aktif" ? <>
                <button type="button" className="ops-secondary" onClick={()=>setEditing(asset)} aria-label={`Ubah ${asset.name}`}><Pencil size={14}/></button>
                <button type="button" className="ops-secondary" onClick={()=>setDisposing(asset)}>Lepas</button>
                <button type="button" className="ops-danger" onClick={()=>void remove(asset)} aria-label={`Hapus ${asset.name}`}><Trash2 size={14}/></button>
              </> : <button type="button" className="ops-secondary" onClick={()=>void undo(asset)}><Undo2 size={14}/> Batalkan pelepasan</button>}
            </div></td>
          </tr>
        ))}</tbody>
      </table></div> : <Empty title="Belum ada aset tetap" text="Daftarkan raket sewa, lampu, karpet lapangan, AC, atau peralatan lain yang dipakai lebih dari setahun. Penyusutannya dicatat otomatis tiap bulan."/>}
      {editing && <AssetForm data={data} asset={editing==="new"?null:editing} close={()=>setEditing(null)} saved={()=>{setEditing(null);void load()}}/>}
      {disposing && <DisposeForm data={data} asset={disposing} close={()=>setDisposing(null)} saved={()=>{setDisposing(null);void load()}}/>}
      {schedule && <ScheduleModal asset={schedule} close={()=>setSchedule(null)}/>}
    </div>
  );
}

const lifePresets = [12,24,36,60,96,120];

function AssetForm({ data, asset, close, saved }: { data:Overview; asset:Asset|null; close:()=>void; saved:()=>void }) {
  const o = data.options;
  const started = !!asset && asset.months_done>0;
  const [form,setForm] = useState(() => ({
    name:asset?.name??"", category:asset?.category??"", acquired_on:asset?.acquired_on??data.date, cost:asset?.cost??0, salvage:asset?.salvage??0, life_months:asset?.life_months??36,
    depreciate_from:asset?.depreciate_from??"", asset_account_id:asset?.asset_account_id??o.defaults.asset, accumulated_account_id:asset?.accumulated_account_id??o.defaults.accumulated,
    expense_account_id:asset?.expense_account_id??o.defaults.expense, note:asset?.note??"",
  }));
  const [purchase,setPurchase] = useState<{on:boolean;settle:"tunai"|"tempo";cash_account_id:string;partner_id:string}>({ on:false, settle:"tunai", cash_account_id:o.cash_accounts[0]?.id??"", partner_id:"" });
  const [error,setError] = useState(""), [saving,setSaving] = useState(false);
  const set = <K extends keyof typeof form>(key:K, value:(typeof form)[K]) => setForm(current => ({ ...current, [key]:value }));
  const monthly = form.life_months>0 && form.cost>form.salvage ? Math.floor((form.cost-form.salvage)/form.life_months) : 0;
  const pastStart = form.acquired_on.slice(0,7) < data.date.slice(0,7);
  async function submit(event:React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const body = { ...form, purchase: !asset && purchase.on ? { settle:purchase.settle, cash_account_id:purchase.settle==="tunai"?purchase.cash_account_id:null, partner_id:purchase.partner_id||null } : null };
    try {
      await api(asset?`/operations/finance/assets/${asset.id}`:"/operations/finance/assets", { method:asset?"PUT":"POST", body:JSON.stringify(body) });
      toast.success(asset?"Aset diperbarui":"Aset ditambahkan; penyusutan sampai bulan lalu sudah dicatat"); saved();
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return (
    <Modal title={asset?`Ubah ${asset.number}`:"Tambah aset tetap"} close={close}>
      <form className="fin-form" onSubmit={submit}>
        {error && <ErrorBox message={error}/>}
        {started && <p className="fin-note">Aset ini sudah disusutkan, jadi hanya nama, kategori, dan catatan yang bisa diubah.</p>}
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Nama aset</span><input required minLength={3} maxLength={120} autoFocus value={form.name} placeholder="Mis. Lampu LED lapangan 1" onChange={e=>set("name",e.target.value)}/></label>
          <label className="fin-field"><span className="fin-label">Kategori (opsional)</span><input maxLength={60} value={form.category} placeholder="Raket, lampu, karpet…" list="asset-categories" onChange={e=>set("category",e.target.value)}/>
            <datalist id="asset-categories">{[...new Set(data.assets.map(item=>item.category).filter(Boolean))].map(item=><option key={item} value={item}/>)}</datalist></label>
        </div>
        <fieldset className="fin-fieldset" disabled={started}>
          <div className="fin-form-grid">
            <label className="fin-field"><span className="fin-label">Tanggal perolehan</span><DateInput required value={form.acquired_on} onChange={e=>e.target.value&&set("acquired_on",e.target.value)}/></label>
            <AmountField label="Harga perolehan" value={form.cost} onChange={value=>set("cost",value)}/>
          </div>
          <div className="fin-field"><span className="fin-label">Umur manfaat</span>
            <div className="fin-chips" role="group" aria-label="Umur manfaat">{lifePresets.map(months=><button type="button" key={months} aria-pressed={form.life_months===months} onClick={()=>set("life_months",months)}>{months/12} tahun</button>)}
              <label className="asset-life"><input type="number" min={1} max={600} required value={form.life_months||""} onChange={e=>set("life_months",Number(e.target.value))} aria-label="Umur manfaat dalam bulan"/> bulan</label></div>
          </div>
          <div className="fin-form-grid">
            <AmountField label="Nilai sisa di akhir umur" value={form.salvage} onChange={value=>set("salvage",value)} hint="Perkiraan harga jual bekas; isi 0 bila habis terpakai."/>
            <div className="fin-field"><span className="fin-label">Penyusutan per bulan</span><strong className="asset-monthly">{money(monthly)}</strong><small className="fin-hint">Garis lurus: (harga − nilai sisa) ÷ umur.</small></div>
          </div>
          {pastStart && <label className="fin-field"><span className="fin-label">Mulai dicatat dari bulan (opsional)</span>
            <input type="month" value={form.depreciate_from} min={form.acquired_on.slice(0,7)} max={data.date.slice(0,7)} onChange={e=>set("depreciate_from",e.target.value)}/>
            <small className="fin-hint">Untuk aset lama yang penyusutan sebelumnya sudah ada di saldo awal Akumulasi Penyusutan. Kosongkan agar dicatat sejak bulan perolehan.</small></label>}
          <details className="fin-advanced"><summary>Akun pembukuan</summary>
            <div className="fin-form-grid">
              <label className="fin-field"><span className="fin-label">Akun aset</span><Select value={form.asset_account_id} onChange={e=>set("asset_account_id",e.target.value)}>{o.asset_accounts.map(account=><option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></label>
              <label className="fin-field"><span className="fin-label">Akun akumulasi</span><Select value={form.accumulated_account_id} onChange={e=>set("accumulated_account_id",e.target.value)}>{o.accumulated_accounts.map(account=><option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></label>
              <label className="fin-field"><span className="fin-label">Akun beban</span><Select value={form.expense_account_id} onChange={e=>set("expense_account_id",e.target.value)}>{o.expense_accounts.map(account=><option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</Select></label>
            </div>
          </details>
        </fieldset>
        {!asset && <section className="asset-purchase">
          <label className="fin-check"><input type="checkbox" checked={purchase.on} onChange={e=>setPurchase({...purchase,on:e.target.checked})}/> Catat juga pembeliannya sebagai pengeluaran</label>
          {purchase.on ? <>
            <div className="fin-chips wide" role="group" aria-label="Cara bayar"><button type="button" aria-pressed={purchase.settle==="tunai"} onClick={()=>setPurchase({...purchase,settle:"tunai"})}>Dibayar lunas</button><button type="button" aria-pressed={purchase.settle==="tempo"} onClick={()=>setPurchase({...purchase,settle:"tempo"})}>Utang ke pemasok</button></div>
            {purchase.settle==="tunai"
              ? <label className="fin-field"><span className="fin-label">Dibayar dari</span><Select required value={purchase.cash_account_id} onChange={e=>setPurchase({...purchase,cash_account_id:e.target.value})}>{o.cash_accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</Select></label>
              : <label className="fin-field"><span className="fin-label">Pemasok</span><Select required value={purchase.partner_id} onChange={e=>setPurchase({...purchase,partner_id:e.target.value})}><option value="">Pilih pemasok</option>{o.partners.map(partner=><option key={partner.id} value={partner.id}>{partner.name}</option>)}</Select>
                  {!o.partners.length && <small className="fin-hint">Belum ada pemasok. Tambahkan di Pengaturan Keuangan.</small>}</label>}
          </> : <small className="fin-hint">Biarkan mati bila pembeliannya sudah dicatat di Kas &amp; Transaksi, atau aset ini sudah ada sebelum memakai aplikasi.</small>}
        </section>}
        <label className="fin-field"><span className="fin-label">Catatan (opsional)</span><input maxLength={300} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="Nomor seri, lokasi, garansi…"/></label>
        <div className="modal-actions"><button type="button" onClick={close}>Batal</button><button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Simpan"}</button></div>
      </form>
    </Modal>
  );
}

function DisposeForm({ data, asset, close, saved }: { data:Overview; asset:Asset; close:()=>void; saved:()=>void }) {
  const [form,setForm] = useState({ date:data.date, amount:0, cash_account_id:data.options.cash_accounts[0]?.id??"", note:"" });
  const [error,setError] = useState(""), [saving,setSaving] = useState(false);
  // Perkiraan: nilai buku per hari ini; server menghitung ulang setelah penyusutan bulan pelepasan dicatat.
  const preview = useMemo(() => {
    const months = (Number(form.date.slice(0,4))-Number(asset.acquired_on.slice(0,4)))*12 + Number(form.date.slice(5,7))-Number(asset.acquired_on.slice(5,7)) + 1;
    const used = Math.min(asset.life_months, Math.max(0, months));
    const accumulated = used>=asset.life_months ? asset.cost-asset.salvage : asset.monthly*used;
    return { book:asset.cost-accumulated, gain:form.amount-(asset.cost-accumulated) };
  }, [form.date, form.amount, asset]);
  async function submit(event:React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const result = await api<{ asset:{ gain:number } }>(`/operations/finance/assets/${asset.id}/dispose`, { method:"POST", body:JSON.stringify({ ...form, cash_account_id:form.amount?form.cash_account_id:null }) });
      toast.success(result.asset.gain>=0?`Aset dilepas, laba ${money(result.asset.gain)}`:`Aset dilepas, rugi ${money(-result.asset.gain)}`); saved();
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return (
    <Modal title={`Lepas ${asset.name}`} close={close}>
      <form className="fin-form" onSubmit={submit}>
        {error && <ErrorBox message={error}/>}
        <p className="fin-note">Untuk aset yang dijual, rusak, atau hilang. Penyusutan dicatat sampai bulan pelepasan, lalu aset dan akumulasinya dihapus dari neraca.</p>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Tanggal</span><DateInput required value={form.date} min={asset.acquired_on} onChange={e=>e.target.value&&setForm({...form,date:e.target.value})}/></label>
          <AmountField label="Harga jual" value={form.amount} onChange={amount=>setForm({...form,amount})} hint="Isi 0 bila rusak atau hilang."/>
        </div>
        {form.amount>0 && <label className="fin-field"><span className="fin-label">Uang diterima di</span><Select required value={form.cash_account_id} onChange={e=>setForm({...form,cash_account_id:e.target.value})}>{data.options.cash_accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</Select></label>}
        <label className="fin-field"><span className="fin-label">Keterangan (opsional)</span><input maxLength={200} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Mis. dijual ke klub tetangga"/></label>
        <dl className="fin-detail">
          <div><dt>Nilai buku saat dilepas</dt><dd>± {money(preview.book)}</dd></div>
          <div><dt>{preview.gain>=0?"Perkiraan laba":"Perkiraan rugi"}</dt><dd className={preview.gain<0?"minus":"plus"}>{money(Math.abs(preview.gain))}</dd></div>
        </dl>
        <div className="modal-actions"><button type="button" onClick={close}>Batal</button><button className="ops-primary" type="submit" disabled={saving}>{saving?"Memproses…":"Lepas aset"}</button></div>
      </form>
    </Modal>
  );
}

const stateLabel = { sebelum:"Sebelum dicatat", tercatat:"Tercatat", terjadwal:"Terjadwal", dilepas:"Tidak dicatat (dilepas)" };
function ScheduleModal({ asset, close }: { asset:Asset; close:()=>void }) {
  const [data,setData] = useState<Schedule|null>(null);
  useEffect(() => { api<Schedule>(`/operations/finance/assets/${asset.id}`).then(setData).catch(e=>toast.error((e as Error).message)) }, [asset.id]);
  return (
    <Modal title={`Jadwal penyusutan ${asset.name}`} close={close}>
      <div className="fin-form">
        <p className="fin-note">{asset.number} · {money(asset.cost)} · {lifeText(asset.life_months)} · {money(asset.monthly)} per bulan</p>
        {!data ? <p className="empty-state">Memuat…</p> : <div className="asset-schedule"><table>
          <thead><tr><th>Bulan</th><th className="right">Penyusutan</th><th className="right">Nilai buku</th><th>Status</th></tr></thead>
          <tbody>{data.rows.map(item=><tr key={item.period} className={item.state}><td>{monthLabel(item.period)}</td><td className="right">{money(item.amount)}</td><td className="right">{money(item.book_value)}</td><td><span className={`status-pill ${item.state==="tercatat"?"on":item.state==="terjadwal"?"wait":"off"}`}>{stateLabel[item.state]}</span></td></tr>)}</tbody>
        </table></div>}
      </div>
    </Modal>
  );
}
