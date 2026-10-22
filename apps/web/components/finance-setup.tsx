"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  type Account, type AccountSubtype, type AccountType, type Partner, type Setup,
  formatDate, methodLabels, money, partnerKindLabel, subtypeLabel, typeLabel,
} from "@/lib/finance";
import { Modal } from "./operation-ui";
import { Empty } from "./finance-ui";
import { Select, DateInput } from "./form-controls";
import { ClosingView } from "./finance-closing";

const typeOrder: AccountType[] = ["aset","liabilitas","ekuitas","pendapatan","beban"];
const subtypesFor: Record<AccountType,AccountSubtype[]> = {
  aset:["kas_bank","piutang","persediaan","aset_tetap"], liabilitas:["utang"], ekuitas:["modal"], pendapatan:["pendapatan"], beban:["beban"],
};

export function SetupTab({ setup, reload }: { setup:Setup; reload:()=>void }) {
  const [view,setView] = useState<"akun"|"pihak"|"kas"|"tutup">("akun");
  return (
    <div className="fin-setup">
      <div className="fin-subtabs" role="tablist" aria-label="Pengaturan keuangan">
        <button type="button" role="tab" aria-selected={view==="akun"} onClick={()=>setView("akun")}>Daftar akun</button>
        <button type="button" role="tab" aria-selected={view==="pihak"} onClick={()=>setView("pihak")}>Pemasok & pihak lain</button>
        <button type="button" role="tab" aria-selected={view==="kas"} onClick={()=>setView("kas")}>Kas & penguncian</button>
        <button type="button" role="tab" aria-selected={view==="tutup"} onClick={()=>setView("tutup")}>Tutup buku</button>
      </div>
      {view==="akun" && <AccountsView setup={setup} reload={reload}/>}
      {view==="pihak" && <PartnersView setup={setup} reload={reload}/>}
      {view==="kas" && <CashView setup={setup} reload={reload}/>}
      {view==="tutup" && <ClosingView reload={reload}/>}
    </div>
  );
}

function AccountsView({ setup, reload }: { setup:Setup; reload:()=>void }) {
  const [editing,setEditing] = useState<Account|null>(null);
  const [creating,setCreating] = useState(false);
  const groups = useMemo(() => typeOrder.map(type => ({ type, accounts: setup.accounts.filter(account => account.type===type) })).filter(group => group.accounts.length), [setup.accounts]);
  async function remove(account:Account) {
    if (!confirm(`Hapus akun ${account.name}?`)) return;
    try { await api(`/operations/finance/accounts/${account.id}`,{method:"DELETE"}); toast.success("Akun dihapus"); reload() }
    catch (error) { toast.error((error as Error).message) }
  }
  return (
    <div className="fin-report">
      <div className="fin-report-head">
        <div><h3>Daftar akun</h3><p>Kelompok tempat setiap rupiah dicatat. Akun bawaan sudah cukup untuk kebanyakan venue — tambah baru hanya bila perlu rincian sendiri.</p></div>
        <div className="fin-report-actions"><button type="button" className="ops-primary" onClick={()=>setCreating(true)}><Plus size={14}/> Tambah akun</button></div>
      </div>
      {groups.map(group => (
        <section className="fin-sheet" key={group.type}>
          <header><h4>{typeLabel[group.type]}</h4><span>{group.accounts.length} akun</span></header>
          <table><tbody>{group.accounts.map(account => (
            <tr key={account.id}>
              <td className="fin-cell-name">
                <b>{account.name}</b>
                <small>{account.code} · {subtypeLabel[account.subtype]}{account.system_key?" · bawaan":""}{!account.active?" · nonaktif":""}</small>
                {account.description && <small className="fin-account-note">{account.description}</small>}
              </td>
              <td className="actions"><div className="row-actions">
                <button type="button" onClick={()=>setEditing(account)} aria-label={`Ubah ${account.name}`} title="Ubah"><Pencil/></button>
                <button type="button" className="delete" disabled={!!account.system_key} onClick={()=>void remove(account)} aria-label={`Hapus ${account.name}`} title={account.system_key?"Akun bawaan tidak dapat dihapus":"Hapus"}><Trash2/></button>
              </div></td>
            </tr>
          ))}</tbody></table>
        </section>
      ))}
      {(creating||editing) && <AccountForm account={editing} close={()=>{setCreating(false);setEditing(null)}} saved={()=>{setCreating(false);setEditing(null);reload()}}/>}
    </div>
  );
}

