"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Check, ImagePlus, Landmark, Pencil, Plus, Receipt, Search, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { shrink } from "@/lib/image";
import {
  type FinanceRecord, type RecordKind, type Setup,
  categoryGroupLabel, formatDate, isCategory, money, partnerKindLabel, usableCash,
} from "@/lib/finance";
import { Modal } from "./operation-ui";
import { AmountField, Empty } from "./finance-ui";
import { Select, DateInput } from "./form-controls";

type Data = { records:FinanceRecord[]; count:number; expense:number; income:number; unsettled:number };
type Range = { from:string; to:string };

const cashAccounts = (setup:Setup) => setup.accounts.filter(account => account.is_cash && account.active);
const accountName = (setup:Setup, id:string|null|undefined) => setup.accounts.find(account => account.id===id)?.name ?? "—";

export type RecordAction = RecordKind | "transfer" | "modal";

/** Daftar pengeluaran dan pemasukan: satu tempat untuk seluruh pencatatan harian. */
export function RecordsTab({ setup, range, today, initial=null, onChanged }: { setup:Setup; range:Range; today:string; initial?:RecordAction|null; onChanged:()=>void }) {
  const [data,setData] = useState<Data|null>(null);
  const [kind,setKind] = useState<""|RecordKind>("");
  const [status,setStatus] = useState<"semua"|"belum">("semua");
  const [category,setCategory] = useState("");
  const [term,setTerm] = useState("");
  const [busy,setBusy] = useState("");
  const [editing,setEditing] = useState<FinanceRecord|null>(null);
  const [creating,setCreating] = useState<RecordAction|null>(initial);
  const [settling,setSettling] = useState<FinanceRecord|null>(null);
  const [viewing,setViewing] = useState<FinanceRecord|null>(null);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ from:range.from, to:range.to, status, q:term });
    if (kind) query.set("kind", kind);
    if (category) query.set("account_id", category);
    try { setData(await api<Data>(`/operations/finance/records?${query}`)) }
    catch (error) { toast.error((error as Error).message) }
  }, [range.from, range.to, status, term, kind, category]);
  useEffect(() => { const timer=setTimeout(()=>void load(),term?250:0); return ()=>clearTimeout(timer) }, [load, term]);

  const refresh = () => { void load(); onChanged() };
  async function remove(record:FinanceRecord) {
    if (!confirm(`Hapus ${record.number} (${record.description})? Jurnalnya ikut dihapus.`)) return;
    setBusy(record.id);
    try { await api(`/operations/finance/records/${record.id}`,{method:"DELETE"}); toast.success("Catatan dihapus"); refresh() }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy("") }
  }
  async function unsettle(record:FinanceRecord) {
    setBusy(record.id);
    try { await api(`/operations/finance/records/${record.id}/unsettle`,{method:"POST",body:"{}"}); toast.success("Status lunas dibatalkan"); refresh() }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy("") }
  }

  const categories = setup.accounts.filter(account => isCategory(account,"pengeluaran") || isCategory(account,"pemasukan"));
  return (
    <div className="fin-records">
      <div className="fin-quick">
        <button type="button" className="ops-primary" onClick={()=>setCreating("pengeluaran")}><Plus size={14}/> Catat pengeluaran</button>
        <button type="button" className="ops-secondary" onClick={()=>setCreating("pemasukan")}><Plus size={14}/> Catat pemasukan</button>
        <button type="button" className="ops-secondary" onClick={()=>setCreating("transfer")}><ArrowLeftRight size={14}/> Pindah dana</button>
        <button type="button" className="ops-secondary" onClick={()=>setCreating("modal")}><Landmark size={14}/> Modal pemilik</button>
      </div>
      <div className="fin-toolbar">
        <div className="fin-chips" role="group" aria-label="Jenis catatan">
          <button type="button" aria-pressed={kind===""} onClick={()=>setKind("")}>Semua</button>
          <button type="button" aria-pressed={kind==="pengeluaran"} onClick={()=>setKind("pengeluaran")}>Pengeluaran</button>
          <button type="button" aria-pressed={kind==="pemasukan"} onClick={()=>setKind("pemasukan")}>Pemasukan</button>
        </div>
        <label className="fin-search"><Search size={15} aria-hidden="true"/>
          <input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Cari keterangan, nomor, atau pemasok…" aria-label="Cari catatan"/>
        </label>
        <label className="fin-inline-field"><span>Kategori</span>
          <Select value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="">Semua kategori</option>
            {categories.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </Select>
        </label>
        <label className="fin-check"><input type="checkbox" checked={status==="belum"} onChange={e=>setStatus(e.target.checked?"belum":"semua")}/> Belum dibayar saja</label>
      </div>

      <div className="fin-totals">
        <div><span>Pengeluaran</span><strong className="minus">{money(data?.expense??0)}</strong></div>
        <div><span>Pemasukan</span><strong className="plus">{money(data?.income??0)}</strong></div>
        <div><span>Belum dibayar</span><strong>{money(data?.unsettled??0)}</strong></div>
      </div>

      <div className="manage-table-card ops-table table-cards">
        <table>
          <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Kategori</th><th>Cara bayar</th><th className="right">Jumlah</th><th>Aksi</th></tr></thead>
          <tbody>{(data?.records??[]).map(record => (
            <tr key={record.id}>
              <td data-label="Tanggal">{formatDate(record.date)}<small className="table-description">{record.number}</small></td>
              <td className="wide" data-label="Keterangan">
                <b>{record.description}</b>
                <small className="table-description">{record.partner_name ? `${record.partner_name}` : record.kind==="pengeluaran" ? "Pengeluaran" : "Pemasukan"}{record.photo_id ? " · ada bukti" : ""}</small>
              </td>
              <td data-label="Kategori">{record.account_name}</td>
              <td data-label="Cara bayar">
                {record.settle==="tunai"
                  ? <span className="fin-tag">Lunas · {record.cash_account_name}</span>
                  : record.settled_at
                    ? <span className="fin-tag ok">Lunas {formatDate(record.settled_at)}</span>
                    : <span className="fin-tag warn">Belum dibayar{record.due_date?` · jatuh tempo ${formatDate(record.due_date)}`:""}</span>}
              </td>
              <td className="right" data-label="Jumlah"><b className={record.kind==="pengeluaran"?"minus":"plus"}>{record.kind==="pengeluaran"?"−":"+"}{money(record.amount)}</b></td>
              <td className="actions">
                <div className="row-actions">
                  <button type="button" onClick={()=>setViewing(record)} aria-label={`Rincian ${record.number}`} title="Rincian & bukti"><Receipt/></button>
                  {record.settle==="tempo" && !record.settled_at && (
                    <button type="button" onClick={()=>setSettling(record)} aria-label={`Tandai lunas ${record.number}`} title="Tandai sudah dibayar"><Check/></button>
                  )}
                  {record.settled_at && (
                    <button type="button" disabled={busy===record.id} onClick={()=>void unsettle(record)} aria-label={`Batalkan lunas ${record.number}`} title="Batalkan status lunas"><Undo2/></button>
                  )}
                  <button type="button" onClick={()=>setEditing(record)} aria-label={`Ubah ${record.number}`} title="Ubah"><Pencil/></button>
                  <button type="button" className="delete" disabled={busy===record.id} onClick={()=>void remove(record)} aria-label={`Hapus ${record.number}`} title="Hapus"><Trash2/></button>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
        {data && data.count>data.records.length && (
          <p className="fin-note">Menampilkan {data.records.length} catatan terbaru dari {data.count}. Total di atas sudah menghitung semuanya; persempit periode atau pencarian untuk melihat sisanya.</p>
        )}
        {data && !data.records.length && (
          <Empty title="Belum ada catatan pada periode ini"
            text="Mulai dari tombol “Catat pengeluaran”. Setiap catatan otomatis masuk ke laba rugi, neraca, dan buku besar." />
        )}
      </div>

      {creating==="transfer" && <TransferForm setup={setup} today={today} close={()=>setCreating(null)} saved={()=>{setCreating(null);refresh()}}/>}
      {creating==="modal" && <EquityForm setup={setup} today={today} close={()=>setCreating(null)} saved={()=>{setCreating(null);refresh()}}/>}
      {((creating && creating!=="transfer" && creating!=="modal")||editing) && (
        <RecordForm setup={setup} today={today} kind={editing?.kind ?? creating as RecordKind} record={editing}
          close={()=>{setCreating(null);setEditing(null)}} saved={()=>{setCreating(null);setEditing(null);refresh()}}/>
      )}
      {settling && <SettleForm setup={setup} today={today} record={settling} close={()=>setSettling(null)} saved={()=>{setSettling(null);refresh()}}/>}
      {viewing && <RecordDetail setup={setup} record={viewing} close={()=>setViewing(null)} changed={refresh}/>}
    </div>
  );
}

// --- Formulir catatan ------------------------------------------------------

type Form = { kind:RecordKind; date:string; account_id:string; amount:number; settle:"tunai"|"tempo"; cash_account_id:string; partner_id:string; description:string; due_date:string };

export function RecordForm({ setup, today, kind, record, close, saved }: { setup:Setup; today:string; kind:RecordKind; record?:FinanceRecord|null; close:()=>void; saved:()=>void }) {
  const cash = cashAccounts(setup);
  const [form,setForm] = useState<Form>(() => ({
    kind: record?.kind ?? kind,
    date: record?.date ?? today,
    account_id: record?.account_id ?? "",
    amount: record?.amount ?? 0,
    settle: record?.settle ?? "tunai",
    // Akun kas yang sudah nonaktif tidak ada di pilihan, jadi nilai awal disamakan dengan yang tampil.
    cash_account_id: usableCash(setup, record?.cash_account_id ?? setup.settings.default_cash_account),
    partner_id: record?.partner_id ?? "",
    description: record?.description ?? "",
    due_date: record?.due_date ?? "",
  }));
  const [saving,setSaving] = useState(false);
  const [newPartner,setNewPartner] = useState("");
  const [adding,setAdding] = useState(false);
  const [partners,setPartners] = useState(setup.partners);
  const set = <K extends keyof Form>(key:K, value:Form[K]) => setForm(current => ({ ...current, [key]:value }));

  const groups = useMemo(() => {
    const usable = setup.accounts.filter(account => isCategory(account, form.kind));
    return Object.entries(categoryGroupLabel[form.kind]).map(([type,label]) => ({ label, accounts: usable.filter(account => account.type===type) })).filter(group => group.accounts.length);
  }, [setup.accounts, form.kind]);
  const category = setup.accounts.find(account => account.id===form.account_id);

  async function addPartner() {
    if (newPartner.trim().length < 2) return toast.error("Isi nama minimal 2 karakter");
    setAdding(true);
    try {
      const { partner } = await api<{partner:{id:string;name:string;kind:"pemasok";phone:string;note:string;active:number;created_at:string}}>("/operations/finance/partners",{method:"POST",body:JSON.stringify({name:newPartner.trim(),kind:"pemasok",phone:"",note:"",active:true})});
      setPartners(current => [...current, partner].sort((a,b)=>a.name.localeCompare(b.name)));
      set("partner_id", partner.id); setNewPartner("");
      toast.success(`${partner.name} ditambahkan`);
    } catch (error) { toast.error((error as Error).message) }
    finally { setAdding(false) }
  }
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (!form.account_id) return toast.error("Pilih dulu kategorinya");
    if (form.amount <= 0) return toast.error("Isi jumlahnya");
    setSaving(true);
    try {
      const body = {
        kind: form.kind, date: form.date, account_id: form.account_id, amount: form.amount, settle: form.settle,
        cash_account_id: form.settle==="tunai" ? form.cash_account_id : null,
        partner_id: form.partner_id || null, description: form.description, due_date: form.settle==="tempo" ? form.due_date : "",
      };
      await api(`/operations/finance/records${record?`/${record.id}`:""}`,{ method: record?"PUT":"POST", body: JSON.stringify(body) });
      toast.success(record ? "Catatan diperbarui" : form.kind==="pengeluaran" ? "Pengeluaran tercatat" : "Pemasukan tercatat");
      saved();
    } catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }

  const expense = form.kind==="pengeluaran";
  const counterName = form.settle==="tunai" ? accountName(setup, form.cash_account_id) : expense ? "Utang Usaha" : "Piutang Lain-lain";
  const preview = expense
    ? [{ side:"Debit", name: category?.name ?? "Kategori" }, { side:"Kredit", name: counterName }]
    : [{ side:"Debit", name: counterName }, { side:"Kredit", name: category?.name ?? "Kategori" }];

  return (
    <Modal title={record ? `Ubah ${record.number}` : expense ? "Catat pengeluaran" : "Catat pemasukan"} close={close}>
      <form className="fin-form" onSubmit={submit}>
        {!record && (
          <div className="fin-chips wide" role="group" aria-label="Jenis catatan">
            <button type="button" aria-pressed={expense} onClick={()=>{set("kind","pengeluaran");set("account_id","")}}>Uang keluar</button>
            <button type="button" aria-pressed={!expense} onClick={()=>{set("kind","pemasukan");set("account_id","")}}>Uang masuk</button>
          </div>
        )}
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Tanggal</span>
            <DateInput value={form.date} onChange={e=>e.target.value&&set("date",e.target.value)} required/>
          </label>
          <AmountField label="Jumlah" value={form.amount} onChange={value=>set("amount",value)} autoFocus={!record}/>
        </div>
        <label className="fin-field"><span className="fin-label">{expense ? "Untuk apa uangnya?" : "Dari apa uangnya?"}</span>
          <Select value={form.account_id} onChange={e=>set("account_id",e.target.value)} required>
            <option value="">Pilih kategori…</option>
            {groups.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </optgroup>
            ))}
          </Select>
          {category?.description && <small className="fin-hint">{category.description}</small>}
        </label>
        <label className="fin-field"><span className="fin-label">Keterangan</span>
          <input value={form.description} maxLength={200} required minLength={3}
            placeholder={expense ? "Mis. Token listrik Agustus" : "Mis. Sewa ruang untuk acara komunitas"}
            onChange={e=>set("description",e.target.value)}/>
        </label>

        <fieldset className="fin-fieldset">
          <legend>{expense ? "Sudah dibayar?" : "Sudah diterima?"}</legend>
          <div className="fin-chips wide">
            <button type="button" aria-pressed={form.settle==="tunai"} onClick={()=>set("settle","tunai")}>{expense?"Sudah dibayar":"Sudah diterima"}</button>
            <button type="button" aria-pressed={form.settle==="tempo"} onClick={()=>set("settle","tempo")}>{expense?"Belum — jadi utang":"Belum — jadi tagihan"}</button>
          </div>
          {form.settle==="tunai" ? (
            <label className="fin-field"><span className="fin-label">{expense ? "Uangnya diambil dari" : "Uangnya masuk ke"}</span>
              <Select value={form.cash_account_id} onChange={e=>set("cash_account_id",e.target.value)} required>
                {cash.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </Select>
            </label>
          ) : (
            <div className="fin-form-grid">
              <label className="fin-field"><span className="fin-label">{expense ? "Kepada siapa" : "Dari siapa"}</span>
                <Select value={form.partner_id} onChange={e=>set("partner_id",e.target.value)} required>
                  <option value="">Pilih…</option>
                  {partners.filter(partner => partner.active).map(partner => <option key={partner.id} value={partner.id}>{partner.name} · {partnerKindLabel[partner.kind]}</option>)}
                </Select>
                <small className="fin-hint">Dipakai untuk buku besar pembantu {expense?"utang":"piutang"}.</small>
              </label>
              <label className="fin-field"><span className="fin-label">Jatuh tempo <em>(opsional)</em></span>
                <DateInput value={form.due_date} min={form.date} onChange={e=>set("due_date",e.target.value)}/>
              </label>
            </div>
          )}
          {form.settle==="tempo" && (
            <div className="fin-addpartner">
              <input value={newPartner} maxLength={60} placeholder="Nama baru, mis. Toko Bola Jaya" onChange={e=>setNewPartner(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); void addPartner() } }}/>
              <button type="button" className="ops-secondary" disabled={adding||!newPartner.trim()} onClick={()=>void addPartner()}><Plus size={14}/> Tambah</button>
            </div>
          )}
        </fieldset>

        <div className="fin-preview">
          <b>Nanti tercatat begini</b>
          <table><tbody>
            {preview.map(row => (
              <tr key={row.side}><td>{row.side}</td><td>{row.name}</td><td className="right">{money(form.amount)}</td></tr>
            ))}
          </tbody></table>
          <small>Setiap catatan selalu punya dua sisi yang jumlahnya sama. Itulah yang membuat neraca tidak pernah pincang.</small>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={close}>Batal</button>
          <button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Simpan"}</button>
        </div>
      </form>
    </Modal>
  );
}

