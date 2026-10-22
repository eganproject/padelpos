"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowDown,ArrowUp,Boxes,CircleDollarSign,Eye,EyeOff,ImagePlus,Pencil,Plus,ShoppingBag,Trash2,TriangleAlert } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { api,money } from "@/lib/api";
import { type Addon,type AddonCategory,type AddonPricing,type AddonSummary,type AddonType,type StockMove,addonCategories,categoryLabel,isLowStock,lineTotal,stockLabel,typeHint,typeLabel,unitLabel } from "@/lib/addons";
import { formatShortDay } from "@/lib/shop";
import { shrink } from "@/lib/image";
import { photoUrl } from "@/lib/venue-info";
import { AddonThumb } from "./addon-icon";
import { ErrorBox,Modal,Submit } from "./operation-ui";
import { Select, MoneyInput } from "./form-controls";

type AddonsData={addons:Addon[];summary:AddonSummary;date:string;time:string;timezone:string};
type AddonForm={name:string;category:AddonCategory;type:AddonType;pricing:AddonPricing;price:number;cost:number;stock:number|null;low_stock:number;max_per_booking:number;description:string;active:boolean;online:boolean};
const types:AddonType[]=["sewa","jual","layanan"];
/** Margin kotor terhadap harga jual, mis. "40%". */
const margin=(price:number,cost:number)=>price>0?`${Math.round((price-cost)/price*100)}%`:"–";
const formFrom=(addon:Addon):AddonForm=>({name:addon.name,category:addon.category,type:addon.type,pricing:addon.pricing,price:addon.price,cost:addon.cost??0,stock:addon.stock,low_stock:addon.low_stock,max_per_booking:addon.max_per_booking,description:addon.description,active:!!addon.active,online:!!addon.online});