function AccountForm({ account, close, saved }: { account?:Account|null; close:()=>void; saved:()=>void }) {
  const [form,setForm] = useState({
    code: account?.code ?? "", name: account?.name ?? "", type: account?.type ?? ("beban" as AccountType),
    subtype: account?.subtype ?? ("beban" as AccountSubtype), description: account?.description ?? "", active: account ? account.active===1 : true,
  });
  const [saving,setSaving] = useState(false);
  const locked = !!account?.system_key;
  async function submit(event:React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      await api(`/operations/finance/accounts${account?`/${account.id}`:""}`,{ method: account?"PUT":"POST", body: JSON.stringify(form) });
      toast.success(account?"Akun diperbarui":"Akun ditambahkan"); saved();
    } catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Modal title={account?`Ubah akun ${account.name}`:"Akun baru"} close={close}>
      <form className="fin-form" onSubmit={submit}>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Kode</span>
            <input value={form.code} required maxLength={12} placeholder="5-150" onChange={e=>setForm({...form,code:e.target.value})}/>
            <small className="fin-hint">Angka berurut, mis. 5-150 untuk biaya baru.</small>
          </label>
          <label className="fin-field"><span className="fin-label">Nama akun</span>
            <input value={form.name} required minLength={3} maxLength={60} placeholder="Air Minum Pemain" onChange={e=>setForm({...form,name:e.target.value})}/>
          </label>
        </div>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Jenis</span>
            <Select value={form.type} disabled={locked} onChange={e=>{ const type=e.target.value as AccountType; setForm({...form,type,subtype:subtypesFor[type][0]}) }}>
              {typeOrder.map(type => <option key={type} value={type}>{typeLabel[type]}</option>)}
            </Select>
          </label>
          <label className="fin-field"><span className="fin-label">Kelompok</span>
            <Select value={form.subtype} disabled={locked} onChange={e=>setForm({...form,subtype:e.target.value as AccountSubtype})}>
              {subtypesFor[form.type].map(subtype => <option key={subtype} value={subtype}>{subtypeLabel[subtype]}</option>)}
            </Select>
          </label>
        </div>
        {form.subtype==="kas_bank" && <p className="fin-note">Akun kas &amp; bank otomatis muncul sebagai pilihan sumber dana pada formulir catatan.</p>}
        <label className="fin-field"><span className="fin-label">Penjelasan <em>(opsional)</em></span>
          <input value={form.description} maxLength={200} placeholder="Bantu staf memilih akun yang tepat" onChange={e=>setForm({...form,description:e.target.value})}/>
        </label>
        <label className="fin-check"><input type="checkbox" checked={form.active} disabled={locked} onChange={e=>setForm({...form,active:e.target.checked})}/> Akun aktif</label>
        <div className="modal-actions"><button type="button" onClick={close}>Batal</button><button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Simpan"}</button></div>
      </form>
    </Modal>
  );
}

function PartnersView({ setup, reload }: { setup:Setup; reload:()=>void }) {
  const [editing,setEditing] = useState<Partner|null>(null);
  const [creating,setCreating] = useState(false);
  async function remove(partner:Partner) {
    if (!confirm(`Hapus ${partner.name} dari daftar?`)) return;
    try { await api(`/operations/finance/partners/${partner.id}`,{method:"DELETE"}); toast.success("Dihapus"); reload() }
    catch (error) { toast.error((error as Error).message) }
  }
  return (
    <div className="fin-report">
      <div className="fin-report-head">
        <div><h3>Pemasok &amp; pihak lain</h3><p>Dipakai saat mencatat pembelian yang belum dibayar, supaya buku besar pembantu utang menunjukkan siapa yang harus dibayar.</p></div>
        <div className="fin-report-actions"><button type="button" className="ops-primary" onClick={()=>setCreating(true)}><Plus size={14}/> Tambah</button></div>
      </div>
      <div className="manage-table-card ops-table table-cards">
        <table>
          <thead><tr><th>Nama</th><th>Jenis</th><th>Telepon</th><th>Catatan</th><th>Aksi</th></tr></thead>
          <tbody>{setup.partners.map(partner => (
            <tr key={partner.id}>
              <td className="wide" data-label="Nama"><b>{partner.name}</b>{!partner.active && <small className="table-description">Nonaktif</small>}</td>
              <td data-label="Jenis">{partnerKindLabel[partner.kind]}</td>
              <td data-label="Telepon">{partner.phone||"—"}</td>
              <td data-label="Catatan">{partner.note||"—"}</td>
              <td className="actions"><div className="row-actions">
                <button type="button" onClick={()=>setEditing(partner)} aria-label={`Ubah ${partner.name}`} title="Ubah"><Pencil/></button>
                <button type="button" className="delete" onClick={()=>void remove(partner)} aria-label={`Hapus ${partner.name}`} title="Hapus"><Trash2/></button>
              </div></td>
            </tr>
          ))}</tbody>
        </table>
        {!setup.partners.length && <Empty title="Belum ada pemasok" text="Nama pemasok juga bisa ditambahkan langsung dari formulir pengeluaran."/>}
      </div>
      {(creating||editing) && <PartnerForm partner={editing} close={()=>{setCreating(false);setEditing(null)}} saved={()=>{setCreating(false);setEditing(null);reload()}}/>}
    </div>
  );
}

