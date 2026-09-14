"use client";
import { useCallback,useEffect,useState } from "react";
import { PackageCheck,PackagePlus,Plus } from "lucide-react";
import { toast } from "sonner";
import { api,money } from "@/lib/api";
import { type Booking,type Context,type Payment,quote,statusLabel,statusTone,timeSlots,minute } from "@/lib/operations";
import { type AddonOption,type BookingAddon,unitLabel } from "@/lib/addons";
import { formatShortDay } from "@/lib/shop";
import { AddonLinesEditor,type Draft,clampDrafts,draftPayload,draftsFrom,draftsTotal } from "./addon-lines";
import { ErrorBox,Modal,Submit } from "./operation-ui";

const optionsUrl=(date:string,start:string,end:string,booking?:string)=>`/operations/addons/options?date=${date}&start=${start}&end=${end}${booking?`&booking=${booking}`:""}`;
const hoursLabel=(value:number)=>`${(value/60).toLocaleString("id-ID")} jam`;
/** Nominal bawaan formulir: sisa tagihan, atau dana yang perlu dikembalikan bila batal. */
const due=(booking:Booking)=>booking.status==="cancelled"?booking.paid:booking.total-booking.paid;

export function BookingsPanel(){
  const [data,setData]=useState<{bookings:Booking[];date:string;timezone:string}|null>(null);
  const [date,setDate]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("");
  const [error,setError]=useState(""),[creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null);
  const load=useCallback(async()=>{try{setData(await api("/operations/bookings"));setError("")}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{void load()},[load]);
  const closeCreate=useCallback(()=>setCreating(false),[]);
  const closeDetail=useCallback(()=>setSelected(null),[]);
  const list=data?.bookings.filter(b=>(!date||b.date===date)&&(!status||b.status===status)&&`${b.customer} ${b.phone} ${b.court_name} ${b.id}`.toLowerCase().includes(query.toLowerCase()))||[];
  return <>{error&&<ErrorBox message={error} retry={load}/>}<div className="ops-actions"><p>Semua jam mengikuti zona waktu venue ({data?.timezone||"…"}).</p><button className="ops-primary" onClick={()=>setCreating(true)}><Plus size={16}/> Booking baru</button></div>
    <div className="ops-filters"><label>Cari pelanggan / lapangan<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama, telepon, atau kode booking"/></label><label>Tanggal<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Semua status</option>{Object.entries(statusLabel).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label><button className="ops-secondary" onClick={()=>setDate(data?.date||"")}>Hari ini</button><button className="ops-secondary" onClick={()=>{setDate("");setStatus("");setQuery("")}}>Reset</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>PELANGGAN</th><th>LAPANGAN / JADWAL</th><th>STATUS</th><th>TAGIHAN</th><th>PEMBAYARAN NETO</th><th>AKSI</th></tr></thead><tbody>{list.map(b=><tr key={b.id}><td className="wide" data-label="Pelanggan"><b>{b.customer}</b><small className="table-description">{b.phone} · {b.id.slice(0,8).toUpperCase()}</small></td><td className="wide" data-label="Lapangan & jadwal">{b.court_name}<small className="table-description">{formatShortDay(b.date)} · {b.start_time} – {b.end_time}</small></td><td data-label="Status"><span className={`status-pill ${statusTone[b.status]}`}>{statusLabel[b.status]}</span></td><td data-label="Tagihan">{money(b.total)}{b.addon_count>0&&<small className="table-description">Termasuk tambahan {money(b.total-b.court_total)}</small>}</td><td data-label="Pembayaran neto">{money(b.paid)}<small className="table-description">{b.status==="cancelled"?(b.paid>0?"Perlu pengembalian":"Tidak ada saldo"):(b.paid===b.total?"Lunas":`Sisa ${money(b.total-b.paid)}`)}</small></td><td className="actions"><button className="ops-secondary" onClick={()=>setSelected(b.id)}>Detail / bayar</button></td></tr>)}</tbody></table>{!data?<p className="empty-state">Memuat booking…</p>:!list.length&&<div className="ops-empty"><h2>Belum ada booking yang sesuai</h2><p>Buat reservasi pertama atau ubah filter pencarian.</p></div>}</div>
    {creating&&<BookingForm close={closeCreate} done={id=>{closeCreate();setSelected(id);void load()}}/>}
    {selected&&<BookingDetail id={selected} close={closeDetail} changed={()=>void load()}/>}
  </>;
}
function BookingForm({close,done}:{close:()=>void;done:(id:string)=>void}){
  const [context,setContext]=useState<Context|null>(null);
  const [form,setForm]=useState({court_id:"",customer:"",phone:"",date:"",start_time:"",end_time:"",notes:""});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(true);
  const [drafts,setDrafts]=useState<Draft[]>([]),[options,setOptions]=useState<AddonOption[]|null>(null);
  useEffect(()=>{
    let active=true;setRefreshing(true);
    api<Context>("/operations/context"+(form.date?"?date="+form.date:"")).then(data=>{
      if(!active)return;setContext(data);setError("");
      setForm(previous=>{
        const court=data.courts.find(c=>c.id===previous.court_id&&c.active)||data.courts.find(c=>c.active);
        const starts=court?timeSlots(minute(court.opens_at),minute(court.closes_at)-30).filter(t=>(previous.date||data.date)!==data.date||t>=data.time):[];
        const start=previous.start_time||starts[0]||"";
        return {...previous,court_id:court?.id||"",date:previous.date||data.date,start_time:start,end_time:previous.end_time||(start?timeSlots(minute(start)+30,minute(start)+30)[0]:"")};
      });
    }).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setRefreshing(false)});
    return()=>{active=false};
  },[form.date]);
  const court=context?.courts.find(c=>c.id===form.court_id);
  const starts=court?timeSlots(minute(court.opens_at),minute(court.closes_at)-30):[];
  const ends=court?timeSlots(minute(court.opens_at)+30,minute(court.closes_at)):[];
  const schedule=context?[...context.schedule.filter(b=>b.court_id===form.court_id).map(b=>({...b,label:"Dipesan"})),...context.maintenance.filter(m=>m.court_id===form.court_id).map(m=>({...m,label:"Perawatan"}))].sort((a,b)=>a.start_time.localeCompare(b.start_time)):[];
  const conflict=schedule.some(s=>s.start_time<form.end_time&&s.end_time>form.start_time);
  const validTime=!!court&&form.start_time>=court.opens_at&&form.end_time<=court.closes_at&&form.start_time<form.end_time;
  const price=court&&context&&validTime?quote(court,context.price_rules,form.date,form.start_time,form.end_time):0;
  const duration=validTime?minute(form.end_time)-minute(form.start_time):0;
  const extras=draftsTotal(drafts,duration);
  // Stok raket dan barang sewa lain bergantung pada jam main, jadi dimuat ulang setiap jam berubah.
  useEffect(()=>{
    if(!validTime||!form.date){setOptions(null);return}
    let active=true;
    api<{addons:AddonOption[]}>(optionsUrl(form.date,form.start_time,form.end_time)).then(result=>{if(!active)return;setOptions(result.addons);setDrafts(current=>clampDrafts(current,result.addons))}).catch(()=>{if(active)setOptions([])});
    return()=>{active=false};
  },[form.date,form.start_time,form.end_time,validTime]);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{const result=await api<{booking:Booking}>("/operations/bookings",{method:"POST",body:JSON.stringify({...form,addons:draftPayload(drafts)})});toast.success("Booking berhasil dibuat");done(result.booking.id)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title="Booking baru" close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}<p className="ops-muted">Waktu lapangan: {context?.timezone||"…"}. Durasi kelipatan 30 menit.</p>
    {context&&!context.courts.some(c=>c.active)?<p>Belum ada lapangan aktif. Tambahkan melalui menu Lapangan terlebih dahulu.</p>:<>
    <label>Lapangan<select required value={form.court_id} onChange={e=>{const selected=context?.courts.find(c=>c.id===e.target.value);setForm({...form,court_id:e.target.value,start_time:selected?.opens_at||"",end_time:selected?timeSlots(minute(selected.opens_at)+30,minute(selected.opens_at)+30)[0]:""})}}><option value="" disabled>Pilih lapangan</option>{context?.courts.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name} · {money(c.hourly_rate)}/jam</option>)}</select></label>
    <label>Tanggal<input required type="date" min={context?.date} value={form.date} onChange={e=>setForm({...form,date:e.target.value,start_time:"",end_time:""})}/></label>
    <div className="ops-schedule"><b>Jadwal terisi · {form.date?formatShortDay(form.date):"…"}</b>{refreshing?<p>Memperbarui jadwal…</p>:schedule.length?schedule.map(s=><span key={s.id}>{s.start_time} – {s.end_time} · {s.label}</span>):<p>Belum ada booking atau perawatan.</p>}</div>
    <div className="field-grid"><label>Mulai<select required value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value,end_time:timeSlots(minute(e.target.value)+30,minute(e.target.value)+30)[0]})}><option value="" disabled>Pilih jam</option>{starts.map(t=><option key={t} disabled={form.date===context?.date&&t<context.time}>{t}</option>)}</select></label><label>Selesai<select required value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}><option value="" disabled>Pilih jam</option>{ends.map(t=><option key={t} disabled={t<=form.start_time}>{t}</option>)}</select></label></div>
    {conflict&&<ErrorBox message="Jam yang dipilih bertabrakan dengan jadwal terisi."/>}
    <div className="field-grid"><label>Nama pelanggan<input required minLength={2} maxLength={80} value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></label><label>Nomor telepon<input required minLength={9} maxLength={18} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label></div><label>Catatan (opsional)<textarea maxLength={500} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
    <h3 className="modal-subhead">Sewa & tambahan <small>opsional</small></h3>
    {validTime?<AddonLinesEditor options={options} drafts={drafts} onChange={setDrafts} duration={duration}/>:<p className="ops-muted">Pilih jam main untuk melihat stok raket, bola, dan tambahan lain.</p>}
    <div className="ops-total"><span>Sewa lapangan</span><strong>{money(price)}</strong></div>
    {extras>0&&<div className="ops-total"><span>Tambahan</span><strong>{money(extras)}</strong></div>}
    <div className="ops-total"><span>Total tagihan</span><strong>{money(price+extras)}</strong></div><p className="ops-muted">Booking langsung dikonfirmasi. Catat DP atau pelunasan pada halaman detail setelah menyimpan.</p></>}
    </div><div className="modal-actions"><button type="button" onClick={close}>Batal</button><Submit busy={busy||refreshing||!validTime||conflict}>Simpan booking</Submit></div></form></Modal>;
}

