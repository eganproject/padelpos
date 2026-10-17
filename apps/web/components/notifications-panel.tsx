"use client";
import { useCallback,useEffect,useMemo,useState } from "react";
import { BellRing,Check,History,Loader2,Mail,MailCheck,MessageCircle,RefreshCw,Send,TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ErrorBox } from "./operation-ui";

/** Sama dengan API (apps/api/src/notify-events.ts). */
const eventKeys=["bill","payment_due","confirmed","expired","receipt","reschedule","cancelled","reminder","staff_new"] as const;
type EventKey=typeof eventKeys[number];
type Events=Record<EventKey,boolean>;
const eventLabels:Record<EventKey,[string,string]>={
  bill:["Tagihan","Saat pelanggan checkout online dan saat kasir membuat link pembayaran. Berisi nominal, batas bayar, dan tombol bayar."],
  payment_due:["Pengingat batas bayar","Pesanan online yang belum dibayar, sekali menjelang batas waktunya habis."],
  confirmed:["Pembayaran online diterima","Bukti booking dengan kode pesanan dan jadwal."],
  expired:["Waktu bayar habis","Slot dilepas karena belum dibayar, dengan tautan untuk memesan lagi."],
  receipt:["Kwitansi kasir","Saat kasir mencatat pembayaran atau pengembalian dana."],
  reschedule:["Jadwal dipindah","Setiap kali booking dipindah, oleh staf maupun pelanggan."],
  cancelled:["Booking dibatalkan","Saat staf membatalkan booking, beserta alasannya."],
  reminder:["Pengingat sebelum main","Sekali per jadwal, sesuai jam di atas."],
  staff_new:["Pemberitahuan untuk staf","Ke penerima staf: booking online baru dan pindah jadwal oleh pelanggan."],
};
const kindLabel:Record<string,string>={bill:"Tagihan",payment_due:"Pengingat bayar",confirmed:"Pembayaran diterima",expired:"Waktu bayar habis",receipt:"Kwitansi",reschedule:"Pindah jadwal",cancelled:"Pembatalan",reminder:"Pengingat main",staff_new:"Untuk staf"};
const statusLabel={pending:"Antre",sent:"Terkirim",failed:"Gagal"};
const statusTone={pending:"wait",sent:"on",failed:"off"};

type EmailSettings={enabled:boolean;host:string;port:number;secure:boolean;user:string;from_name:string;from_email:string;staff_recipients:string[];reminder_hours:number;events:Events;updated_at:string|null;password_set:boolean;source:"env"|"panel";ready:boolean};
type Provider="simulasi"|"fonnte"|"wablas"|"cloud";
type WaSettings={enabled:boolean;provider:Provider;base_url:string;phone_number_id:string;staff_numbers:string[];reminder_hours:number;events:Events;updated_at:string|null;token_set:boolean;source:"env"|"panel";ready:boolean;problem:string};
type Status="pending"|"sent"|"failed";
type EmailItem={id:string;kind:string;recipient:string;subject:string;status:Status;attempts:number;last_error:string;created_at:string;sent_at:string|null};
type WaItem={id:string;kind:string;recipient:string;text:string;provider:string;status:Status;attempts:number;last_error:string;created_at:string;sent_at:string|null};
type Queue<T>={items:T[];counts:Record<string,number>};
type Data={settings:EmailSettings;outbox:Queue<EmailItem>;whatsapp:{settings:WaSettings;outbox:Queue<WaItem>}};

const providers:{id:Provider;name:string;hint:string}[]=[
  {id:"simulasi",name:"Simulasi",hint:"Tidak mengirim apa pun. Isi setiap pesan tampil di Riwayat kiriman, cocok untuk mencoba alurnya dulu."},
  {id:"fonnte",name:"Fonnte",hint:"Penyedia lokal berbasis nomor WhatsApp biasa. Token ada di menu Device di fonnte.com."},
  {id:"wablas",name:"Wablas",hint:"Penyedia lokal. Isi token dan alamat server sesuai akun, mis. https://jkt.wablas.com."},
  {id:"cloud",name:"WhatsApp Cloud API",hint:"Resmi dari Meta. Pesan teks bebas hanya sampai bila pelanggan menghubungi nomor bisnis dalam 24 jam terakhir."},
];
const when=(value:string)=>new Date(value).toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"});
const savedLabel=(dirty:boolean,at:string|null)=>dirty?"Ada perubahan yang belum disimpan.":at?`Terakhir disimpan ${new Date(at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}.`:"Belum pernah disimpan.";
const splitList=(value:string)=>value.split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean);