function PartnerForm({ partner, close, saved }: { partner?:Partner|null; close:()=>void; saved:()=>void }) {
  const [form,setForm] = useState({
    name: partner?.name ?? "", kind: partner?.kind ?? ("pemasok" as Partner["kind"]),
    phone: partner?.phone ?? "", note: partner?.note ?? "", active: partner ? partner.active===1 : true,
  });
  const [saving,setSaving] = useState(false);
  async function submit(event:React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      await api(`/operations/finance/partners${partner?`/${partner.id}`:""}`,{ method: partner?"PUT":"POST", body: JSON.stringify(form) });
      toast.success(partner?"Data diperbarui":"Ditambahkan"); saved();
    } catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Modal title={partner?`Ubah ${partner.name}`:"Pemasok baru"} close={close}>
      <form className="fin-form" onSubmit={submit}>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Nama</span><input value={form.name} required minLength={2} maxLength={60} onChange={e=>setForm({...form,name:e.target.value})}/></label>
          <label className="fin-field"><span className="fin-label">Jenis</span>
            <Select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as Partner["kind"]})}>
              {(Object.keys(partnerKindLabel) as Partner["kind"][]).map(kind => <option key={kind} value={kind}>{partnerKindLabel[kind]}</option>)}
            </Select>
          </label>
        </div>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Telepon <em>(opsional)</em></span><input value={form.phone} maxLength={20} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
          <label className="fin-field"><span className="fin-label">Catatan <em>(opsional)</em></span><input value={form.note} maxLength={200} onChange={e=>setForm({...form,note:e.target.value})}/></label>
        </div>
        <label className="fin-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Masih dipakai</label>
        <div className="modal-actions"><button type="button" onClick={close}>Batal</button><button className="ops-primary" type="submit" disabled={saving}>{saving?"Menyimpan…":"Simpan"}</button></div>
      </form>
    </Modal>
  );
}