function SettleForm({ setup, today, record, close, saved }: { setup:Setup; today:string; record:FinanceRecord; close:()=>void; saved:()=>void }) {
  const cash = cashAccounts(setup);
  const [date,setDate] = useState(today > record.date ? today : record.date);
  const [account,setAccount] = useState(usableCash(setup, setup.settings.default_cash_account));
  const [note,setNote] = useState("");
  const [saving,setSaving] = useState(false);
  const expense = record.kind==="pengeluaran";
  async function submit(event:React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      await api(`/operations/finance/records/${record.id}/settle`,{method:"POST",body:JSON.stringify({date,cash_account_id:account,note})});
      toast.success(expense ? "Utang ditandai lunas" : "Tagihan ditandai diterima");
      saved();
    } catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Modal title={expense ? "Tandai utang sudah dibayar" : "Tandai tagihan sudah diterima"} close={close}>
      <form className="fin-form" onSubmit={submit}>
        <p className="fin-note">{record.number} · {record.description} · <b>{money(record.amount)}</b>{record.partner_name?` · ${record.partner_name}`:""}</p>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Tanggal pembayaran</span>
            <DateInput value={date} min={record.date} onChange={e=>e.target.value&&setDate(e.target.value)} required/>
          </label>
          <label className="fin-field"><span className="fin-label">{expense ? "Dibayar dari" : "Diterima di"}</span>
            <Select value={account} onChange={e=>setAccount(e.target.value)} required>
              {cash.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        </div>
        <label className="fin-field"><span className="fin-label">Catatan <em>(opsional)</em></span>
          <input value={note} maxLength={120} placeholder="Mis. transfer BCA 12.30" onChange={e=>setNote(e.target.value)}/>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={close}>Batal</button>
          <button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Tandai lunas"}</button>
        </div>
      </form>
    </Modal>
  );
}