function EventChecks({events,onChange,channel}:{events:Events;onChange:(events:Events)=>void;channel:string}){
  return <section className="cms-card wide">
    <header><h2>Pesan yang dikirim lewat {channel}</h2><p>Pelanggan yang masuk dengan Google selalu menerima salinannya di menu Notifikasi akun, dan bisa mematikan email atau WhatsApp dari profilnya.</p></header>
    <div className="notif-events">
      {eventKeys.map(key=><label className="cms-check" key={key}><input type="checkbox" checked={events[key]} onChange={e=>onChange({...events,[key]:e.target.checked})}/> <span><b>{eventLabels[key][0]}</b><small className="cms-hint"> {eventLabels[key][1]}</small></span></label>)}
    </div>
  </section>;
}

type EmailForm={enabled:boolean;host:string;port:number;secure:boolean;user:string;password:string;clear_password:boolean;from_name:string;from_email:string;staff_recipients:string;reminder_hours:number;events:Events};
const emailForm=(s:EmailSettings):EmailForm=>({enabled:s.enabled,host:s.host,port:s.port,secure:s.secure,user:s.user,password:"",clear_password:false,from_name:s.from_name,from_email:s.from_email,staff_recipients:s.staff_recipients.join(", "),reminder_hours:s.reminder_hours,events:s.events});