export function AddonsPanel(){
  const [data,setData]=useState<AddonsData|null>(null);
  const [error,setError]=useState(""),[query,setQuery]=useState(""),[type,setType]=useState<AddonType|"">("");
  const [editing,setEditing]=useState<Addon|null|undefined>(),[stockOf,setStockOf]=useState<Addon|null>(null),[busy,setBusy]=useState("");
  const load=useCallback(async()=>{try{setData(await api<AddonsData>("/operations/addons"));setError("")}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{void load()},[load]);
  const closeForm=useCallback(()=>setEditing(undefined),[]);
  const closeStock=useCallback(()=>setStockOf(null),[]);
  const reload=useCallback(()=>void load(),[load]);
  const filtering=!!query.trim()||!!type;
  const list=data?data.addons.filter(a=>(!type||a.type===type)&&`${a.name} ${categoryLabel[a.category]} ${a.description}`.toLowerCase().includes(query.trim().toLowerCase())):[];

  async function move(addon:Addon,offset:number){
    if(!data)return;
    const ids=data.addons.map(a=>a.id),from=ids.indexOf(addon.id),to=from+offset;
    if(to<0||to>=ids.length)return;
    [ids[from],ids[to]]=[ids[to],ids[from]];
    setBusy(addon.id);
    try{const result=await api<{addons:Addon[]}>("/operations/addons/order",{method:"PUT",body:JSON.stringify({ids})});setData(d=>d&&{...d,addons:result.addons})}
    catch(e){toast.error((e as Error).message)}finally{setBusy("")}
  }
  async function toggleOnline(addon:Addon){
    setBusy(addon.id);
    try{
      const {addon:saved}=await api<{addon:Addon}>(`/operations/addons/${addon.id}`,{method:"PUT",body:JSON.stringify({...formFrom(addon),online:!addon.online})});
      setData(d=>d&&{...d,addons:d.addons.map(a=>a.id===saved.id?saved:a)});
      toast.success(saved.online?`${saved.name} tampil di halaman pelanggan`:`${saved.name} kini hanya tersedia di kasir`);
    }catch(e){toast.error((e as Error).message)}finally{setBusy("")}
  }
  async function remove(addon:Addon){
    if(!confirm(`Hapus ${addon.name} dari katalog?`))return;
    setBusy(addon.id);
    try{await api(`/operations/addons/${addon.id}`,{method:"DELETE"});toast.success(`${addon.name} dihapus`);await load()}
    catch(e){toast.error((e as Error).message)}finally{setBusy("")}
  }

  const summary=data?.summary;
  const metrics=data&&summary?[
    {label:"Item aktif",value:String(data.addons.filter(a=>a.active).length),hint:`${data.addons.filter(a=>a.active&&a.online).length} tampil di halaman pelanggan`,Icon:ShoppingBag,tone:"violet"},
    {label:"Pendapatan tambahan",value:money(summary.revenue),hint:`30 hari terakhir, termasuk kasir · hari ini ${money(summary.today)}`,Icon:CircleDollarSign,tone:"lime"},
    {label:"Stok menipis",value:String(summary.low_stock.length),hint:summary.low_stock.length?summary.low_stock.map(a=>`${a.name} (${a.stock})`).slice(0,2).join(", "):"Stok aman",Icon:TriangleAlert,tone:"orange"},
  ]:[];

  return <>{error&&<ErrorBox message={error} retry={load}/>}
    <div className="ops-actions"><p>Perubahan harga hanya berlaku untuk booking baru. Tambahan yang sudah tercatat tetap memakai harga saat dipesan.</p><button className="ops-primary" onClick={()=>setEditing(null)}><Plus size={16}/> Tambah item</button></div>
    {!data||!summary?<p className="empty-state">Memuat katalog…</p>:<>
    <p className="ops-muted addon-moved">Barang sewa yang belum kembali kini ada di <Link className="ops-link" href="/admin/bookings?tab=belum-kembali">Booking › Belum kembali</Link>.</p>
    <div className="metric-grid addon-metrics metric-grid-3">{metrics.map(({label,value,hint,Icon,tone})=><article key={label} className={`metric-card ${tone}`}><div className="metric-top"><span><Icon/></span></div><p>{label}</p><h2>{value}</h2><small>{hint}</small></article>)}</div>

    <div className="ops-section-title"><div><h2>Katalog</h2><p>Urutan di sini sama dengan urutan yang dilihat kasir dan pelanggan.</p></div></div>
    {data.addons.length>0&&<div className="ops-filters"><label>Cari item<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama, kategori, atau deskripsi"/></label><label>Jenis<Select value={type} onChange={e=>setType(e.target.value as AddonType|"")}><option value="">Semua jenis</option>{types.map(t=><option key={t} value={t}>{typeLabel[t]}</option>)}</Select></label></div>}
    <div className="manage-table-card ops-table table-cards addon-table"><table><thead><tr><th>Item</th><th>Jenis</th><th>Harga</th><th>Stok</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{list.map((a,index)=>{
      const low=a.active&&isLowStock(a);
      return <tr key={a.id} className={a.active?"":"inactive"}>
        <td className="wide" data-label="Item"><div className="addon-cell"><AddonThumb category={a.category} photoId={a.photo_id}/><div><b>{a.name}</b><small className="table-description">{categoryLabel[a.category]}{a.description?` · ${a.description}`:""}</small></div></div></td>
        <td data-label="Jenis"><span className={`addon-type ${a.type}`}>{typeLabel[a.type]}</span></td>
        <td data-label="Harga">{money(a.price)}<small className="table-description">{unitLabel(a.type,a.pricing)}</small>{a.type==="jual"&&a.stock!==null&&<small className="table-description">{a.cost?`Modal ${money(a.cost)} · margin ${margin(a.price,a.cost)}`:"Harga beli belum diisi"}</small>}<small className="table-description">Maks {a.max_per_booking} per booking</small></td>
        <td data-label="Stok"><span className={`addon-stock${a.stock===null?" unlimited":low?" low":""}`}>{low&&<TriangleAlert size={13} aria-hidden="true"/>}{stockLabel(a)}</span>{a.type==="jual"&&a.stock!==null&&a.low_stock>0&&<small className="table-description">Ingatkan di ≤ {a.low_stock}</small>}</td>
        <td data-label="Status"><span className={`status-pill ${a.active?"on":"off"}`}>{a.active?"Aktif":"Nonaktif"}</span><small className="table-description">{!a.active?"Tidak dapat dipilih":a.online?"Tampil online":"Khusus kasir"}</small></td>
        <td className="actions"><div className="row-actions">
          <button onClick={()=>void move(a,-1)} disabled={filtering||!!busy||index===0} aria-label={`Naikkan ${a.name}`} title={filtering?"Kosongkan pencarian untuk mengubah urutan":"Naikkan"}><ArrowUp/></button>
          <button onClick={()=>void move(a,1)} disabled={filtering||!!busy||index===list.length-1} aria-label={`Turunkan ${a.name}`} title={filtering?"Kosongkan pencarian untuk mengubah urutan":"Turunkan"}><ArrowDown/></button>
          <button onClick={()=>void toggleOnline(a)} disabled={!!busy||!a.active} aria-label={a.online?`Sembunyikan ${a.name} dari pelanggan`:`Tampilkan ${a.name} ke pelanggan`} title={a.online?"Tampil di halaman pelanggan":"Khusus kasir"}>{a.online?<Eye/>:<EyeOff/>}</button>
          <button onClick={()=>setStockOf(a)} disabled={a.stock===null} aria-label={`Stok ${a.name}`} title={a.stock===null?"Stok tidak dibatasi":"Restok, barang rusak, dan riwayat"}><Boxes/></button>
          <button onClick={()=>setEditing(a)} aria-label={`Ubah ${a.name}`}><Pencil/></button>
          <button className="delete" disabled={a.in_use||!!busy} onClick={()=>void remove(a)} aria-label={`Hapus ${a.name}`} title={a.in_use?"Sudah dipakai di booking. Nonaktifkan saja.":"Hapus"}><Trash2/></button>
        </div></td>
      </tr>})}</tbody></table>
      {!data.addons.length?<div className="ops-empty"><h2>Belum ada item</h2><p>Tambahkan sewa raket, bola, sepatu, atau layanan pelatih agar bisa dipilih saat booking.</p></div>:!list.length&&<p className="empty-state">Tidak ada item yang cocok.</p>}
    </div>

    <div className="ops-section-title"><div><h2>Terlaris 30 hari terakhir</h2><p>Dari booking aktif dan selesai serta transaksi kasir sejak {formatShortDay(summary.since)}, termasuk biaya lain di luar katalog.</p></div></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Item</th><th>Jumlah</th><th>Transaksi</th><th>Pendapatan</th></tr></thead><tbody>{summary.top.map(t=><tr key={t.addon_id??t.name}><td className="wide" data-label="Item"><b>{t.name}</b><small className="table-description">{t.type==="lainnya"?"Biaya lain":typeLabel[t.type]}</small></td><td data-label="Jumlah">{t.quantity}</td><td data-label="Transaksi">{t.bookings}</td><td data-label="Pendapatan">{money(t.revenue)}</td></tr>)}</tbody></table>{!summary.top.length&&<p className="empty-state">Belum ada tambahan yang tercatat dalam 30 hari terakhir.</p>}</div>

    {editing!==undefined&&<AddonFormModal addon={editing} close={closeForm} done={()=>{closeForm();void load()}}/>}
    {stockOf&&<StockModal addon={stockOf} close={closeStock} changed={reload}/>}
    </>}
  </>;
}

function AddonFormModal({addon,close,done}:{addon:Addon|null;close:()=>void;done:()=>void}){
  const [form,setForm]=useState<AddonForm>(()=>addon?formFrom(addon):{name:"",category:"raket",type:"sewa",pricing:"per_booking",price:25000,cost:0,stock:10,low_stock:0,max_per_booking:4,description:"",active:true,online:true});
  const [photo,setPhoto]=useState<{file:Blob;preview:string}|null>(null),[dropPhoto,setDropPhoto]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>()=>{if(photo)URL.revokeObjectURL(photo.preview)},[photo]);
  const set=<K extends keyof AddonForm>(key:K,value:AddonForm[K])=>setForm(f=>({...f,[key]:value}));
  const limited=form.stock!==null;
  const locked=!!addon?.in_use;
  const current=photo?.preview??(!dropPhoto&&addon?.photo_id?photoUrl(addon.photo_id):null);
  async function choose(files:FileList|null){
    const file=files?.[0];if(!file)return;
    try{const blob=await shrink(file,1000);setPhoto({file:blob,preview:URL.createObjectURL(blob)});setDropPhoto(false);setError("")}
    catch(e){setError((e as Error).message)}finally{if(input.current)input.current.value=""}
  }
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      // Item nonaktif tidak pernah tampil online; kirim apa yang terlihat di formulir.
      const {addon:saved}=await api<{addon:Addon}>(`/operations/addons${addon?"/"+addon.id:""}`,{method:addon?"PUT":"POST",body:JSON.stringify({...form,online:form.active&&form.online})});
      try{
        if(photo)await api(`/operations/addons/${saved.id}/photo`,{method:"POST",headers:{"Content-Type":photo.file.type},body:photo.file});
        else if(dropPhoto&&saved.photo_id)await api(`/operations/addons/${saved.id}/photo`,{method:"DELETE"});
      }catch(problem){toast.warning(`Item tersimpan, tetapi foto gagal diperbarui: ${(problem as Error).message}`)}
      toast.success(addon?"Item diperbarui":"Item ditambahkan");done();
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Modal title={addon?`Ubah ${addon.name}`:"Tambah item"} close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}
    <label>Nama item<input autoFocus required minLength={2} maxLength={60} value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Mis. Sewa raket"/></label>
    <fieldset className="chip-field"><legend>Jenis</legend>
      <div className="addon-type-picker">{types.map(t=><button type="button" key={t} aria-pressed={form.type===t} disabled={locked&&addon?.type!==t} onClick={()=>setForm(f=>({...f,type:t,pricing:t==="jual"?"per_booking":f.pricing}))}><b>{typeLabel[t]}</b><small>{typeHint[t]}</small></button>)}</div>
      {locked&&<p className="ops-muted">Jenis terkunci karena item ini sudah tercatat di booking.</p>}
    </fieldset>
    <div className="field-grid"><label>Kategori<Select value={form.category} onChange={e=>set("category",e.target.value as AddonCategory)}>{addonCategories.map(c=><option key={c} value={c}>{categoryLabel[c]}</option>)}</Select></label><label>Cara hitung<Select value={form.pricing} disabled={form.type==="jual"} onChange={e=>set("pricing",e.target.value as AddonPricing)}><option value="per_booking">{form.type==="jual"?"Per pcs":"Per booking (sekali bayar)"}</option><option value="per_hour">Per jam main</option></Select></label></div>
    <div className="field-grid"><label>Harga<MoneyInput required min={0} max={10000000} value={form.price} onChange={e=>set("price",Number(e.target.value))}/></label><label>Maksimal per booking<input type="number" required min={1} max={99} step={1} value={form.max_per_booking} onChange={e=>set("max_per_booking",Number(e.target.value))}/></label></div>
    <p className="ops-muted">Contoh: 2 × {money(form.price)} {unitLabel(form.type,form.pricing)}{form.pricing==="per_hour"?", main 1,5 jam":""} = <b>{money(lineTotal(form.price,2,form.pricing,90))}</b></p>
    <label className="switch-field"><input type="checkbox" checked={limited} onChange={e=>set("stock",e.target.checked?(addon?.stock??10):null)}/> {form.type==="layanan"?"Batasi kapasitas pada jam yang sama":"Batasi jumlah stok"}</label>
    {limited&&<div className="field-grid"><label>{form.type==="jual"?"Stok tersedia":form.type==="sewa"?"Jumlah unit dimiliki":"Kapasitas (mis. jumlah pelatih)"}<input type="number" required min={0} max={100000} step={1} value={form.stock??0} onChange={e=>set("stock",Number(e.target.value))}/></label>{form.type==="jual"&&<label>Ingatkan bila stok ≤<input type="number" min={0} max={100000} step={1} value={form.low_stock} onChange={e=>set("low_stock",Number(e.target.value))}/></label>}</div>}
    {limited&&form.type==="jual"&&<><div className="field-grid"><label>Harga beli per pcs<MoneyInput min={0} max={10000000} value={form.cost} onChange={e=>set("cost",Number(e.target.value))}/></label><div className="cost-hint">{form.cost>0?<><small>Margin per pcs</small><b className={form.price<form.cost?"loss":""}>{money(form.price-form.cost)} · {margin(form.price,form.cost)}</b></>:<small>Isi agar laba rugi menghitung harga pokok penjualan.</small>}</div></div>
    <p className="ops-muted">{addon&&addon.cost>0&&form.cost!==addon.cost?`Nilai persediaan ${form.stock??0} pcs ikut disesuaikan ke harga beli baru.`:addon&&!addon.cost&&form.cost>0&&(addon.stock??0)>0?`Stok yang sudah ada (${addon.stock} pcs) dicatat sebagai saldo awal persediaan.`:"Harga beli rata-rata diperbarui otomatis setiap restok yang dicatat sebagai pembelian."}</p></>}
    <p className="ops-muted">{!limited?"Tanpa batas: item selalu bisa dipilih, sampai batas per booking.":form.type==="jual"?"Stok berkurang saat item ditambahkan ke booking dan kembali bila booking dibatalkan.":"Unit hanya terpakai selama jam main booking, lalu tersedia lagi untuk jam berikutnya."}{addon&&addon.stock!==null&&limited?" Untuk restok atau barang rusak, gunakan tombol Stok agar tercatat di riwayat.":""}</p>
    <label>Deskripsi untuk pelanggan (opsional)<textarea maxLength={300} rows={3} value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Mis. raket karbon, cocok untuk pemula."/></label>
    <div className="addon-photo-field">
      <span className="addon-thumb">{/* eslint-disable-next-line @next/next/no-img-element */}{current?<img src={current} alt=""/>:<ImagePlus size={22} aria-hidden="true"/>}</span>
      <div><div className="addon-photo-actions"><button type="button" className="ops-secondary" onClick={()=>input.current?.click()}><ImagePlus size={14}/> {current?"Ganti foto":"Pilih foto"}</button>{current&&<button type="button" className="ops-danger" onClick={()=>{setPhoto(null);setDropPhoto(true)}}>Hapus foto</button>}</div><small className="ops-muted">Opsional. Tanpa foto, ikon kategori yang tampil.</small></div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>void choose(e.target.files)}/>
    </div>
    <label className="switch-field"><input type="checkbox" checked={form.active} onChange={e=>set("active",e.target.checked)}/> Item aktif (bisa dipilih saat booking)</label>
    <label className="switch-field"><input type="checkbox" checked={form.online&&form.active} disabled={!form.active} onChange={e=>set("online",e.target.checked)}/> Tampilkan di halaman pelanggan</label>
  </div><div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy}/></div></form></Modal>;
}

