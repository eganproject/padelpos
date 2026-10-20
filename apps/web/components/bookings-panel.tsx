"use client";
import { useCallback,useEffect,useState } from "react";
import { BadgeCheck,CalendarClock,Copy,CreditCard,PackageCheck,PackagePlus,Plus,Printer } from "lucide-react";
import { toast } from "sonner";
import { api,money } from "@/lib/api";
import { type Booking,type Context,type Payment,quote,statusLabel,statusTone,timeSlots,minute } from "@/lib/operations";
import { type AddonOption,type BookingAddon,unitLabel } from "@/lib/addons";
import { type PaymentIntent,intentLabel,intentTone,methodLabel } from "@/lib/payments";
import { formatShortDay } from "@/lib/shop";
import { billOf,taxName } from "@/lib/bill";
import { AddonLinesEditor,type Draft,clampDrafts,draftPayload,draftsFrom,draftsTotal } from "./addon-lines";
import { ErrorBox,Modal,Submit } from "./operation-ui";
import { MemberPicker } from "./member-picker";
import { type LookupMember,memberCut } from "@/lib/members";
import { Select, DateInput, MoneyInput } from "./form-controls";

const optionsUrl=(date:string,start:string,end:string,booking?:string)=>`/operations/addons/options?date=${date}&start=${start}&end=${end}${booking?`&booking=${booking}`:""}`;
/** Potongan member untuk tagihan kasir; biaya lain yang diketik manual tidak didiskon. */
const memberCutOf=(booking:Booking,court:number,drafts:Draft[],duration:number)=>booking.membership_id?memberCut(court,draftsTotal(drafts.filter(d=>d.type!=="lainnya"),duration),{court:booking.member_court_rate??0,addon:booking.member_addon_rate??0}):0;
const hoursLabel=(value:number)=>`${(value/60).toLocaleString("id-ID")} jam`;
/** Booking yang tidak lagi ditagih: batal, atau hold online yang lewat batas bayarnya. */
const closed=(booking:Booking)=>booking.status==="cancelled"||booking.status==="expired";
/** Uang yang harus dikembalikan: pembayaran booking batal/kedaluwarsa yang tidak ditahan sebagai denda, atau kelebihan bayar booking aktif. */
const refundDue=(booking:Booking)=>closed(booking)?Math.max(0,booking.paid-booking.forfeited):Math.max(0,booking.paid-booking.total);
/** Nominal bawaan formulir: dana yang perlu dikembalikan, atau sisa tagihan. */
const due=(booking:Booking)=>refundDue(booking)>0?refundDue(booking):Math.max(0,booking.total-booking.paid);
/** Keterangan di bawah pembayaran neto, sesuai status booking. */
function balanceNote(b:Booking){
  if(refundDue(b)>0)return "Perlu pengembalian";
  if(closed(b))return "Tidak ada saldo";
  if(b.status==="pending")return "Menunggu pembayaran online";
  return b.paid>=b.total?"Lunas":`Sisa ${money(b.total-b.paid)}`;
}
/** Jam mulai pertama yang belum lewat untuk lapangan itu pada tanggal yang dipilih. */
function firstStart(court:{opens_at:string;closes_at:string},date:string,context:Context|null){
  const starts=timeSlots(minute(court.opens_at),minute(court.closes_at)-30);
  return (context&&date===context.date?starts.find(t=>t>=context.time):starts[0])??"";
}

