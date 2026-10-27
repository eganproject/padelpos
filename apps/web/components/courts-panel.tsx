"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import { ArrowLeft,ArrowRight,ImagePlus,Images,Pencil,Plus,Star,Tag,Trash2,Wrench } from "lucide-react";
import { toast } from "sonner";
import { api,money } from "@/lib/api";
import { type Court,type Maintenance,type PriceRule,dayShort,formatDays,timeSlots,minute,weekOrder } from "@/lib/operations";
import { formatShortDay } from "@/lib/shop";
import { environmentLabel,photoUrl } from "@/lib/venue-info";
import { shrink } from "@/lib/image";
import { ErrorBox,Modal,Submit } from "./operation-ui";
import { Select, DateInput, MoneyInput } from "./form-controls";
import { InfoTip, LabelTip } from "@/components/tooltip";

type CourtsData={courts:Court[];floors:{id:string;name:string}[];maintenance:Maintenance[];price_rules:PriceRule[];date:string;timezone:string};
const maxPhotos=6;

export function CourtsPanel(){
  const [data,setData]=useState<CourtsData|null>(null);
  const [error,setError]=useState(""),[editing,setEditing]=useState<Court|null|undefined>(),[maintenance,setMaintenance]=useState(false);
  const [photosOf,setPhotosOf]=useState<string|null>(null),[rule,setRule]=useState<PriceRule|null|undefined>();
  const [removing,setRemoving]=useState("");
  const load=useCallback(async()=>{try{setData(await api("/operations/courts"));setError("")}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{void load()},[load]);
  const closeCourt=useCallback(()=>setEditing(undefined),[]);
  const closeMaintenance=useCallback(()=>setMaintenance(false),[]);
  const closePhotos=useCallback(()=>setPhotosOf(null),[]);
  const closeRule=useCallback(()=>setRule(undefined),[]);
  const photosChanged=useCallback((courtId:string,photos:string[])=>setData(d=>d&&{...d,courts:d.courts.map(c=>c.id===courtId?{...c,photos}:c)}),[]);
  async function remove(item:Maintenance){
    if(!confirm(`Hapus jadwal perawatan ${item.court_name} pada ${formatShortDay(item.date)} pukul ${item.start_time}?`))return;
    setRemoving(item.id);try{await api(`/operations/maintenance/${item.id}`,{method:"DELETE"});toast.success("Jadwal perawatan dihapus");await load()}catch(e){toast.error((e as Error).message)}finally{setRemoving("")}
  }
  async function removeRule(item:PriceRule){
    if(!confirm(`Hapus tarif khusus "${item.label}"? Booking yang sudah dibuat tidak berubah.`))return;
    setRemoving(item.id);try{await api(`/operations/price-rules/${item.id}`,{method:"DELETE"});toast.success("Tarif khusus dihapus");await load()}catch(e){toast.error((e as Error).message)}finally{setRemoving("")}
  }
  const courtName=(id:string)=>data?.courts.find(c=>c.id===id)?.name||"Lapangan terhapus";
  const photoCourt=data?.courts.find(c=>c.id===photosOf);
  return <>{error&&<ErrorBox message={error} retry={load}/>}<div className="ops-actions"><p>Perubahan tarif hanya berlaku untuk booking baru. Zona waktu venue: {data?.timezone||"…"}.</p><button className="ops-primary" onClick={()=>setEditing(null)}><Plus size={16}/> Tambah lapangan</button></div>
    {!data?<p className="empty-state">Memuat lapangan…</p>:<>
    <div className="ops-court-grid">{data.courts.map(c=>{
      const photos=c.photos??[],rules=data.price_rules.filter(r=>r.court_ids.includes(c.id));
      const floorName=data.floors.length>1?data.floors.find(f=>f.id===c.floor_id)?.name:undefined;
      return <article className="settings-card court-admin-card" key={c.id}>
        <button type="button" className={`court-admin-cover${photos.length?"":" empty"}`} onClick={()=>setPhotosOf(c.id)} aria-label={`Kelola foto ${c.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photos.length?<img src={photoUrl(photos[0])} alt=""/>:<span><ImagePlus size={22} aria-hidden="true"/> Tambah foto</span>}
          <em><Images size={13} aria-hidden="true"/> {photos.length}/{maxPhotos}</em>
        </button>
        <div className="ops-card-head"><h2>{c.name}</h2><span className={c.active?"status-pill on":"status-pill off"}>{c.active?"Aktif":"Nonaktif"}</span></div>
        {(floorName||c.environment||c.surface||rules.length>0)&&<div className="court-admin-tags">{floorName&&<span>{floorName}</span>}{c.environment&&<span>{environmentLabel[c.environment]}</span>}{c.surface&&<span>{c.surface}</span>}{rules.length>0&&<span className="rule"><Tag size={12} aria-hidden="true"/> {rules.length} tarif khusus</span>}</div>}
        <strong className="ops-price">{money(c.hourly_rate)} <small>/ jam · tarif dasar</small></strong>
        <p className="ops-muted">Buka {c.opens_at} – {c.closes_at}</p>
        <p className={`court-admin-desc${c.description?"":" missing"}`}>{c.description||"Belum ada deskripsi untuk pelanggan."}</p>
        <div className="court-admin-actions"><button className="ops-secondary" onClick={()=>setEditing(c)}><Pencil size={14}/> Ubah lapangan</button><button className="ops-secondary" onClick={()=>setPhotosOf(c.id)}><Images size={14}/> Foto</button></div>
      </article>;
    })}</div>
    {!data.courts.length&&<div className="ops-empty"><h2>Siapkan lapangan pertama</h2><p>Tambahkan nama, tarif, dan jam buka sebelum menerima reservasi.</p></div>}

    <div className="ops-section-title"><div><h2>Tarif khusus</h2><p>Harga berbeda untuk jam sibuk, akhir pekan, atau hari tertentu. Di luar jam tersebut berlaku tarif dasar lapangan.</p></div><button className="ops-secondary" disabled={!data.courts.length} onClick={()=>setRule(null)}><Tag size={15}/> Tambah tarif khusus</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Nama</th><th>Tarif / jam<InfoTip text="Menggantikan tarif dasar lapangan pada hari dan jam ini. Harga dihitung per 30 menit, jadi booking yang melewati batas jam tarif dibayar sesuai bagiannya."/></th><th>Lapangan</th><th>Hari</th><th>Jam</th><th>Aksi</th></tr></thead><tbody>{data.price_rules.map(r=><tr key={r.id}><td data-label="Nama"><b>{r.label}</b></td><td data-label="Tarif / jam">{money(r.hourly_rate)}</td><td className="wide" data-label="Lapangan">{r.court_ids.map(courtName).join(", ")}</td><td data-label="Hari">{formatDays(r.days)}</td><td data-label="Jam">{r.start_time} – {r.end_time}</td><td className="actions"><div className="row-actions"><button onClick={()=>setRule(r)} aria-label={`Ubah ${r.label}`} data-tip={`Ubah ${r.label}`}><Pencil/></button><button className="delete" disabled={removing===r.id} onClick={()=>void removeRule(r)} aria-label={`Hapus ${r.label}`} data-tip={`Hapus ${r.label}`}><Trash2/></button></div></td></tr>)}</tbody></table>{!data.price_rules.length&&<p className="empty-state">Belum ada tarif khusus. Semua jam memakai tarif dasar lapangan.</p>}</div>

    <div className="ops-section-title"><div><h2>Jadwal perawatan</h2><p>Slot yang sedang dirawat otomatis tertutup untuk booking.</p></div><button className="ops-secondary" disabled={!data.courts.some(c=>c.active)} onClick={()=>setMaintenance(true)}><Wrench size={15}/> Jadwalkan perawatan</button></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Lapangan</th><th>Tanggal</th><th>Jam</th><th>Alasan</th><th>Aksi</th></tr></thead><tbody>{data.maintenance.map(m=><tr key={m.id}><td data-label="Lapangan">{m.court_name}</td><td data-label="Tanggal">{formatShortDay(m.date)}</td><td data-label="Jam">{m.start_time} – {m.end_time}</td><td className="wide" data-label="Alasan">{m.reason}</td><td className="actions"><button className="ops-danger" disabled={!!removing} onClick={()=>void remove(m)}>{removing===m.id?"Menghapus…":"Hapus"}</button></td></tr>)}</tbody></table>{!data.maintenance.length&&<p className="empty-state">Belum ada jadwal perawatan mendatang.</p>}</div>
    {editing!==undefined&&<CourtForm court={editing} close={closeCourt} done={()=>{closeCourt();void load()}}/>}
    {maintenance&&<MaintenanceForm courts={data.courts.filter(c=>c.active)} date={data.date} close={closeMaintenance} done={()=>{closeMaintenance();void load()}}/>}
    {photoCourt&&<PhotoManager court={photoCourt} close={closePhotos} changed={photosChanged}/>}
    {rule!==undefined&&<PriceRuleForm rule={rule} courts={data.courts} close={closeRule} done={rules=>{closeRule();setData(d=>d&&{...d,price_rules:rules})}}/>}
    </>}
  </>;
}
function CourtForm({court,close,done}:{court:Court|null;close:()=>void;done:()=>void}){
  const [form,setForm]=useState({name:court?.name||"",hourly_rate:court?.hourly_rate||300000,opens_at:court?.opens_at||"06:00",closes_at:court?.closes_at||"23:00",active:court?!!court.active:true,environment:court?.environment||"",surface:court?.surface||"",description:court?.description||""});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api(`/operations/courts${court?"/"+court.id:""}`,{method:court?"PUT":"POST",body:JSON.stringify(form)});toast.success("Lapangan disimpan");done()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title={court?"Ubah lapangan":"Tambah lapangan"} close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}<label>Nama lapangan<input autoFocus required minLength={2} maxLength={60} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label><LabelTip tip="Harga sewa normal per jam. Untuk jam sibuk atau akhir pekan, buat Tarif khusus yang menggantikan tarif ini pada jam tertentu.">Tarif dasar per jam</LabelTip><MoneyInput min={1000} max={10000000} required value={form.hourly_rate} onChange={e=>setForm({...form,hourly_rate:Number(e.target.value)})}/></label><div className="field-grid"><label><LabelTip tip="Jam pertama yang bisa dipesan setiap hari. Jam tutup 24:00 berarti buka sampai tengah malam.">Jam buka</LabelTip><Select value={form.opens_at} onChange={e=>{const opens=e.target.value;setForm({...form,opens_at:opens,closes_at:form.closes_at>opens?form.closes_at:timeSlots(minute(opens)+30,minute(opens)+30)[0]})}}>{timeSlots(0,1410).map(t=><option key={t}>{t}</option>)}</Select></label><label>Jam tutup<Select value={form.closes_at} onChange={e=>setForm({...form,closes_at:e.target.value})}>{timeSlots(30,1440).map(t=><option key={t} disabled={t<=form.opens_at}>{t}</option>)}</Select></label></div><label className="switch-field"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Lapangan aktif<InfoTip text="Lapangan nonaktif tidak bisa dipesan dan disembunyikan dari situs pelanggan. Booking yang sudah ada tidak terhapus."/></label>
    <h3 className="modal-subhead">Untuk halaman pelanggan<InfoTip text="Info ini tampil di situs saat pelanggan memilih lapangan. Boleh dikosongkan."/></h3>
    <div className="field-grid"><label>Jenis lapangan<Select value={form.environment} onChange={e=>setForm({...form,environment:e.target.value as Court["environment"]})}><option value="">Tidak ditampilkan</option><option value="indoor">Indoor (beratap)</option><option value="outdoor">Outdoor (terbuka)</option></Select></label><label>Permukaan lapangan<input list="surface-options" maxLength={40} value={form.surface} onChange={e=>setForm({...form,surface:e.target.value})} placeholder="Mis. Rumput sintetis"/><datalist id="surface-options"><option value="Rumput sintetis"/><option value="Karpet akrilik"/><option value="Beton berlapis"/></datalist></label></div>
    <label>Deskripsi<textarea maxLength={600} rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Mis. dinding kaca panoramik, pencahayaan LED, cocok untuk main malam."/></label><p className="ops-muted field-counter">{form.description.length}/600 · Foto dikelola dari tombol Foto pada kartu lapangan.</p>
    <p className="ops-muted">Perubahan tarif berlaku untuk booking baru. Harga booking yang sudah dibuat tetap.</p></div><div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy}/></div></form></Modal>;
}

function PhotoManager({court,close,changed}:{court:Court;close:()=>void;changed:(courtId:string,photos:string[])=>void}){
  const photos=court.photos??[];
  const [busy,setBusy]=useState(""),[error,setError]=useState("");
  const input=useRef<HTMLInputElement>(null);
  const apply=(list:{id:string}[])=>changed(court.id,list.map(p=>p.id));
  async function upload(files:FileList|null){
    if(!files?.length)return;
    const room=maxPhotos-photos.length,chosen=[...files].slice(0,room);
    if(files.length>room)toast.warning(`Hanya ${room} foto lagi yang dapat ditambahkan.`);
    setError("");
    for(const [index,file] of chosen.entries()){
      setBusy(`Mengunggah ${index+1} dari ${chosen.length}…`);
      try{const blob=await shrink(file);apply((await api<{photos:{id:string}[]}>(`/operations/courts/${court.id}/photos`,{method:"POST",headers:{"Content-Type":blob.type},body:blob})).photos)}
      catch(e){setError(`${file.name}: ${(e as Error).message}`);break}
    }
    setBusy("");if(input.current)input.current.value="";
  }
  async function reorder(ids:string[]){
    setBusy("Menyimpan urutan…");setError("");
    try{apply((await api<{photos:{id:string}[]}>(`/operations/courts/${court.id}/photos/order`,{method:"PUT",body:JSON.stringify({ids})})).photos)}catch(e){setError((e as Error).message)}finally{setBusy("")}
  }
  const move=(index:number,target:number)=>{const ids=[...photos];const [item]=ids.splice(index,1);ids.splice(target,0,item);void reorder(ids)};
  async function remove(id:string){
    if(!confirm("Hapus foto ini dari halaman pelanggan?"))return;
    setBusy("Menghapus foto…");setError("");
    try{apply((await api<{photos:{id:string}[]}>(`/operations/courts/${court.id}/photos/${id}`,{method:"DELETE"})).photos)}catch(e){setError((e as Error).message)}finally{setBusy("")}
  }
  return <Modal title={`Foto ${court.name}`} close={close}><div className="modal-fields">{error&&<ErrorBox message={error}/>}
    <p className="ops-muted">Foto pertama menjadi sampul di halaman pelanggan. Maksimal {maxPhotos} foto; ukuran foto diperkecil otomatis sebelum diunggah.</p>
    <div className="photo-grid">
      {photos.map((id,index)=><figure className="photo-tile" key={id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(id)} alt={`Foto ${index+1} ${court.name}`}/>
        {index===0&&<span className="photo-badge"><Star size={12} aria-hidden="true"/> Sampul</span>}
        <figcaption>
          <button type="button" disabled={!!busy||index===0} onClick={()=>move(index,index-1)} aria-label="Geser ke kiri" data-tip="Geser ke kiri"><ArrowLeft size={15}/></button>
          {index>0?<button type="button" className="text" disabled={!!busy} onClick={()=>move(index,0)}>Jadikan sampul</button>:<span className="grow"/>}
          <button type="button" disabled={!!busy||index===photos.length-1} onClick={()=>move(index,index+1)} aria-label="Geser ke kanan" data-tip="Geser ke kanan"><ArrowRight size={15}/></button>
          <button type="button" className="danger" disabled={!!busy} onClick={()=>void remove(id)} aria-label="Hapus foto" data-tip="Hapus foto"><Trash2 size={15}/></button>
        </figcaption>
      </figure>)}
      {photos.length<maxPhotos&&<button type="button" className="photo-add" disabled={!!busy} onClick={()=>input.current?.click()}><ImagePlus size={24} aria-hidden="true"/><span>{busy||"Tambah foto"}</span><small>JPG, PNG, atau WebP</small></button>}
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>void upload(e.target.files)}/>
    {busy&&<p className="ops-muted" role="status">{busy}</p>}
  </div><div className="modal-actions"><button type="button" onClick={close}>Selesai</button></div></Modal>;
}

function PriceRuleForm({rule,courts,close,done}:{rule:PriceRule|null;courts:Court[];close:()=>void;done:(rules:PriceRule[])=>void}){
  const [form,setForm]=useState({label:rule?.label||"Jam sibuk",court_ids:rule?.court_ids||courts.map(c=>c.id),days:rule?.days||[1,2,3,4,5],start_time:rule?.start_time||"17:00",end_time:rule?.end_time||"22:00",hourly_rate:rule?.hourly_rate||Math.max(...courts.map(c=>c.hourly_rate))});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const toggle=<T,>(list:T[],value:T)=>list.includes(value)?list.filter(v=>v!==value):[...list,value];
  const same=(a:number[],b:number[])=>a.length===b.length&&a.every(v=>b.includes(v));
  const presets:[string,number[]][]=[["Hari kerja",[1,2,3,4,5]],["Akhir pekan",[0,6]],["Setiap hari",[0,1,2,3,4,5,6]]];
  const selected=courts.filter(c=>form.court_ids.includes(c.id));
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{const result=await api<{price_rules:PriceRule[]}>(`/operations/price-rules${rule?"/"+rule.id:""}`,{method:rule?"PUT":"POST",body:JSON.stringify(form)});toast.success("Tarif khusus disimpan");done(result.price_rules)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <Modal title={rule?"Ubah tarif khusus":"Tambah tarif khusus"} close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}
    <label>Nama tarif<input autoFocus required minLength={2} maxLength={40} list="rule-names" value={form.label} onChange={e=>setForm({...form,label:e.target.value})}/><datalist id="rule-names"><option value="Jam sibuk"/><option value="Akhir pekan"/><option value="Hari libur"/><option value="Pagi hemat"/></datalist></label>
    <fieldset className="chip-field"><legend>Lapangan</legend><div className="chip-group">{courts.map(c=><button type="button" key={c.id} aria-pressed={form.court_ids.includes(c.id)} onClick={()=>setForm({...form,court_ids:toggle(form.court_ids,c.id)})}>{c.name}</button>)}</div></fieldset>
    <fieldset className="chip-field"><legend>Hari</legend><div className="chip-group days">{weekOrder.map(d=><button type="button" key={d} aria-pressed={form.days.includes(d)} onClick={()=>setForm({...form,days:toggle(form.days,d)})}>{dayShort[d]}</button>)}</div>
      <div className="chip-presets">{presets.map(([label,days])=><button type="button" key={label} aria-pressed={same(form.days,days)} onClick={()=>setForm({...form,days})}>{label}</button>)}</div></fieldset>
    <div className="field-grid"><label>Mulai<Select value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value})}>{timeSlots(0,1410).map(t=><option key={t}>{t}</option>)}</Select></label><label>Selesai<Select value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}>{timeSlots(30,1440).map(t=><option key={t} disabled={t<=form.start_time}>{t}</option>)}</Select></label></div>
    <label><LabelTip tip="Harga per jam yang berlaku pada hari dan jam ini untuk lapangan terpilih, menggantikan tarif dasar.">Tarif per jam</LabelTip><MoneyInput required min={1000} max={10000000} value={form.hourly_rate} onChange={e=>setForm({...form,hourly_rate:Number(e.target.value)})}/></label>
    {selected.length>0&&form.days.length>0&&<div className="ops-schedule"><b>{formatDays(form.days)}, {form.start_time} – {form.end_time}</b>{selected.map(c=><span key={c.id}>{c.name}: {money(c.hourly_rate)} → {money(form.hourly_rate)} per jam</span>)}</div>}
    <p className="ops-muted">Tarif khusus hanya berlaku untuk booking yang dibuat setelah disimpan. Pada lapangan dan hari yang sama, jamnya tidak boleh bertumpuk dengan tarif khusus lain.</p>
  </div><div className="modal-actions"><button type="button" onClick={close} disabled={busy}>Batal</button><Submit busy={busy||!form.court_ids.length||!form.days.length}/></div></form></Modal>;
}

function MaintenanceForm({courts,date,close,done}:{courts:Court[];date:string;close:()=>void;done:()=>void}){
  // Jam bawaan selalu ada di pilihan lapangan itu, agar yang terlihat sama dengan yang dikirim.
  const slotFor=(court:Court|undefined,start=court?.opens_at)=>{
    if(!court||!start)return {start_time:"",end_time:""};
    return {start_time:start,end_time:timeSlots(Math.min(minute(start)+60,minute(court.closes_at)),minute(court.closes_at))[0]};
  };
  const [form,setForm]=useState({court_id:courts[0]?.id||"",date,...slotFor(courts[0]),reason:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const court=courts.find(c=>c.id===form.court_id)!;
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{await api("/operations/maintenance",{method:"POST",body:JSON.stringify(form)});toast.success("Perawatan dijadwalkan");done()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title="Jadwalkan perawatan" close={close}><form onSubmit={submit}><div className="modal-fields">{error&&<ErrorBox message={error}/>}<label>Lapangan<Select value={form.court_id} onChange={e=>setForm({...form,court_id:e.target.value,...slotFor(courts.find(c=>c.id===e.target.value))})}>{courts.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</Select></label><label>Tanggal<DateInput required min={date} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><div className="field-grid"><label>Mulai<Select value={form.start_time} onChange={e=>{const start=e.target.value;setForm({...form,...(form.end_time>start?{start_time:start}:slotFor(court,start))})}}>{timeSlots(minute(court.opens_at),minute(court.closes_at)-30).map(t=><option key={t}>{t}</option>)}</Select></label><label>Selesai<Select value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})}>{timeSlots(minute(court.opens_at)+30,minute(court.closes_at)).map(t=><option key={t} disabled={t<=form.start_time}>{t}</option>)}</Select></label></div><label>Alasan<input required minLength={3} maxLength={200} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label></div><div className="modal-actions"><button type="button" onClick={close}>Batal</button><Submit busy={busy}/></div></form></Modal>;
}