type PurchaseOptions={cash_accounts:{id:string;code:string;name:string}[];partners:{id:string;name:string}[]};
const moveLabel:Record<StockMove["reason"],string>={awal:"Stok awal",restok:"Restok",koreksi:"Hitung ulang",rusak:"Rusak / hilang",terpakai:"Dipakai booking",kembali:"Kembali dari booking"};
/** Gerakan stok dari transaksi kasir memakai sebutan kasir, bukan booking. */
const moveName=(m:StockMove)=>m.sale_id?(m.reason==="terpakai"?"Terjual di kasir":m.reason==="kembali"?"Batal di kasir":moveLabel[m.reason]):moveLabel[m.reason];
const stockReasons=[["restok","Restok","Barang masuk"],["rusak","Rusak / hilang","Barang keluar"],["koreksi","Hitung ulang","Sesuai hitungan fisik"]] as const;
function StockModal({addon,close,changed}:{addon:Addon;close:()=>void;changed:()=>void}){
  const [current,setCurrent]=useState(addon);
  const [moves,setMoves]=useState<StockMove[]|null>(null);
  const [form,setForm]=useState({reason:"restok" as "restok"|"rusak"|"koreksi",quantity:1,note:""});
  // Restok barang jual dicatat sebagai pembelian: harga beli per pcs dan cara bayarnya.
  const sellable=addon.type==="jual";
  const [buy,setBuy]=useState({on:sellable,unit_cost:addon.cost||0,settle:"tunai" as "tunai"|"tempo",cash_account_id:"",partner_id:""});
  const [sources,setSources]=useState<PurchaseOptions|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{api<{moves:StockMove[]}>(`/operations/addons/${addon.id}/stock`).then(r=>setMoves(r.moves)).catch(e=>setError((e as Error).message))},[addon.id]);
  useEffect(()=>{if(!sellable)return;api<PurchaseOptions>("/operations/addons/purchase-options").then(r=>{setSources(r);setBuy(b=>({...b,cash_account_id:b.cash_account_id||r.cash_accounts[0]?.id||""}))}).catch(()=>setSources({cash_accounts:[],partners:[]}))},[sellable]);
  const buying=sellable&&form.reason==="restok"&&buy.on;
  const stock=current.stock??0;
  const next=form.reason==="koreksi"?form.quantity:form.reason==="restok"?stock+form.quantity:stock-form.quantity;
  const unit=current.type==="jual"?"Stok tersisa":current.type==="sewa"?"Unit dimiliki":"Kapasitas";
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      const purchase=buying?{unit_cost:buy.unit_cost,settle:buy.settle,cash_account_id:buy.settle==="tunai"?buy.cash_account_id||null:null,partner_id:buy.settle==="tempo"?buy.partner_id||null:null}:null;
      const result=await api<{addon:Addon;moves:StockMove[]}>(`/operations/addons/${addon.id}/stock`,{method:"POST",body:JSON.stringify({...form,purchase})});
      setCurrent(result.addon);setMoves(result.moves);setForm(f=>({...f,quantity:f.reason==="koreksi"?result.addon.stock??0:1,note:""}));
      setBuy(b=>({...b,unit_cost:result.addon.cost||b.unit_cost}));
      toast.success(purchase?`Stok ${result.addon.name} menjadi ${result.addon.stock}, pembelian ${money(form.quantity*purchase.unit_cost)} tercatat`:`Stok ${result.addon.name} menjadi ${result.addon.stock}`);changed();
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Modal title={`Stok ${current.name}`} close={close}><div className="modal-fields">{error&&<ErrorBox message={error}/>}
    <div className="stock-now"><div><small>{unit}</small><strong>{stock}</strong></div>{isLowStock(current)&&<span className="addon-stock low"><TriangleAlert size={14} aria-hidden="true"/> {stock===0?"Habis":"Menipis"}</span>}</div>
    {current.type!=="jual"&&<p className="ops-muted">Unit sewa tidak berkurang saat dipakai booking. Kurangi hanya bila barang rusak atau hilang.</p>}
    <form onSubmit={submit} className="stock-form">
      <fieldset className="chip-field"><legend>Jenis perubahan</legend><div className="chip-group">{stockReasons.map(([value,label,hint])=><button type="button" key={value} aria-pressed={form.reason===value} title={hint} onClick={()=>setForm(f=>({...f,reason:value,quantity:value==="koreksi"?stock:1}))}>{label}</button>)}</div></fieldset>
      <div className="field-grid"><label>{form.reason==="restok"?"Jumlah masuk":form.reason==="rusak"?"Jumlah rusak atau hilang":"Jumlah fisik sekarang"}<input type="number" required min={form.reason==="koreksi"?0:1} max={100000} step={1} value={form.quantity} onChange={e=>setForm({...form,quantity:Number(e.target.value)})}/></label><label>Keterangan{form.reason==="rusak"?" (wajib)":" (opsional)"}<input maxLength={200} required={form.reason==="rusak"} minLength={form.reason==="rusak"?3:undefined} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder={form.reason==="restok"?"Mis. pembelian dari toko":form.reason==="rusak"?"Mis. senar putus":"Mis. stock opname bulanan"}/></label></div>
      {sellable&&form.reason==="restok"&&<div className="stock-purchase">
        <label className="switch-field"><input type="checkbox" checked={buy.on} onChange={e=>setBuy({...buy,on:e.target.checked})}/> Catat sebagai pembelian (masuk Kas &amp; Transaksi)</label>
        {buy.on&&<>
          <div className="field-grid"><label>Harga beli per pcs<MoneyInput required min={1} max={10000000} value={buy.unit_cost||""} onChange={e=>setBuy({...buy,unit_cost:Number(e.target.value)})}/></label><label>Dibayar<Select value={buy.settle} onChange={e=>setBuy({...buy,settle:e.target.value as "tunai"|"tempo"})}><option value="tunai">Lunas sekarang</option><option value="tempo">Tempo (utang ke pemasok)</option></Select></label></div>
          {buy.settle==="tunai"?<label>Dari akun<Select required value={buy.cash_account_id} onChange={e=>setBuy({...buy,cash_account_id:e.target.value})}>{!sources?.cash_accounts.length&&<option value="">Memuat…</option>}{sources?.cash_accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></label>
            :<label>Pemasok<Select required value={buy.partner_id} onChange={e=>setBuy({...buy,partner_id:e.target.value})}><option value="">Pilih pemasok</option>{sources?.partners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>{sources&&!sources.partners.length&&<small className="ops-muted">Belum ada pemasok. Tambahkan di Pengaturan Keuangan.</small>}</label>}
          <p className="ops-muted">Total pembelian <b>{money(form.quantity*(buy.unit_cost||0))}</b>{current.cost>0&&buy.unit_cost>0&&next>0?` · harga beli rata-rata menjadi ${money(Math.round((stock*current.cost+form.quantity*buy.unit_cost)/next))}`:""}</p>
        </>}
        {!buy.on&&<p className="ops-muted">Pakai ini bila pembeliannya sudah dicatat sendiri di Kas &amp; Transaksi ke akun Persediaan Barang Dagang.</p>}
      </div>}
      {sellable&&current.cost>0&&form.reason!=="restok"&&next!==stock&&next>=0&&<p className="ops-muted">{next<stock?"Kerugian":"Tambahan"} persediaan {money(Math.abs(next-stock)*current.cost)} dicatat ke Selisih &amp; Kerusakan Persediaan.</p>}
      <p className={`stock-preview${next<0?" invalid":""}`}>{stock} → <b>{next<0?"tidak cukup":next}</b></p>
      <Submit busy={busy||next<0||next===stock}>Simpan perubahan stok</Submit>
    </form>
    <h3>Riwayat stok</h3>
    {!moves?<p className="ops-muted">Memuat riwayat…</p>:moves.length?moves.map(m=><div className="ops-history" key={m.id}><div><b>{moveName(m)}{m.booking_customer?` · ${m.booking_customer}`:""}{m.sale_number?` · ${m.sale_number}`:""}</b><small>{new Date(m.created_at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}{m.actor?` · ${m.actor}`:""}{m.note?` · ${m.note}`:""}{m.unit_cost&&m.reason==="restok"?` · beli @ ${money(m.unit_cost)}`:""}{m.record_number?` · ${m.record_number}`:""}</small></div><strong className={`stock-delta ${m.delta>0?"plus":"minus"}`}>{m.delta>0?"+":"−"}{Math.abs(m.delta)}<small> sisa {m.stock_after}</small></strong></div>):<p className="ops-muted">Belum ada perubahan stok.</p>}
  </div><div className="modal-actions"><button type="button" onClick={close}>Selesai</button></div></Modal>;
}