export function BookingsPanel(){
  const [data,setData]=useState<{bookings:Booking[];truncated:boolean;date:string;timezone:string}|null>(null);
  const [date,setDate]=useState(""),[query,setQuery]=useState(""),[status,setStatus]=useState("");
  const [error,setError]=useState(""),[creating,setCreating]=useState(false),[selected,setSelected]=useState<string|null>(null);
  // Pencarian dikirim ke server setelah berhenti mengetik sebentar, bukan di setiap ketukan.
  const [search,setSearch]=useState("");
  useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),300);return()=>clearTimeout(timer)},[query]);
  /** Tanpa tanggal dan kata kunci, server hanya mengirim 30 hari terakhir sampai 90 hari ke depan. */
  const load=useCallback(async()=>{
    const params=new URLSearchParams();
    if(date)params.set("date",date);if(status)params.set("status",status);if(search)params.set("q",search);
    if(!date&&!search)params.set("window","recent");
    try{setData(await api(`/operations/bookings?${params}`));setError("")}catch(e){setError((e as Error).message)}
  },[date,status,search]);
  useEffect(()=>{void load()},[load]);
  const closeCreate=useCallback(()=>setCreating(false),[]);
  const closeDetail=useCallback(()=>setSelected(null),[]);
  const list=data?.bookings||[];
  return <>{error&&<ErrorBox message={error} retry={load}/>}<div className="ops-actions"><p>Semua jam mengikuti zona waktu venue ({data?.timezone||"…"}).</p><button className="ops-primary" onClick={()=>setCreating(true)}><Plus size={16}/> Booking baru</button></div>
    <div className="ops-filters"><label>Cari pelanggan / lapangan<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama, telepon, atau kode booking"/></label><label>Tanggal<DateInput value={date} onChange={e=>setDate(e.target.value)}/></label><label>Status<Select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Semua status</option>{Object.entries(statusLabel).map(([key,value])=><option key={key} value={key}>{value}</option>)}</Select></label><button className="ops-secondary" onClick={()=>setDate(data?.date||"")}>Hari ini</button><button className="ops-secondary" onClick={()=>{setDate("");setStatus("");setQuery("")}}>Reset</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Pelanggan</th><th>Lapangan / jadwal</th><th>Status</th><th>Tagihan</th><th>Pembayaran neto</th><th>Aksi</th></tr></thead><tbody>{list.map(b=><tr key={b.id}><td className="wide" data-label="Pelanggan"><b>{b.customer}</b><small className="table-description">{b.phone} · {b.id.slice(0,8).toUpperCase()}</small></td><td className="wide" data-label="Lapangan & jadwal">{b.court_name}<small className="table-description">{formatShortDay(b.date)} · {b.start_time} – {b.end_time}</small></td><td data-label="Status"><span className={`status-pill ${statusTone[b.status]}`}>{statusLabel[b.status]}</span></td><td data-label="Tagihan">{money(b.total)}{b.addon_count>0&&<small className="table-description">Termasuk tambahan {money(b.total-b.court_total)}</small>}</td><td data-label="Pembayaran neto">{money(b.paid)}<small className="table-description">{balanceNote(b)}</small></td><td className="actions"><button className="ops-secondary" onClick={()=>setSelected(b.id)}>Detail / bayar</button></td></tr>)}</tbody></table>{data&&list.length>0&&(data.truncated||(!date&&!search))&&<p className="empty-state">{data.truncated?`Menampilkan ${list.length} booking pertama. Pilih tanggal atau cari nama untuk mempersempit.`:"Menampilkan 30 hari terakhir sampai 90 hari ke depan. Pilih tanggal atau cari nama, telepon, atau kode untuk booking lain."}</p>}{!data?<p className="empty-state">Memuat booking…</p>:!list.length&&<div className="ops-empty"><h2>Belum ada booking yang sesuai</h2><p>Buat reservasi pertama atau ubah filter pencarian.</p></div>}</div>
    {creating&&<BookingForm close={closeCreate} done={id=>{closeCreate();setSelected(id);void load()}}/>}
    {selected&&<BookingDetail id={selected} close={closeDetail} changed={()=>void load()}/>}
  </>;
}
function BookingForm({close,done}:{close:()=>void;done:(id:string)=>void}){
  const [context,setContext]=useState<Context|null>(null);
  const [form,setForm]=useState({court_id:"",customer:"",phone:"",email:"",date:"",start_time:"",end_time:"",notes:""});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(true);
  const [drafts,setDrafts]=useState<Draft[]>([]),[options,setOptions]=useState<AddonOption[]|null>(null);
  const [member,setMember]=useState<LookupMember|null>(null);
  const pickMember=useCallback((next:LookupMember|null)=>{
    setMember(next);
    // Nama dan nomor diisi dari data member bila kolomnya masih kosong.
    if(next)setForm(f=>({...f,customer:f.customer||next.name,phone:f.phone||next.phone,email:f.email||next.email}));
  },[]);
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
  const rates=member?.valid?{court:member.plan.court_discount,addon:member.plan.addon_discount}:null;
  const cut=rates?memberCut(price,draftsTotal(drafts.filter(d=>d.type!=="lainnya"),duration),rates):0;
  const bill=billOf(price+extras,cut,context?.tax);
  // Stok raket dan barang sewa lain bergantung pada jam main, jadi dimuat ulang setiap jam berubah.
  useEffect(()=>{
    if(!validTime||!form.date){setOptions(null);return}
    let active=true;
    api<{addons:AddonOption[]}>(optionsUrl(form.date,form.start_time,form.end_time)).then(result=>{if(!active)return;setOptions(result.addons);setDrafts(current=>clampDrafts(current,result.addons))}).catch(()=>{if(active)setOptions([])});
    return()=>{active=false};
  },[form.date,form.start_time,form.end_time,validTime]);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{const result=await api<{booking:Booking}>("/operations/bookings",{method:"POST",body:JSON.stringify({...form,membership_id:member?.valid?member.id:null,addons:draftPayload(drafts)})});toast.success("Booking berhasil dibuat");done(result.booking.id)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title="Booking baru" close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}<p className="ops-muted">Waktu lapangan: {context?.timezone||"…"}. Durasi kelipatan 30 menit.</p>
    {context&&!context.courts.some(c=>c.active)?<p>Belum ada lapangan aktif. Tambahkan melalui menu Lapangan terlebih dahulu.</p>:<>
    <label>Lapangan<Select required value={form.court_id} onChange={e=>{const selected=context?.courts.find(c=>c.id===e.target.value);const start=selected?firstStart(selected,form.date,context):"";setForm({...form,court_id:e.target.value,start_time:start,end_time:start?timeSlots(minute(start)+30,minute(start)+30)[0]:""})}}><option value="" disabled>Pilih lapangan</option>{context?.courts.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name} · {money(c.hourly_rate)}/jam</option>)}</Select></label>
    <label>Tanggal<DateInput required min={context?.date} value={form.date} onChange={e=>setForm({...form,date:e.target.value,start_time:"",end_time:""})}/></label>
    <div className="ops-schedule"><b>Jadwal terisi · {form.date?formatShortDay(form.date):"…"}</b>{refreshing?<p>Memperbarui jadwal…</p>:schedule.length?schedule.map(s=><span key={s.id}>{s.start_time} – {s.end_time} · {s.label}</span>):<p>Belum ada booking atau perawatan.</p>}</div>
    <div className="field-grid"><label>Mulai<Select required value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value,end_time:timeSlots(minute(e.target.value)+30,minute(e.target.value)+30)[0]})}><option value="" disabled>Pilih jam</option>{starts.map(t=><option key={t} disabled={form.date===context?.date&&t<context.time}>{t}</option>)}</Select></label><label>Selesai<Select required value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}><option value="" disabled>Pilih jam</option>{ends.map(t=><option key={t} disabled={t<=form.start_time}>{t}</option>)}</Select></label></div>
    {conflict&&<ErrorBox message="Jam yang dipilih bertabrakan dengan jadwal terisi."/>}
    <MemberPicker date={form.date} value={member} onChange={pickMember}/>
    <div className="field-grid"><label>Nama pelanggan<input required minLength={2} maxLength={80} value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></label><label>Nomor telepon<input required minLength={9} maxLength={18} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label></div><label>Email pelanggan (opsional)<input type="email" maxLength={120} value={form.email} placeholder="Untuk konfirmasi dan pengingat lewat email" onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Catatan (opsional)<textarea maxLength={500} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
    <h3 className="modal-subhead">Sewa & tambahan <small>opsional</small></h3>
    {validTime?<AddonLinesEditor options={options} drafts={drafts} onChange={setDrafts} duration={duration}/>:<p className="ops-muted">Pilih jam main untuk melihat stok raket, bola, dan tambahan lain.</p>}
    <div className="ops-total"><span>Sewa lapangan</span><strong>{money(price)}</strong></div>
    {extras>0&&<div className="ops-total"><span>Tambahan</span><strong>{money(extras)}</strong></div>}
    {cut>0&&<div className="ops-total"><span>Potongan member · {member!.plan.name}</span><strong>−{money(cut)}</strong></div>}
    {bill.tax>0&&context?.tax&&<div className="ops-total"><span>{taxName(context.tax)}</span><strong>{money(bill.tax)}</strong></div>}
    <div className="ops-total"><span>Total tagihan</span><strong>{money(bill.total)}</strong></div><p className="ops-muted">Booking langsung dikonfirmasi. Catat DP atau pelunasan pada halaman detail setelah menyimpan.</p></>}
    </div><div className="modal-actions"><button type="button" onClick={close}>Batal</button><Submit busy={busy||refreshing||!validTime||conflict}>Simpan booking</Submit></div></form></Modal>;
}