function RecordDetail({ setup, record, close, changed }: { setup:Setup; record:FinanceRecord; close:()=>void; changed:()=>void }) {
  const [current,setCurrent] = useState(record);
  const [busy,setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function upload(file:File) {
    setBusy(true);
    try {
      const blob = await shrink(file);
      const { record:saved } = await api<{record:FinanceRecord}>(`/operations/finance/records/${current.id}/receipt`,{method:"POST",headers:{"Content-Type":blob.type},body:blob});
      setCurrent(saved); toast.success("Bukti tersimpan"); changed();
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  async function drop() {
    setBusy(true);
    try {
      const { record:saved } = await api<{record:FinanceRecord}>(`/operations/finance/records/${current.id}/receipt`,{method:"DELETE"});
      setCurrent(saved); toast.success("Bukti dihapus"); changed();
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }
  const receipt = current.photo_id ? `/api/operations/finance/records/${current.id}/receipt?v=${current.photo_id}` : "";
  return (
    <Modal title={`${current.number} · ${current.description}`} close={close}>
      <div className="fin-form">
        <dl className="fin-detail">
          <div><dt>Tanggal</dt><dd>{formatDate(current.date)}</dd></div>
          <div><dt>Jenis</dt><dd>{current.kind==="pengeluaran"?"Uang keluar":"Uang masuk"}</dd></div>
          <div><dt>Kategori</dt><dd>{current.account_name} <small>({current.account_code})</small></dd></div>
          <div><dt>Jumlah</dt><dd><b>{money(current.amount)}</b></dd></div>
          <div><dt>Cara bayar</dt><dd>{current.settle==="tunai" ? `Langsung dari ${accountName(setup,current.cash_account_id)}` : current.settled_at ? `Dibayar ${formatDate(current.settled_at)}` : "Belum dibayar"}</dd></div>
          {current.partner_name && <div><dt>Pihak</dt><dd>{current.partner_name}</dd></div>}
          {current.due_date && <div><dt>Jatuh tempo</dt><dd>{formatDate(current.due_date)}</dd></div>}
          <div><dt>Nomor jurnal</dt><dd>{current.entry_number ?? "—"}</dd></div>
        </dl>
        <div className="fin-receipt">
          <b>Bukti / nota</b>
          {receipt
            ? <a href={receipt} target="_blank" rel="noopener"><img src={receipt} alt={`Bukti ${current.number}`}/></a>
            : <p className="fin-hint">Belum ada foto bukti. Unggah foto nota agar mudah dicek saat tutup buku.</p>}
          <div className="fin-receipt-actions">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={e=>{ const file=e.target.files?.[0]; e.target.value=""; if(file) void upload(file) }}/>
            <button type="button" className="ops-secondary" disabled={busy} onClick={()=>input.current?.click()}>
              <ImagePlus size={14}/> {receipt?"Ganti foto":"Unggah bukti"}
            </button>
            {receipt && <button type="button" className="ops-danger" disabled={busy} onClick={()=>void drop()}>Hapus bukti</button>}
          </div>
        </div>
        <div className="modal-actions"><button type="button" onClick={close}>Tutup</button></div>
      </div>
    </Modal>
  );
}

// --- Pindah dana dan modal pemilik ----------------------------------------

export function TransferForm({ setup, today, close, saved }: { setup:Setup; today:string; close:()=>void; saved:()=>void }) {
  const cash = cashAccounts(setup);
  const [form,setForm] = useState({ date:today, from_account_id:cash[0]?.id??"", to_account_id:cash[1]?.id??cash[0]?.id??"", amount:0, memo:"" });
  const [saving,setSaving] = useState(false);
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (form.amount<=0) return toast.error("Isi jumlahnya");
    setSaving(true);
    try { await api("/operations/finance/transfer",{method:"POST",body:JSON.stringify(form)}); toast.success("Perpindahan dana tercatat"); saved() }
    catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Modal title="Pindah dana antar kas" close={close}>
      <form className="fin-form" onSubmit={submit}>
        <p className="fin-note">Mis. menyetorkan uang tunai kasir ke rekening bank. Ini bukan pemasukan maupun pengeluaran, jadi laba rugi tidak berubah.</p>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Tanggal</span><DateInput value={form.date} onChange={e=>e.target.value&&setForm({...form,date:e.target.value})} required/></label>
          <AmountField label="Jumlah" value={form.amount} onChange={amount=>setForm({...form,amount})} autoFocus/>
        </div>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Dari</span>
            <Select value={form.from_account_id} onChange={e=>setForm({...form,from_account_id:e.target.value})}>{cash.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </label>
          <label className="fin-field"><span className="fin-label">Ke</span>
            <Select value={form.to_account_id} onChange={e=>setForm({...form,to_account_id:e.target.value})}>{cash.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </label>
        </div>
        <label className="fin-field"><span className="fin-label">Keterangan <em>(opsional)</em></span><input value={form.memo} maxLength={200} onChange={e=>setForm({...form,memo:e.target.value})} placeholder="Mis. setor tunai harian"/></label>
        <div className="modal-actions"><button type="button" onClick={close}>Batal</button><button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Simpan"}</button></div>
      </form>
    </Modal>
  );
}

export function EquityForm({ setup, today, close, saved }: { setup:Setup; today:string; close:()=>void; saved:()=>void }) {
  const cash = cashAccounts(setup);
  const [form,setForm] = useState<{date:string;direction:"setor"|"ambil";cash_account_id:string;amount:number;memo:string}>({
    date:today, direction:"setor", cash_account_id:usableCash(setup, setup.settings.default_cash_account), amount:0, memo:"",
  });
  const [saving,setSaving] = useState(false);
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (form.amount<=0) return toast.error("Isi jumlahnya");
    setSaving(true);
    try { await api("/operations/finance/equity",{method:"POST",body:JSON.stringify(form)}); toast.success("Tercatat"); saved() }
    catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Modal title="Modal & pengambilan pemilik" close={close}>
      <form className="fin-form" onSubmit={submit}>
        <p className="fin-note">Uang pemilik yang masuk atau keluar bukan pendapatan dan bukan biaya, jadi hanya terlihat di neraca.</p>
        <div className="fin-chips wide" role="group" aria-label="Arah">
          <button type="button" aria-pressed={form.direction==="setor"} onClick={()=>setForm({...form,direction:"setor"})}><Landmark size={14}/> Pemilik menyetor</button>
          <button type="button" aria-pressed={form.direction==="ambil"} onClick={()=>setForm({...form,direction:"ambil"})}><ArrowLeftRight size={14}/> Pemilik mengambil</button>
        </div>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Tanggal</span><DateInput value={form.date} onChange={e=>e.target.value&&setForm({...form,date:e.target.value})} required/></label>
          <AmountField label="Jumlah" value={form.amount} onChange={amount=>setForm({...form,amount})} autoFocus/>
        </div>
        <label className="fin-field"><span className="fin-label">{form.direction==="setor"?"Masuk ke":"Diambil dari"}</span>
          <Select value={form.cash_account_id} onChange={e=>setForm({...form,cash_account_id:e.target.value})}>{cash.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </label>
        <label className="fin-field"><span className="fin-label">Keterangan <em>(opsional)</em></span><input value={form.memo} maxLength={200} onChange={e=>setForm({...form,memo:e.target.value})}/></label>
        <div className="modal-actions"><button type="button" onClick={close}>Batal</button><button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Simpan"}</button></div>
      </form>
    </Modal>
  );
}