function EmailTab({settings,saved}:{settings:EmailSettings;saved:(s:EmailSettings)=>void}){
  const [form,setForm]=useState(()=>emailForm(settings));
  const [busy,setBusy]=useState(""),[error,setError]=useState(""),[testTo,setTestTo]=useState(""),[test,setTest]=useState<{ok:boolean;message:string}|null>(null);
  useEffect(()=>setForm(emailForm(settings)),[settings]);
  const dirty=useMemo(()=>JSON.stringify(form)!==JSON.stringify(emailForm(settings)),[form,settings]);
  const set=<K extends keyof EmailForm>(key:K,value:EmailForm[K])=>setForm(current=>({...current,[key]:value}));
  const env=settings.source==="env";
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy("simpan");setError("");
    try{const result=await api<{settings:EmailSettings}>("/operations/notifications/settings",{method:"PUT",body:JSON.stringify({...form,staff_recipients:splitList(form.staff_recipients)})});saved(result.settings);toast.success("Pengaturan email disimpan")}
    catch(e){setError((e as Error).message)}finally{setBusy("")}
  }
  async function sendTest(){
    setBusy("uji");setTest(null);
    try{setTest(await api<{ok:boolean;message:string}>("/operations/notifications/test",{method:"POST",body:JSON.stringify({to:testTo})}))}
    catch(e){setTest({ok:false,message:(e as Error).message})}finally{setBusy("")}
  }
  return <>
    {error&&<ErrorBox message={error}/>}
    <form className="cms-form" onSubmit={save}>
      <div className="cms-grid">
        <section className="cms-card">
          <header><h2>Server SMTP</h2><p>Bisa memakai Gmail atau Google Workspace (smtp.gmail.com, port 587, dengan App Password), Zoho, atau layanan seperti Mailgun dan SendGrid. Password tidak pernah ditampilkan lagi setelah disimpan.</p></header>
          <label className="cms-check"><input type="checkbox" checked={form.enabled} onChange={e=>set("enabled",e.target.checked)}/> Aktifkan notifikasi email</label>
          {env&&<p className="cms-hint">Server SMTP saat ini diambil dari environment (SMTP_HOST dan lainnya) dan mengalahkan isian di bawah.</p>}
          <div className="field-grid">
            <label className="cms-field"><span className="cms-label">Host</span><input value={form.host} maxLength={200} placeholder="smtp.gmail.com" disabled={env} onChange={e=>set("host",e.target.value)}/></label>
            <label className="cms-field"><span className="cms-label">Port</span><input type="number" min={1} max={65535} value={form.port} disabled={env} onChange={e=>set("port",Number(e.target.value))}/></label>
          </div>
          <label className="cms-check"><input type="checkbox" checked={form.secure} disabled={env} onChange={e=>set("secure",e.target.checked)}/> Koneksi SSL langsung (biasanya port 465). Biarkan mati untuk port 587.</label>
          <label className="cms-field"><span className="cms-label">Nama pengguna</span><input value={form.user} maxLength={200} autoComplete="off" placeholder="booking@venue-anda.com" disabled={env} onChange={e=>set("user",e.target.value)}/></label>
          <label className="cms-field"><span className="cms-label">Password</span>
            <input type="password" autoComplete="new-password" maxLength={200} value={form.password} disabled={env||form.clear_password} placeholder={settings.password_set?"Tersimpan, isi hanya bila ingin mengganti":"Password atau App Password"} onChange={e=>set("password",e.target.value)}/>
          </label>
          {settings.password_set&&!env&&<label className="cms-check"><input type="checkbox" checked={form.clear_password} onChange={e=>set("clear_password",e.target.checked)}/> Hapus password tersimpan</label>}
        </section>
        <section className="cms-card">
          <header><h2>Pengirim dan penerima</h2><p>Balasan pelanggan diarahkan ke email venue di menu Info Venue.</p></header>
          <label className="cms-field"><span className="cms-label">Nama pengirim</span><input value={form.from_name} maxLength={80} placeholder="Bawaan: nama venue" onChange={e=>set("from_name",e.target.value)}/></label>
          <label className="cms-field"><span className="cms-label">Email pengirim</span><input type="email" value={form.from_email} maxLength={200} placeholder="Bawaan: nama pengguna SMTP" onChange={e=>set("from_email",e.target.value)}/>
            <small className="cms-hint">Gmail hanya mengizinkan alamat akun itu sendiri atau alias yang sudah diverifikasi.</small></label>
          <label className="cms-field"><span className="cms-label">Email staf</span><input value={form.staff_recipients} maxLength={600} placeholder="kasir@venue.com, pemilik@venue.com" onChange={e=>set("staff_recipients",e.target.value)}/>
            <small className="cms-hint">Maksimal 5, dipisah koma. Menerima pemberitahuan booking online baru.</small></label>
          <label className="cms-field"><span className="cms-label">Pengingat dikirim (jam sebelum main)</span><input type="number" min={0} max={72} value={form.reminder_hours} onChange={e=>set("reminder_hours",Number(e.target.value))}/>
            <small className="cms-hint">Isi 0 untuk mematikan pengingat lewat email.</small></label>
        </section>
        <EventChecks events={form.events} onChange={events=>set("events",events)} channel="email"/>
      </div>
      <div className={`cms-savebar${dirty?" dirty":""}`}>
        <span>{savedLabel(dirty,settings.updated_at)}</span>
        <button className="ops-primary" type="submit" disabled={!dirty||!!busy}>{busy==="simpan"?"Menyimpan…":"Simpan pengaturan email"}</button>
      </div>
    </form>
    <section className="cms-card">
      <header><h2>Kirim email uji</h2><p>Simpan pengaturan dulu, lalu kirim satu email untuk memastikan server SMTP menerimanya.</p></header>
      <div className="pay-copy">
        <input type="email" value={testTo} placeholder="email-anda@contoh.com" onChange={e=>setTestTo(e.target.value)}/>
        <button type="button" className="ops-secondary" disabled={!testTo||!!busy||dirty||!settings.host} onClick={()=>void sendTest()}>{busy==="uji"?<Loader2 size={15} className="spin"/>:<Send size={14}/>} Kirim</button>
      </div>
      {test&&<p className={`pay-test ${test.ok?"ok":"warn"}`} role="status">{test.ok?<Check size={15}/>:<TriangleAlert size={15}/>} {test.message}</p>}
    </section>
  </>;
}

type WaForm={enabled:boolean;provider:Provider;token:string;clear_token:boolean;base_url:string;phone_number_id:string;staff_numbers:string;reminder_hours:number;events:Events};
const waForm=(s:WaSettings):WaForm=>({enabled:s.enabled,provider:s.provider,token:"",clear_token:false,base_url:s.base_url,phone_number_id:s.phone_number_id,staff_numbers:s.staff_numbers.join(", "),reminder_hours:s.reminder_hours,events:s.events});