/** Pasang atau lepas harga member pada booking aktif, mis. pelanggan baru menunjukkan kartu membernya. */
function BookingMember({booking,busy,onSaved}:{booking:Booking;busy:boolean;onSaved:(booking:Booking)=>void}){
  const [open,setOpen]=useState(false),[member,setMember]=useState<LookupMember|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState("");
  async function save(membershipId:string|null){
    setSaving(true);setError("");
    try{const result=await api<{booking:Booking}>(`/operations/bookings/${booking.id}/member`,{method:"PUT",body:JSON.stringify({membership_id:membershipId})});onSaved(result.booking);setOpen(false);toast.success(membershipId?"Harga member dipasang":"Harga member dilepas")}
    catch(e){setError((e as Error).message)}finally{setSaving(false)}
  }
  if(booking.membership_id)return <div className="ops-card-head"><span className="ops-muted"><BadgeCheck size={14} aria-hidden="true"/> Harga member {booking.member_plan}</span><button type="button" className="ops-link-button" disabled={busy||saving} onClick={()=>{if(confirm("Lepas harga member dari booking ini? Tagihan kembali ke harga normal."))void save(null)}}>Lepas harga member</button>{error&&<ErrorBox message={error}/>}</div>;
  if(!open)return <div className="ops-card-head"><span className="ops-muted">Pelanggan ini member?</span><button type="button" className="ops-secondary" disabled={busy} onClick={()=>setOpen(true)}><BadgeCheck size={14}/> Pakai harga member</button></div>;
  return <div className="ops-payment"><h3>Pakai harga member</h3>{error&&<ErrorBox message={error}/>}
    <MemberPicker date={booking.date} value={member} onChange={setMember} disabled={saving}/>
    <div className="addon-edit-actions"><button type="button" className="ops-secondary" disabled={saving} onClick={()=>setOpen(false)}>Batal</button><button type="button" className="ops-primary" disabled={saving||busy||!member?.valid} onClick={()=>void save(member!.id)}>{saving?"Menyimpan…":"Pasang harga member"}</button></div>
  </div>;
}

