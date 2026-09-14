"use client";
import { useCallback,useEffect,useState } from "react";
import { Plus,Pencil,Wrench } from "lucide-react";
import { toast } from "sonner";
import { api,money } from "@/lib/api";
import { type Court,type Maintenance,timeSlots,minute } from "@/lib/operations";
import { formatShortDay } from "@/lib/shop";
import { ErrorBox,Modal,Submit } from "./operation-ui";
export function CourtsPanel(){
  const [data,setData]=useState<{courts:Court[];maintenance:Maintenance[];date:string;timezone:string}|null>(null);
  const [error,setError]=useState(""),[editing,setEditing]=useState<Court|null|undefined>(),[maintenance,setMaintenance]=useState(false);
  const [removing,setRemoving]=useState("");
  const load=useCallback(async()=>{try{setData(await api("/operations/courts"));setError("")}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{void load()},[load]);
  const closeCourt=useCallback(()=>setEditing(undefined),[]);
  const closeMaintenance=useCallback(()=>setMaintenance(false),[]);
  async function remove(item:Maintenance){
    if(!confirm(`Hapus jadwal perawatan ${item.court_name} pada ${formatShortDay(item.date)} pukul ${item.start_time}?`))return;
    setRemoving(item.id);try{await api(`/operations/maintenance/${item.id}`,{method:"DELETE"});toast.success("Jadwal perawatan dihapus");await load()}catch(e){toast.error((e as Error).message)}finally{setRemoving("")}
  }
  return <>{error&&<ErrorBox message={error} retry={load}/>}<div className="ops-actions"><p>Perubahan tarif hanya berlaku untuk booking baru. Zona waktu venue: {data?.timezone||"…"}.</p><button className="ops-primary" onClick={()=>setEditing(null)}><Plus size={16}/> Tambah lapangan</button></div>
    {!data?<p className="empty-state">Memuat lapangan…</p>:<>
    <div className="ops-court-grid">{data.courts.map(c=><article className="settings-card" key={c.id}><div className="ops-card-head"><h2>{c.name}</h2><span className={c.active?"status-pill on":"status-pill off"}>{c.active?"Aktif":"Nonaktif"}</span></div><strong className="ops-price">{money(c.hourly_rate)} <small>/ jam</small></strong><p className="ops-muted">Buka {c.opens_at} – {c.closes_at}</p><button className="ops-secondary" onClick={()=>setEditing(c)}><Pencil size={14}/> Ubah lapangan</button></article>)}</div>
    {!data.courts.length&&<div className="ops-empty"><h2>Siapkan lapangan pertama</h2><p>Tambahkan nama, tarif, dan jam buka sebelum menerima reservasi.</p></div>}
    <div className="ops-section-title"><div><h2>Jadwal perawatan</h2><p>Slot yang sedang dirawat otomatis tertutup untuk booking.</p></div><button className="ops-secondary" disabled={!data.courts.some(c=>c.active)} onClick={()=>setMaintenance(true)}><Wrench size={15}/> Jadwalkan perawatan</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>LAPANGAN</th><th>TANGGAL</th><th>JAM</th><th>ALASAN</th><th>AKSI</th></tr></thead><tbody>{data.maintenance.map(m=><tr key={m.id}><td data-label="Lapangan">{m.court_name}</td><td data-label="Tanggal">{formatShortDay(m.date)}</td><td data-label="Jam">{m.start_time} – {m.end_time}</td><td className="wide" data-label="Alasan">{m.reason}</td><td className="actions"><button className="ops-danger" disabled={!!removing} onClick={()=>void remove(m)}>{removing===m.id?"Menghapus…":"Hapus"}</button></td></tr>)}</tbody></table>{!data.maintenance.length&&<p className="empty-state">Belum ada jadwal perawatan mendatang.</p>}</div>
    {editing!==undefined&&<CourtForm court={editing} close={closeCourt} done={()=>{closeCourt();void load()}}/>}
    {maintenance&&<MaintenanceForm courts={data.courts.filter(c=>c.active)} date={data.date} close={closeMaintenance} done={()=>{closeMaintenance();void load()}}/>}
    </>}
  </>;
}
function CourtForm({court,close,done}:{court:Court|null;close:()=>void;done:()=>void}){
  const [form,setForm]=useState({name:court?.name||"",hourly_rate:court?.hourly_rate||300000,opens_at:court?.opens_at||"06:00",closes_at:court?.closes_at||"23:00",active:court?!!court.active:true});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api(`/operations/courts${court?"/"+court.id:""}`,{method:court?"PUT":"POST",body:JSON.stringify(form)});toast.success("Lapangan disimpan");done()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title={court?"Ubah lapangan":"Tambah lapangan"} close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}<label>Nama lapangan<input autoFocus required minLength={2} maxLength={60} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Tarif per jam (Rp)<input type="number" min={1000} max={10000000} step={1} required value={form.hourly_rate} onChange={e=>setForm({...form,hourly_rate:Number(e.target.value)})}/></label><div className="field-grid"><label>Jam buka<select value={form.opens_at} onChange={e=>setForm({...form,opens_at:e.target.value})}>{timeSlots(0,1410).map(t=><option key={t}>{t}</option>)}</select></label><label>Jam tutup<select value={form.closes_at} onChange={e=>setForm({...form,closes_at:e.target.value})}>{timeSlots(30,1440).map(t=><option key={t}>{t}</option>)}</select></label></div><label className="switch-field"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Lapangan aktif</label><p className="ops-muted">Perubahan tarif berlaku untuk booking baru. Harga booking yang sudah dibuat tetap.</p></div><div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy}/></div></form></Modal>;
}
function MaintenanceForm({courts,date,close,done}:{courts:Court[];date:string;close:()=>void;done:()=>void}){
  const [form,setForm]=useState({court_id:courts[0]?.id||"",date,start_time:courts[0]?.opens_at||"06:00",end_time:"07:00",reason:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const court=courts.find(c=>c.id===form.court_id)!;
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);try{await api("/operations/maintenance",{method:"POST",body:JSON.stringify(form)});toast.success("Perawatan dijadwalkan");done()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title="Jadwalkan perawatan" close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}<label>Lapangan<select value={form.court_id} onChange={e=>setForm({...form,court_id:e.target.value})}>{courts.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Tanggal<input required type="date" min={date} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><div className="field-grid"><label>Mulai<select value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value})}>{timeSlots(minute(court.opens_at),minute(court.closes_at)-30).map(t=><option key={t}>{t}</option>)}</select></label><label>Selesai<select value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}>{timeSlots(minute(court.opens_at)+30,minute(court.closes_at)).map(t=><option key={t}>{t}</option>)}</select></label></div><label>Alasan<input required minLength={3} maxLength={200} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label></div><div className="modal-actions"><button type="button" onClick={close}>Batal</button><Submit busy={busy}/></div></form></Modal>;
}