type Detail={booking:Booking;payments:Payment[];addons:BookingAddon[]};
function BookingDetail({id,close,changed}:{id:string;close:()=>void;changed:()=>void}){
  const [data,setData]=useState<Detail|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[reason,setReason]=useState("");
  const [form,setForm]=useState({id:crypto.randomUUID(),amount:0,kind:"payment" as "payment"|"refund",method:"cash",note:""});
  const [editing,setEditing]=useState(false),[drafts,setDrafts]=useState<Draft[]>([]),[options,setOptions]=useState<AddonOption[]|null>(null);
  const load=useCallback(async()=>{try{const data=await api<Detail>(`/operations/bookings/${id}`);setData(data);setForm(p=>({...p,kind:data.booking.status==="cancelled"?"refund":"payment",amount:due(data.booking)}));setError("")}catch(e){setError((e as Error).message)}},[id]);
  useEffect(()=>{void load()},[load]);
  const booking=data?.booking,lines=data?.addons??[];
  const duration=booking?minute(booking.end_time)-minute(booking.start_time):0;
  /** Gabungkan respons server; tagihan bisa berubah sehingga nominal bawaan ikut disegarkan. */
  const merge=(result:Partial<Detail>&{booking:Booking})=>{setData(d=>d&&{...d,...result});setForm(p=>({...p,id:crypto.randomUUID(),amount:due(result.booking)}))};
  async function pay(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{const result=await api<{booking:Booking;payments:Payment[]}>(`/operations/bookings/${id}/payments`,{method:"POST",body:JSON.stringify(form)});merge(result);setForm(p=>({...p,note:""}));toast.success(form.kind==="refund"?"Pengembalian dicatat":"Pembayaran dicatat");changed()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function status(value:"cancelled"|"completed"){
    if(value==="cancelled"&&!confirm("Batalkan booking ini? Pembayaran yang sudah diterima perlu dikembalikan dan dicatat terpisah."))return;
    setBusy(true);setError("");try{await api(`/operations/bookings/${id}/status`,{method:"PATCH",body:JSON.stringify({status:value,reason})});toast.success("Status booking diperbarui");await load();changed()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function editAddons(){
    if(!booking)return;
    setDrafts(draftsFrom(lines));setOptions(null);setEditing(true);setError("");
    try{setOptions((await api<{addons:AddonOption[]}>(optionsUrl(booking.date,booking.start_time,booking.end_time,booking.id))).addons)}
    catch(e){setError((e as Error).message);setEditing(false)}
  }
  async function saveAddons(){
    setBusy(true);setError("");
    try{const result=await api<{booking:Booking;addons:BookingAddon[]}>(`/operations/bookings/${id}/addons`,{method:"PUT",body:JSON.stringify({lines:draftPayload(drafts)})});merge(result);setEditing(false);toast.success("Tambahan booking disimpan");changed()}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function markReturned(lineIds:string[],returned:boolean){
    setBusy(true);setError("");
    try{const result=await api<{booking:Booking;addons:BookingAddon[]}>(`/operations/bookings/${id}/addons/returned`,{method:"PATCH",body:JSON.stringify({line_ids:lineIds,returned})});setData(d=>d&&{...d,...result});toast.success(returned?"Barang ditandai sudah kembali":"Tanda kembali dibatalkan")}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  const refundable=booking?.status==="cancelled"&&(booking.paid>0),payable=booking?.status==="confirmed"&&booking.total>booking.paid;
  const canReturn=booking?.status==="confirmed"||booking?.status==="completed";
  const unreturned=lines.filter(l=>l.type==="sewa"&&!l.returned_at);
  const draftSum=draftsTotal(drafts,duration);
  return <Modal title="Detail booking" close={close}><div className="modal-fields">{error&&<ErrorBox message={error} retry={!data?load:undefined}/>}
    {!booking?<p>Memuat booking…</p>:<><div className="ops-detail-head"><div><h3>{booking.customer}</h3><p>{booking.phone}</p><small>{booking.id.slice(0,8).toUpperCase()}</small></div><span className={`status-pill ${statusTone[booking.status]}`}>{statusLabel[booking.status]}</span></div><p><b>{booking.court_name}</b><br/>{formatShortDay(booking.date)} · {booking.start_time} – {booking.end_time}</p>{booking.notes&&<p>Catatan: {booking.notes}</p>}
    {(lines.length>0||booking.status==="confirmed")&&<section className="ops-addons" aria-label="Sewa dan tambahan">
      <div className="ops-card-head"><h3>Sewa & tambahan</h3>{booking.status==="confirmed"&&!editing&&<button type="button" className="ops-secondary" disabled={busy} onClick={()=>void editAddons()}><PackagePlus size={14}/> {lines.length?"Ubah tambahan":"Tambah"}</button>}</div>
      {editing?<>
        <AddonLinesEditor options={options} drafts={drafts} onChange={setDrafts} duration={duration} allowCustom/>
        <p className="ops-muted">Tagihan baru: {money(booking.court_total)} lapangan + {money(draftSum)} tambahan = <b>{money(booking.court_total+draftSum)}</b>{booking.paid>0?`. Sudah dibayar ${money(booking.paid)}; tagihan tidak dapat turun di bawah angka ini.`:"."}</p>
        <div className="addon-edit-actions"><button type="button" className="ops-secondary" disabled={busy} onClick={()=>setEditing(false)}>Batal</button><button type="button" className="ops-primary" disabled={busy||!options} onClick={()=>void saveAddons()}>{busy?"Menyimpan…":"Simpan tambahan"}</button></div>
      </>:lines.length?<ul className="addon-summary-lines">{lines.map(line=><li key={line.id}>
        <div><b>{line.quantity}× {line.name}</b><small>{money(line.unit_price)} {unitLabel(line.type,line.pricing)}{line.pricing==="per_hour"?` × ${hoursLabel(duration)}`:""}{line.type==="lainnya"?" · biaya lain":""}</small>
          {line.type==="sewa"&&<span className="addon-return-row"><span className={`addon-return${line.returned_at?" done":""}`}>{line.returned_at?"Sudah kembali":"Belum kembali"}</span>{canReturn&&<button type="button" className="ops-link-button" disabled={busy} onClick={()=>void markReturned([line.id],!line.returned_at)}>{line.returned_at?"Batalkan tanda":"Tandai kembali"}</button>}</span>}
        </div><strong>{money(line.subtotal)}</strong>
      </li>)}</ul>:<p className="ops-muted">Belum ada sewa raket, bola, atau tambahan lain.</p>}
      {!editing&&canReturn&&unreturned.length>1&&<button type="button" className="ops-secondary addon-return-all" disabled={busy} onClick={()=>void markReturned(unreturned.map(l=>l.id),true)}><PackageCheck size={14}/> Tandai semua barang sewa kembali</button>}
    </section>}
    <div className="ops-total"><span>Sewa lapangan</span><strong>{money(booking.court_total)}</strong></div>{booking.total!==booking.court_total&&<div className="ops-total"><span>Tambahan</span><strong>{money(booking.total-booking.court_total)}</strong></div>}<div className="ops-total"><span>Total tagihan</span><strong>{money(booking.total)}</strong></div><div className="ops-total"><span>Pembayaran neto</span><strong>{money(booking.paid)}</strong></div><div className="ops-total"><span>{booking.status==="cancelled"?"Perlu dikembalikan":"Sisa tagihan"}</span><strong>{money(due(booking))}</strong></div>
    {booking.cancel_reason&&<p>Alasan pembatalan: {booking.cancel_reason}</p>}
    {(payable||refundable)&&<form onSubmit={pay} className="ops-payment"><h3>{refundable?"Catat pengembalian dana":"Catat DP / pelunasan"}</h3><p className="ops-muted">Pastikan uang sudah {refundable?"dikembalikan":"diterima"}. Formulir ini mencatat transaksi manual.</p><div className="field-grid"><label>Nominal (Rp)<input required type="number" min={1} max={refundable?booking.paid:booking.total-booking.paid} step={1} value={form.amount} onChange={e=>setForm({...form,id:crypto.randomUUID(),amount:Number(e.target.value)})}/></label><label>Metode<select value={form.method} onChange={e=>setForm({...form,id:crypto.randomUUID(),method:e.target.value})}><option value="cash">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option></select></label></div><label>Catatan / referensi{refundable?" (wajib)":" (opsional)"}<input required={!!refundable} minLength={refundable?3:undefined} maxLength={200} value={form.note} onChange={e=>setForm({...form,id:crypto.randomUUID(),note:e.target.value})}/></label><Submit busy={busy}>{refundable?"Catat pengembalian":"Catat pembayaran"}</Submit></form>}
    <h3>Riwayat pembayaran</h3>{data!.payments.length?data!.payments.map(p=><div className="ops-history" key={p.id}><div><b>{p.kind==="refund"?"Pengembalian":"Pembayaran"} · {p.method.toUpperCase()}</b><small>{new Date(p.created_at).toLocaleString("id-ID")} {p.note&&"· "+p.note}</small></div><strong>{p.kind==="refund"?"−":""}{money(p.amount)}</strong></div>):<p className="ops-muted">Belum ada pembayaran.</p>}
    {booking.status==="confirmed"&&<div className="ops-status-actions"><h3>Status reservasi</h3><button className="ops-secondary" disabled={busy||booking.paid<booking.total} onClick={()=>void status("completed")}>Tandai selesai</button><p className="ops-muted">Sesi dapat diselesaikan setelah jam berakhir dan tagihan lunas.{unreturned.length>0?` Masih ada ${unreturned.reduce((sum,l)=>sum+l.quantity,0)} barang sewa yang belum kembali.`:""}</p><label>Alasan pembatalan<input minLength={3} maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Wajib diisi untuk membatalkan"/></label><button className="ops-danger" disabled={busy||reason.trim().length<3} onClick={()=>void status("cancelled")}>Batalkan booking</button>{lines.some(l=>l.type==="jual")&&<p className="ops-muted">Stok barang jual pada booking ini kembali otomatis saat dibatalkan.</p>}</div>}
    </>}
  </div><div className="modal-actions"><button type="button" onClick={close}>Tutup</button></div></Modal>;
}