/** Potongan harga untuk booking aktif, atau denda pembatalan untuk booking batal yang sudah dibayar. */
function BillAdjust({booking,busy,onSaved}:{booking:Booking;busy:boolean;onSaved:(booking:Booking)=>void}){
  const closed=booking.status==="cancelled"||booking.status==="expired";
  const [amount,setAmount]=useState(closed?booking.forfeited:booking.discount),[note,setNote]=useState(booking.discount_note);
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  if(!(booking.status==="confirmed"||(closed&&(booking.paid>0||booking.forfeited>0))))return null;
  async function save(e:React.FormEvent){
    e.preventDefault();setSaving(true);setError("");
    try{
      const result=await api<{booking:Booking}>(`/operations/bookings/${booking.id}/${closed?"forfeit":"discount"}`,{method:"PUT",body:JSON.stringify(closed?{amount}:{amount,note})});
      onSaved(result.booking);toast.success(closed?(amount?"Denda pembatalan disimpan":"Denda pembatalan dihapus"):(amount?"Potongan harga disimpan":"Potongan harga dihapus"));
    }catch(e){setError((e as Error).message)}finally{setSaving(false)}
  }
  return <form onSubmit={save} className="ops-payment">
    <h3>{closed?"Tahan sebagai denda pembatalan":"Potongan harga"}</h3>
    <p className="ops-muted">{closed
      ?"Uang yang ditahan dicatat sebagai pendapatan pembatalan dan tidak perlu dikembalikan. Isi 0 untuk membatalkan."
      :`Potongan dari harga sebelum pajak${booking.tax_rate?"; pajak dihitung ulang dari harga setelah potongan":""}. Isi 0 untuk menghapus potongan.`}</p>
    {error&&<ErrorBox message={error}/>}
    <div className="field-grid">
      <label>Nominal<MoneyInput required min={0} max={closed?booking.paid:undefined} value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label>
      {!closed&&<label>Alasan<input value={note} maxLength={120} required={amount>0} minLength={amount>0?3:undefined} placeholder="Mis. Member, kompensasi lampu mati" onChange={e=>setNote(e.target.value)}/></label>}
    </div>
    <Submit busy={busy||saving}>{closed?"Simpan denda":"Simpan potongan"}</Submit>
  </form>;
}

/**
 * Pindah jadwal booking aktif. Pembayaran dan tambahan ikut pindah; harga sewa memakai tarif slot
 * baru dan harga tambahan per jam mengikuti durasi baru. Server yang memastikan slot dan stok raket.
 */