function WhatsAppTab({settings,saved}:{settings:WaSettings;saved:(s:WaSettings)=>void}){
  const [form,setForm]=useState(()=>waForm(settings));
  const [busy,setBusy]=useState(""),[error,setError]=useState(""),[testTo,setTestTo]=useState(""),[test,setTest]=useState<{ok:boolean;message:string}|null>(null);
  useEffect(()=>setForm(waForm(settings)),[settings]);
  const dirty=useMemo(()=>JSON.stringify(form)!==JSON.stringify(waForm(settings)),[form,settings]);
  const set=<K extends keyof WaForm>(key:K,value:WaForm[K])=>setForm(current=>({...current,[key]:value}));
  const env=settings.source==="env";
  const real=form.provider!=="simulasi";
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy("simpan");setError("");
    try{const result=await api<{settings:WaSettings}>("/operations/notifications/whatsapp",{method:"PUT",body:JSON.stringify({...form,staff_numbers:splitList(form.staff_numbers)})});saved(result.settings);toast.success("Pengaturan WhatsApp disimpan")}
    catch(e){setError((e as Error).message)}finally{setBusy("")}
  }
  async function sendTest(){
    setBusy("uji");setTest(null);
    try{setTest(await api<{ok:boolean;message:string}>("/operations/notifications/whatsapp/test",{method:"POST",body:JSON.stringify({to:testTo})}))}
    catch(e){setTest({ok:false,message:(e as Error).message})}finally{setBusy("")}
  }
  return <>
    {error&&<ErrorBox message={error}/>}
    <form className="cms-form" onSubmit={save}>
      <div className="cms-grid">
        <section className="cms-card wide">
          <header><h2>Penyedia WhatsApp</h2><p>WhatsApp dibaca jauh lebih cepat daripada email, jadi tagihan dan pengingat lewat WhatsApp paling efektif menekan pesanan yang tidak dibayar dan pemain yang tidak datang.</p></header>
          <label className="cms-check"><input type="checkbox" checked={form.enabled} onChange={e=>set("enabled",e.target.checked)}/> Aktifkan notifikasi WhatsApp</label>
          {env&&<p className="cms-hint">Penyedia saat ini diambil dari environment (WHATSAPP_PROVIDER dan lainnya) dan mengalahkan isian di bawah.</p>}
          <div className="notif-providers" role="radiogroup" aria-label="Penyedia WhatsApp">
            {providers.map(item=><label key={item.id} className={`notif-provider${form.provider===item.id?" on":""}`}>
              <input type="radio" name="wa-provider" value={item.id} checked={form.provider===item.id} disabled={env} onChange={()=>set("provider",item.id)}/>
              <b>{item.name}</b><small>{item.hint}</small>
            </label>)}
          </div>
          {real&&<div className="field-grid">
            <label className="cms-field"><span className="cms-label">{form.provider==="cloud"?"Access token":"Token API"}</span>
              <input type="password" autoComplete="new-password" maxLength={500} value={form.token} disabled={env||form.clear_token} placeholder={settings.token_set?"Tersimpan, isi hanya bila ingin mengganti":"Tempel token dari penyedia"} onChange={e=>set("token",e.target.value)}/></label>
            {form.provider==="cloud"
              ?<label className="cms-field"><span className="cms-label">Phone number ID</span><input inputMode="numeric" value={form.phone_number_id} maxLength={40} disabled={env} placeholder="1234567890123456" onChange={e=>set("phone_number_id",e.target.value)}/></label>
              :<label className="cms-field"><span className="cms-label">Alamat server{form.provider==="fonnte"?" (opsional)":""}</span><input value={form.base_url} maxLength={200} disabled={env} placeholder={form.provider==="wablas"?"https://jkt.wablas.com":"Bawaan: https://api.fonnte.com"} onChange={e=>set("base_url",e.target.value)}/></label>}
          </div>}
          {real&&settings.token_set&&!env&&<label className="cms-check"><input type="checkbox" checked={form.clear_token} onChange={e=>set("clear_token",e.target.checked)}/> Hapus token tersimpan</label>}
          <div className="field-grid">
            <label className="cms-field"><span className="cms-label">Nomor WhatsApp staf</span><input value={form.staff_numbers} maxLength={200} placeholder="0812 3456 7890, 0813…" onChange={e=>set("staff_numbers",e.target.value)}/>
              <small className="cms-hint">Maksimal 5, dipisah koma.</small></label>
            <label className="cms-field"><span className="cms-label">Pengingat dikirim (jam sebelum main)</span><input type="number" min={0} max={72} value={form.reminder_hours} onChange={e=>set("reminder_hours",Number(e.target.value))}/>
              <small className="cms-hint">Isi 0 untuk mematikan pengingat lewat WhatsApp.</small></label>
          </div>
        </section>
        <EventChecks events={form.events} onChange={events=>set("events",events)} channel="WhatsApp"/>
      </div>
      <div className={`cms-savebar${dirty?" dirty":""}`}>
        <span>{savedLabel(dirty,settings.updated_at)}</span>
        <button className="ops-primary" type="submit" disabled={!dirty||!!busy}>{busy==="simpan"?"Menyimpan…":"Simpan pengaturan WhatsApp"}</button>
      </div>
    </form>
    <section className="cms-card">
      <header><h2>Kirim pesan uji</h2><p>Simpan pengaturan dulu, lalu kirim satu pesan ke nomor Anda sendiri.</p></header>
      <div className="pay-copy">
        <input inputMode="tel" value={testTo} placeholder="0812 3456 7890" onChange={e=>setTestTo(e.target.value)}/>
        <button type="button" className="ops-secondary" disabled={!testTo||!!busy||dirty} onClick={()=>void sendTest()}>{busy==="uji"?<Loader2 size={15} className="spin"/>:<Send size={14}/>} Kirim</button>
      </div>
      {test&&<p className={`pay-test ${test.ok?"ok":"warn"}`} role="status">{test.ok?<Check size={15}/>:<TriangleAlert size={15}/>} {test.message}</p>}
    </section>
  </>;
}