function CashView({ setup, reload }: { setup:Setup; reload:()=>void }) {
  const cash = setup.accounts.filter(account => account.is_cash && account.active);
  // Rekening yang sudah dinonaktifkan tidak ada di pilihan. Nilai awal disamakan dengan yang tampil di
  // layar supaya yang tersimpan sama dengan yang dilihat admin.
  const [form,setForm] = useState(() => {
    const valid = (id?:string) => cash.some(account => account.id===id);
    const fallback = valid(setup.settings.default_cash_account) ? setup.settings.default_cash_account : cash[0]?.id ?? "";
    return {
      cash_accounts: Object.fromEntries(methodLabels.map(method => [method.key, valid(setup.settings.cash_accounts[method.key]) ? setup.settings.cash_accounts[method.key] : fallback])) as Record<string,string>,
      default_cash_account: fallback,
      locked_until: setup.settings.locked_until,
      tax: { ...setup.settings.tax },
    };
  });
  const [saving,setSaving] = useState(false);
  const stored = setup.settings;
  const dirty = !(methodLabels.every(method => stored.cash_accounts[method.key]===form.cash_accounts[method.key])
    && stored.default_cash_account===form.default_cash_account && stored.locked_until===form.locked_until
    && JSON.stringify(stored.tax)===JSON.stringify(form.tax));
  const sample = 300000, sampleTax = form.tax.enabled ? (form.tax.inclusive ? Math.round(sample*form.tax.rate/(100+form.tax.rate)) : Math.round(sample*form.tax.rate/100)) : 0;
  async function submit(event:React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try { await api("/operations/finance/settings",{method:"PUT",body:JSON.stringify(form)}); toast.success("Pengaturan disimpan"); reload() }
    catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <form className="fin-report" onSubmit={submit}>
      <div className="fin-report-head"><div><h3>Kas &amp; penguncian</h3><p>Menentukan ke rekening mana setiap pembayaran pelanggan dicatat, dan sampai kapan pembukuan lama dibekukan.</p></div></div>
      <section className="fin-sheet">
        <header><h4>Uang pelanggan masuk ke mana</h4></header>
        <div className="fin-method-grid">
          {methodLabels.map(method => (
            <label className="fin-field" key={method.key}><span className="fin-label">{method.label}</span>
              <Select value={form.cash_accounts[method.key]}
                onChange={e=>setForm({...form,cash_accounts:{...form.cash_accounts,[method.key]:e.target.value}})}>
                {cash.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </Select>
            </label>
          ))}
        </div>
        <label className="fin-field"><span className="fin-label">Akun bawaan formulir</span>
          <Select value={form.default_cash_account} onChange={e=>setForm({...form,default_cash_account:e.target.value})}>
            {cash.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </Select>
          <small className="fin-hint">Dipakai sebagai pilihan awal saat mencatat pengeluaran atau pemasukan.</small>
        </label>
      </section>
      <section className="fin-sheet">
        <header><h4>Pajak pada tagihan booking</h4></header>
        <label className="fin-check"><input type="checkbox" checked={form.tax.enabled} onChange={e=>setForm({...form,tax:{...form.tax,enabled:e.target.checked}})}/> Tagih pajak pada booking baru</label>
        {form.tax.enabled && (
          <>
            <div className="fin-form-grid">
              <label className="fin-field"><span className="fin-label">Nama pajak</span>
                <input value={form.tax.label} required minLength={2} maxLength={20} placeholder="PB1 atau PPN" onChange={e=>setForm({...form,tax:{...form.tax,label:e.target.value}})}/>
              </label>
              <label className="fin-field"><span className="fin-label">Tarif (%)</span>
                <input type="number" required min={0.01} max={100} step={0.01} value={form.tax.rate||""} onChange={e=>setForm({...form,tax:{...form.tax,rate:Number(e.target.value)}})}/>
              </label>
            </div>
            <div className="fin-chips wide" role="group" aria-label="Cara menghitung pajak">
              <button type="button" aria-pressed={!form.tax.inclusive} onClick={()=>setForm({...form,tax:{...form.tax,inclusive:false}})}>Ditambahkan ke harga</button>
              <button type="button" aria-pressed={form.tax.inclusive} onClick={()=>setForm({...form,tax:{...form.tax,inclusive:true}})}>Sudah termasuk harga</button>
            </div>
            <small className="fin-hint">
              Contoh booking {money(sample)}: {form.tax.inclusive
                ? `pelanggan membayar ${money(sample)}, di dalamnya ${form.tax.label||"pajak"} ${money(sampleTax)}.`
                : `pelanggan membayar ${money(sample+sampleTax)}, termasuk ${form.tax.label||"pajak"} ${money(sampleTax)}.`}
              {" "}Pajak dicatat ke Utang Pajak, bukan pendapatan. Booking yang sudah ada tidak berubah.
            </small>
          </>
        )}
      </section>
      <section className="fin-sheet">
        <header><h4>Biaya admin Midtrans</h4></header>
        <p className="fin-note">Tarif per metode dan siapa yang menanggungnya diatur di <Link href="/admin/payments">Pembayaran Online</Link>. Potongan Midtrans dicatat ke Biaya Bank &amp; Payment Gateway; biaya layanan yang dibayar pelanggan dicatat ke Pendapatan Biaya Layanan Pembayaran.</p>
      </section>
      <section className="fin-sheet">
        <header><h4><Lock size={15}/> Kunci pembukuan</h4></header>
        <label className="fin-field"><span className="fin-label">Bekukan catatan sampai tanggal</span>
          <DateInput value={form.locked_until} onChange={e=>setForm({...form,locked_until:e.target.value})}/>
          <small className="fin-hint">
            {form.locked_until
              ? `Catatan manual bertanggal ${formatDate(form.locked_until)} ke belakang tidak dapat diubah lagi.`
              : "Kosongkan bila belum perlu. Isi setelah laporan bulanan selesai agar angkanya tidak berubah diam-diam."}
          </small>
        </label>
        <p className="fin-note">Kunci juga berlaku untuk jurnal otomatis: membatalkan, memberi potongan, atau menambah barang pada booking bertanggal terkunci akan ditolak sampai kuncinya dibuka. Tutup buku tahunan otomatis mengunci sampai 31 Desember tahun itu.</p>
      </section>
      <div className={`cms-savebar${dirty?" dirty":""}`}>
        <span>{dirty ? "Ada perubahan yang belum disimpan." : setup.settings.updated_at ? `Terakhir disimpan ${new Date(setup.settings.updated_at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}.` : "Masih memakai pengaturan bawaan."}</span>
        <button className="ops-primary" type="submit" disabled={!dirty||saving}>{saving?"Menyimpan…":"Simpan pengaturan"}</button>
      </div>
    </form>
  );
}