function Reschedule({booking,extras,busy,onSaved}:{booking:Booking;extras:BookingAddon[];busy:boolean;onSaved:(booking:Booking)=>void}){
  const [open,setOpen]=useState(false),[context,setContext]=useState<Context|null>(null);
  const [form,setForm]=useState({court_id:booking.court_id,date:booking.date,start_time:booking.start_time,end_time:booking.end_time});
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{
    if(!open)return;
    let active=true;
    api<Context>(`/operations/context?date=${form.date}`).then(data=>{if(active){setContext(data);setError("")}}).catch(e=>{if(active)setError((e as Error).message)});
    return()=>{active=false};
  },[open,form.date]);
  if(!open)return <div className="ops-card-head"><span className="ops-muted">Pelanggan minta ganti jam atau lapangan?</span><button type="button" className="ops-secondary" disabled={busy} onClick={()=>setOpen(true)}><CalendarClock size={14}/> Pindah jadwal</button></div>;
  const court=context?.courts.find(c=>c.id===form.court_id);
  const starts=court?timeSlots(minute(court.opens_at),minute(court.closes_at)-30):[];
  const ends=court?timeSlots(minute(court.opens_at)+30,minute(court.closes_at)):[];
  const taken=context?[...context.schedule.filter(b=>b.court_id===form.court_id&&b.id!==booking.id),...context.maintenance.filter(m=>m.court_id===form.court_id)]:[];
  const conflict=taken.some(s=>s.start_time<form.end_time&&s.end_time>form.start_time);
  const validTime=!!court&&form.start_time>=court.opens_at&&form.end_time<=court.closes_at&&form.start_time<form.end_time;
  const duration=validTime?minute(form.end_time)-minute(form.start_time):0;
  const courtPrice=court&&context&&validTime?quote(court,context.price_rules,form.date,form.start_time,form.end_time):0;
  const extrasPrice=extras.reduce((sum,line)=>sum+(line.pricing==="per_hour"?Math.round(line.unit_price*line.quantity*duration/60):line.subtotal),0);
  const member=booking.membership_id?memberCut(courtPrice,extras.filter(l=>l.type!=="lainnya").reduce((sum,line)=>sum+(line.pricing==="per_hour"?Math.round(line.unit_price*line.quantity*duration/60):line.subtotal),0),{court:booking.member_court_rate??0,addon:booking.member_addon_rate??0}):0;
  const total=billOf(courtPrice+extrasPrice,booking.discount+member,booking).total;
  const same=form.court_id===booking.court_id&&form.date===booking.date&&form.start_time===booking.start_time&&form.end_time===booking.end_time;
  async function save(e:React.FormEvent){
    e.preventDefault();setSaving(true);setError("");
    try{const result=await api<{booking:Booking}>(`/operations/bookings/${booking.id}/reschedule`,{method:"POST",body:JSON.stringify(form)});toast.success("Jadwal booking dipindah");setOpen(false);onSaved(result.booking)}
    catch(e){setError((e as Error).message)}finally{setSaving(false)}
  }
  return <form className="ops-payment" onSubmit={save}><h3>Pindah jadwal</h3>
    {error&&<ErrorBox message={error}/>}
    <div className="field-grid"><label>Lapangan<Select required value={form.court_id} onChange={e=>setForm({...form,court_id:e.target.value})}>{context?.courts.filter(c=>c.active||c.id===booking.court_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></label><label>Tanggal<DateInput required min={context?.date} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label></div>
    <div className="field-grid"><label>Mulai<Select required value={form.start_time} onChange={e=>{const start=e.target.value,end=minute(start)+(duration||60);setForm({...form,start_time:start,end_time:timeSlots(end,end)[0]})}}><option value="" disabled>Pilih jam</option>{starts.map(t=><option key={t} disabled={form.date===context?.date&&t<context.time}>{t}</option>)}</Select></label><label>Selesai<Select required value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}><option value="" disabled>Pilih jam</option>{ends.map(t=><option key={t} disabled={t<=form.start_time}>{t}</option>)}</Select></label></div>
    {taken.length>0&&<div className="ops-schedule"><b>Jadwal terisi · {formatShortDay(form.date)}</b>{taken.map(s=><span key={s.id}>{s.start_time} – {s.end_time}</span>)}</div>}
    {conflict&&<ErrorBox message="Jam yang dipilih bertabrakan dengan jadwal terisi."/>}
    {validTime&&!same&&<p className="ops-muted">Tagihan di jadwal baru <b>{money(total)}</b>{total!==booking.total?` (sebelumnya ${money(booking.total)})`:""}. Pembayaran {money(booking.paid)} ikut pindah{total<booking.paid?`; kelebihan ${money(booking.paid-total)} perlu dikembalikan`:total>booking.paid?`; sisa ${money(total-booking.paid)}`:""}.{booking.email?" Pelanggan mendapat email jadwal baru.":""}</p>}
    <div className="addon-edit-actions"><button type="button" className="ops-secondary" disabled={saving} onClick={()=>setOpen(false)}>Batal</button><button className="ops-primary" type="submit" disabled={saving||busy||!validTime||conflict||same}>{saving?"Menyimpan…":"Simpan jadwal baru"}</button></div>
  </form>;
}