function HistoryTab({data,reload,setData}:{data:Data;reload:()=>void;setData:(update:(d:Data)=>Data)=>void}){
  const [channel,setChannel]=useState<"email"|"whatsapp">("whatsapp");
  const [busy,setBusy]=useState("");
  async function retry(id:string){
    setBusy(id);
    try{
      if(channel==="email"){const r=await api<{outbox:Queue<EmailItem>}>(`/operations/notifications/${id}/retry`,{method:"POST",body:"{}"});setData(d=>({...d,outbox:r.outbox}))}
      else{const r=await api<{outbox:Queue<WaItem>}>(`/operations/notifications/whatsapp/${id}/retry`,{method:"POST",body:"{}"});setData(d=>({...d,whatsapp:{...d.whatsapp,outbox:r.outbox}}))}
      toast.success("Pesan dicoba kirim ulang");
    }catch(e){toast.error((e as Error).message)}finally{setBusy("")}
  }
  const status=(item:{status:Status;last_error:string})=><><span className={`status-pill ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>{item.last_error&&item.status!=="sent"&&<small className="table-description">{item.last_error}</small>}</>;
  const action=(item:{id:string;status:Status})=>item.status==="failed"&&<button className="ops-secondary" disabled={!!busy} onClick={()=>void retry(item.id)}>{busy===item.id?"Mengirim…":"Kirim ulang"}</button>;
  return <>
    <div className="ops-section-title">
      <div className="seg notif-seg" role="tablist" aria-label="Kanal">
        <button type="button" role="tab" aria-selected={channel==="whatsapp"} onClick={()=>setChannel("whatsapp")}><MessageCircle size={14}/> WhatsApp</button>
        <button type="button" role="tab" aria-selected={channel==="email"} onClick={()=>setChannel("email")}><Mail size={14}/> Email</button>
      </div>
      <button type="button" className="ops-secondary" onClick={reload} disabled={!!busy}><RefreshCw size={14}/> Muat ulang</button>
    </div>
    <p className="cms-hint">Pesan yang gagal dicoba ulang otomatis sampai 5 kali, lalu dapat dikirim ulang dari sini.{channel==="whatsapp"?" Klik baris untuk membaca isi pesannya.":""}</p>
    {channel==="email"?<div className="manage-table-card ops-table table-cards"><table>
      <thead><tr><th>Waktu</th><th>Penerima</th><th>Jenis</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>{data.outbox.items.map(item=><tr key={item.id}>
        <td data-label="Waktu">{when(item.created_at)}</td>
        <td className="wide" data-label="Penerima"><b>{item.recipient}</b><small className="table-description">{item.subject}</small></td>
        <td data-label="Jenis">{kindLabel[item.kind]??item.kind}</td>
        <td data-label="Status">{status(item)}</td>
        <td className="actions">{action(item)}</td>
      </tr>)}</tbody>
    </table>{!data.outbox.items.length&&<p className="empty-state">Belum ada email yang dikirim.</p>}</div>
    :<div className="manage-table-card ops-table table-cards"><table>
      <thead><tr><th>Waktu</th><th>Penerima</th><th>Jenis</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>{data.whatsapp.outbox.items.map(item=><tr key={item.id}>
        <td data-label="Waktu">{when(item.created_at)}</td>
        <td className="wide" data-label="Penerima"><details className="notif-preview"><summary><b>+{item.recipient}</b>{item.provider==="simulasi"&&<span className="status-pill done">Simulasi</span>}</summary><pre>{item.text}</pre></details></td>
        <td data-label="Jenis">{kindLabel[item.kind]??item.kind}</td>
        <td data-label="Status">{status(item)}</td>
        <td className="actions">{action(item)}</td>
      </tr>)}</tbody>
    </table>{!data.whatsapp.outbox.items.length&&<p className="empty-state">Belum ada pesan WhatsApp.</p>}</div>}
  </>;
}

const tabs=[{id:"email",label:"Email",icon:Mail},{id:"whatsapp",label:"WhatsApp",icon:MessageCircle},{id:"riwayat",label:"Riwayat kiriman",icon:History}] as const;
type Tab=typeof tabs[number]["id"];

/** Kanal notifikasi pelanggan dan staf: email (SMTP), WhatsApp, dan riwayat antrean kirimannya. */
export function NotificationsPanel(){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[tab,setTab]=useState<Tab>("whatsapp");
  const load=useCallback(async()=>{
    try{setData(await api<Data>("/operations/notifications"));setError("")}
    catch(e){setError((e as Error).message)}
  },[]);
  useEffect(()=>{void load()},[load]);
  const savedEmail=useCallback((settings:EmailSettings)=>setData(d=>d&&{...d,settings}),[]);
  const savedWa=useCallback((settings:WaSettings)=>setData(d=>d&&{...d,whatsapp:{...d.whatsapp,settings}}),[]);

  if(error&&!data)return <ErrorBox message={error} retry={load}/>;
  if(!data)return <p className="empty-state">Memuat pengaturan notifikasi…</p>;
  const email=data.settings,wa=data.whatsapp.settings;
  const providerName=providers.find(p=>p.id===wa.provider)?.name??wa.provider;
  return <div className="cms">
    {error&&<ErrorBox message={error}/>}
    <div className="notif-channels">
      <div className={`pay-badge ${email.ready?"on":"off"}`}>
        {email.ready?<MailCheck size={22} aria-hidden="true"/>:<TriangleAlert size={22} aria-hidden="true"/>}
        <div><b>Email {email.ready?"aktif":"belum aktif"}</b><small>{email.ready?`Dari ${email.from_email} · ${data.outbox.counts.sent??0} terkirim`:email.host?"Nyalakan di tab Email.":"Server SMTP belum diisi."}</small></div>
      </div>
      <div className={`pay-badge ${wa.ready?"on":"off"}`}>
        {wa.ready?<MessageCircle size={22} aria-hidden="true"/>:<TriangleAlert size={22} aria-hidden="true"/>}
        <div><b>WhatsApp {wa.ready?(wa.provider==="simulasi"?"simulasi":"aktif"):"belum aktif"}</b><small>{wa.ready?(wa.provider==="simulasi"?"Pesan hanya dicatat, tidak dikirim.":`Lewat ${providerName} · ${data.whatsapp.outbox.counts.sent??0} terkirim`):wa.problem||"Nyalakan di tab WhatsApp."}</small></div>
      </div>
      <div className="pay-badge on">
        <BellRing size={22} aria-hidden="true"/>
        <div><b>Notifikasi akun selalu aktif</b><small>Pelanggan yang masuk dengan Google melihat tagihan, kwitansi, dan pengingat di menu Notifikasi.</small></div>
      </div>
    </div>
    <div className="cms-tabs" role="tablist" aria-label="Kanal notifikasi">
      {tabs.map(item=><button key={item.id} type="button" role="tab" aria-selected={tab===item.id} onClick={()=>setTab(item.id)}>
        <item.icon size={16} aria-hidden="true"/><span>{item.label}</span>
        {item.id==="riwayat"&&!!((data.outbox.counts.failed??0)+(data.whatsapp.outbox.counts.failed??0))&&<i className="cms-dot" title="Ada pesan gagal"/>}
      </button>)}
    </div>
    <div role="tabpanel" hidden={tab!=="email"}><EmailTab settings={email} saved={savedEmail}/></div>
    <div role="tabpanel" hidden={tab!=="whatsapp"}><WhatsAppTab settings={wa} saved={savedWa}/></div>
    {tab==="riwayat"&&<div role="tabpanel"><HistoryTab data={data} reload={()=>void load()} setData={update=>setData(d=>d&&update(d))}/></div>}
  </div>;
}