type BriefAccount={id:string;name:string;email:string;phone:string};
type AccountLink={linked:BriefAccount|null;suggestions:BriefAccount[]};
type Detail={booking:Booking;payments:Payment[];addons:BookingAddon[];intents:PaymentIntent[];account?:AccountLink};
function BookingDetail({id,close,changed}:{id:string;close:()=>void;changed:()=>void}){
  const [data,setData]=useState<Detail|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[reason,setReason]=useState("");
  const [form,setForm]=useState({id:crypto.randomUUID(),amount:0,kind:"payment" as "payment"|"refund",method:"cash",note:""});
  const [editing,setEditing]=useState(false),[drafts,setDrafts]=useState<Draft[]>([]),[options,setOptions]=useState<AddonOption[]|null>(null);
  const load=useCallback(async()=>{try{const data=await api<Detail>(`/operations/bookings/${id}`);setData(data);setForm(p=>({...p,kind:refundDue(data.booking)>0?"refund":"payment",amount:due(data.booking)}));setError("")}catch(e){setError((e as Error).message)}},[id]);
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
  async function makeLink(){
    setBusy(true);setError("");
    try{
      const result=await api<{intent:PaymentIntent}>(`/operations/bookings/${id}/payment-link`,{method:"POST",body:JSON.stringify({})});
      setData(d=>d&&{...d,intents:[result.intent,...d.intents]});
      await copyLink(result.intent.redirect_url??"");
      toast.success("Link pembayaran dibuat");
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  /** Staf yang memastikan pelanggannya benar, mis. pesan WhatsApp datang dari nomor itu, lalu menghubungkan. */
  async function linkAccount(accountId:string|null){
    setBusy(true);setError("");
    try{const result=await api<{account:AccountLink}>(`/operations/bookings/${id}/account`,{method:"POST",body:JSON.stringify({account_id:accountId})});setData(d=>d&&{...d,account:result.account});toast.success(accountId?"Booking masuk ke riwayat akun pelanggan":"Kaitan ke akun dilepas")}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function copyLink(url:string){
    if(!url)return;
    try{await navigator.clipboard.writeText(url);toast.success("Link disalin, siap dikirim ke pelanggan")}
    catch{toast.message("Salin link ini: "+url)}
  }
  const refundable=!!booking&&refundDue(booking)>0,payable=booking?.status==="confirmed"&&booking.total>booking.paid;
  const canReturn=booking?.status==="confirmed"||booking?.status==="completed";
  const unreturned=lines.filter(l=>l.type==="sewa"&&!l.returned_at);
  const draftSum=draftsTotal(drafts,duration);
  const extrasTotal=lines.reduce((sum,line)=>sum+line.subtotal,0);
  return <Modal title="Detail booking" close={close}><div className="modal-fields">{error&&<ErrorBox message={error} retry={!data?load:undefined}/>}
    {!booking?<p>Memuat booking…</p>:<><div className="ops-detail-head"><div><h3>{booking.customer}</h3><p>{booking.phone}</p><small>{booking.id.slice(0,8).toUpperCase()}</small></div><span className={`status-pill ${statusTone[booking.status]}`}>{statusLabel[booking.status]}</span></div><p><b>{booking.court_name}</b><br/>{formatShortDay(booking.date)} · {booking.start_time} – {booking.end_time}{(booking.reschedule_count??0)>0&&<small className="table-description">Sudah dipindah {booking.reschedule_count}×</small>}</p>{booking.email&&<p className="ops-muted">Email: {booking.email}</p>}{booking.notes&&<p>Catatan: {booking.notes}</p>}
    {booking.status==="confirmed"&&<Reschedule key={`${booking.id}-${booking.date}-${booking.start_time}-${booking.court_id}`} booking={booking} extras={lines} busy={busy} onSaved={next=>{merge({booking:next});void load();changed()}}/>}
    {(lines.length>0||booking.status==="confirmed")&&<section className="ops-addons" aria-label="Sewa dan tambahan">
      <div className="ops-card-head"><h3>Sewa & tambahan</h3>{booking.status==="confirmed"&&!editing&&<button type="button" className="ops-secondary" disabled={busy} onClick={()=>void editAddons()}><PackagePlus size={14}/> {lines.length?"Ubah tambahan":"Tambah"}</button>}</div>
      {editing?<>
        <AddonLinesEditor options={options} drafts={drafts} onChange={setDrafts} duration={duration} allowCustom/>
        <p className="ops-muted">Tagihan baru: {money(booking.court_total)} lapangan + {money(draftSum)} tambahan{booking.discount>0?` − ${money(booking.discount)} potongan`:""}{booking.membership_id?` − ${money(memberCutOf(booking,booking.court_total,drafts,duration))} potongan member`:""}{booking.tax>0&&!booking.tax_inclusive?` + ${booking.tax_label||"pajak"}`:""} = <b>{money(billOf(booking.court_total+draftSum,booking.discount+memberCutOf(booking,booking.court_total,drafts,duration),booking).total)}</b>{booking.paid>0?`. Sudah dibayar ${money(booking.paid)}; tagihan tidak dapat turun di bawah angka ini.`:"."}</p>
        <div className="addon-edit-actions"><button type="button" className="ops-secondary" disabled={busy} onClick={()=>setEditing(false)}>Batal</button><button type="button" className="ops-primary" disabled={busy||!options} onClick={()=>void saveAddons()}>{busy?"Menyimpan…":"Simpan tambahan"}</button></div>
      </>:lines.length?<ul className="addon-summary-lines">{lines.map(line=><li key={line.id}>
        <div><b>{line.quantity}× {line.name}</b><small>{money(line.unit_price)} {unitLabel(line.type,line.pricing)}{line.pricing==="per_hour"?` × ${hoursLabel(duration)}`:""}{line.type==="lainnya"?" · biaya lain":""}</small>
          {line.type==="sewa"&&<span className="addon-return-row"><span className={`addon-return${line.returned_at?" done":""}`}>{line.returned_at?"Sudah kembali":"Belum kembali"}</span>{canReturn&&<button type="button" className="ops-link-button" disabled={busy} onClick={()=>void markReturned([line.id],!line.returned_at)}>{line.returned_at?"Batalkan tanda":"Tandai kembali"}</button>}</span>}
        </div><strong>{money(line.subtotal)}</strong>
      </li>)}</ul>:<p className="ops-muted">Belum ada sewa raket, bola, atau tambahan lain.</p>}
      {!editing&&canReturn&&unreturned.length>1&&<button type="button" className="ops-secondary addon-return-all" disabled={busy} onClick={()=>void markReturned(unreturned.map(l=>l.id),true)}><PackageCheck size={14}/> Tandai semua barang sewa kembali</button>}
    </section>}
    <div className="ops-total"><span>Sewa lapangan</span><strong>{money(booking.court_total)}</strong></div>{extrasTotal>0&&<div className="ops-total"><span>Tambahan</span><strong>{money(extrasTotal)}</strong></div>}{(booking.member_discount??0)>0&&<div className="ops-total"><span>Potongan member · {booking.member_plan}</span><strong>−{money(booking.member_discount!)}</strong></div>}{booking.discount>0&&<div className="ops-total"><span>Potongan · {booking.discount_note}</span><strong>−{money(booking.discount)}</strong></div>}{booking.tax>0&&<div className="ops-total"><span>{taxName(booking)}</span><strong>{money(booking.tax)}</strong></div>}<div className="ops-total"><span>Total tagihan</span><strong>{money(booking.total)}</strong></div><div className="ops-total"><span>Pembayaran neto</span><strong>{money(booking.paid)}</strong></div><div className="ops-total"><span>{refundDue(booking)>0?"Perlu dikembalikan":"Sisa tagihan"}</span><strong>{money(due(booking))}</strong></div>
    {booking.cancel_reason&&<p>Alasan pembatalan: {booking.cancel_reason}</p>}
    {booking.status==="confirmed"&&<BookingMember key={`${booking.id}-${booking.membership_id??""}`} booking={booking} busy={busy} onSaved={next=>{merge({booking:next});changed()}}/>}
    <BillAdjust key={`${booking.id}-${booking.status}`} booking={booking} busy={busy} onSaved={next=>{merge({booking:next});changed()}}/>
    {(payable||refundable)&&<form onSubmit={pay} className="ops-payment"><h3>{refundable?"Catat pengembalian dana":"Catat DP / pelunasan"}</h3><p className="ops-muted">Pastikan uang sudah {refundable?"dikembalikan":"diterima"}. Formulir ini mencatat transaksi manual.</p><div className="field-grid"><label>Nominal<MoneyInput required min={1} max={refundable?refundDue(booking):booking.total-booking.paid} value={form.amount} onChange={e=>setForm({...form,id:crypto.randomUUID(),amount:Number(e.target.value)})}/></label><label>Metode<Select value={form.method} onChange={e=>setForm({...form,id:crypto.randomUUID(),method:e.target.value})}><option value="cash">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option></Select></label></div><label>Catatan / referensi{refundable?" (wajib)":" (opsional)"}<input required={!!refundable} minLength={refundable?3:undefined} maxLength={200} value={form.note} onChange={e=>setForm({...form,id:crypto.randomUUID(),note:e.target.value})}/></label><Submit busy={busy}>{refundable?"Catat pengembalian":"Catat pembayaran"}</Submit></form>}
    {(payable||(data!.intents.length>0))&&<section className="ops-addons" aria-label="Tagihan online">
      <div className="ops-card-head"><h3>Tagihan online</h3>{payable&&<button type="button" className="ops-secondary" disabled={busy} onClick={()=>void makeLink()}><CreditCard size={14}/> Buat link pembayaran</button>}</div>
      {data!.intents.length?<ul className="pay-links">{data!.intents.map(intent=><li key={intent.order_id}>
        <div><b>{money(intent.amount)} · {intent.kind==="tagihan"?"Link kasir":"Checkout online"}</b><small>{intent.order_id} · {new Date(intent.created_at).toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"})}</small></div>
        <span className={`status-pill ${intentTone[intent.status]}`}>{intentLabel[intent.status]}</span>
        {intent.status==="pending"&&intent.redirect_url&&<button type="button" className="ops-link-button" onClick={()=>void copyLink(intent.redirect_url!)}><Copy size={13}/> Salin link</button>}
      </li>)}</ul>:<p className="ops-muted">Belum ada tagihan online. Link berlaku 24 jam dan dapat dikirim ke pelanggan lewat WhatsApp.</p>}
    </section>}
    {data!.account&&(data!.account.linked||data!.account.suggestions.length>0)&&<section className="booking-account" aria-label="Akun pelanggan">
      <h3>Akun pelanggan</h3>
      {data!.account.linked?<div className="booking-account-row"><div><b>{data!.account.linked.name}</b><small>{data!.account.linked.email}{data!.account.linked.phone?` · ${data!.account.linked.phone}`:""}</small></div><button type="button" className="ops-link-button" disabled={busy} onClick={()=>void linkAccount(null)}>Lepas kaitan</button></div>
      :<><p>Ada akun dengan nomor yang sama. Hubungkan hanya bila Anda yakin itu orang yang sama — nomor di akun diisi pelanggan sendiri.</p>
        {data!.account.suggestions.map(account=><div className="booking-account-row" key={account.id}><div><b>{account.name}</b><small>{account.email}{account.phone?` · ${account.phone}`:""}</small></div><button type="button" className="ops-secondary" disabled={busy} onClick={()=>void linkAccount(account.id)}>Hubungkan</button></div>)}</>}
    </section>}
    <h3>Riwayat pembayaran</h3>{data!.payments.length?data!.payments.map(p=><div className="ops-history" key={p.id}><div><b>{p.kind==="refund"?"Pengembalian":"Pembayaran"} · {methodLabel[p.method]??p.method}</b><small>{new Date(p.created_at).toLocaleString("id-ID")} {p.note&&"· "+p.note}</small></div><strong>{p.kind==="refund"?"−":""}{money(p.amount)}</strong></div>):<p className="ops-muted">Belum ada pembayaran.</p>}
    {booking.status==="confirmed"&&<div className="ops-status-actions"><h3>Status reservasi</h3><button className="ops-secondary" disabled={busy||booking.paid<booking.total} onClick={()=>void status("completed")}>Tandai selesai</button><p className="ops-muted">Sesi dapat diselesaikan setelah jam berakhir dan tagihan lunas.{unreturned.length>0?` Masih ada ${unreturned.reduce((sum,l)=>sum+l.quantity,0)} barang sewa yang belum kembali.`:""}</p><label>Alasan pembatalan<input minLength={3} maxLength={200} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Wajib diisi untuk membatalkan"/></label><button className="ops-danger" disabled={busy||reason.trim().length<3} onClick={()=>void status("cancelled")}>Batalkan booking</button>{lines.some(l=>l.type==="jual")&&<p className="ops-muted">Stok barang jual pada booking ini kembali otomatis saat dibatalkan.</p>}</div>}
    </>}
  </div><div className="modal-actions">{booking&&<button type="button" onClick={()=>window.open(`/cetak/nota/${booking.id}?cetak=1`,"_blank","noopener")}><Printer size={14}/> Cetak nota</button>}<button type="button" onClick={close}>Tutup</button></div></Modal>;
}
