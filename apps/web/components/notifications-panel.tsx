"use client";
import { useCallback,useEffect,useMemo,useState } from "react";
import { Check,Loader2,MailCheck,RefreshCw,Send,TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ErrorBox } from "./operation-ui";

type Events={confirmed:boolean;reschedule:boolean;cancelled:boolean;reminder:boolean;staff_new:boolean};
type Settings={enabled:boolean;host:string;port:number;secure:boolean;user:string;from_name:string;from_email:string;staff_recipients:string[];reminder_hours:number;events:Events;updated_at:string|null;password_set:boolean;source:"env"|"panel";ready:boolean};
type OutboxItem={id:string;kind:string;recipient:string;subject:string;status:"pending"|"sent"|"failed";attempts:number;last_error:string;created_at:string;sent_at:string|null};
type Data={settings:Settings;outbox:{items:OutboxItem[];counts:Record<string,number>}};
type Form={enabled:boolean;host:string;port:number;secure:boolean;user:string;password:string;clear_password:boolean;from_name:string;from_email:string;staff_recipients:string;reminder_hours:number;events:Events};
const formFrom=(s:Settings):Form=>({enabled:s.enabled,host:s.host,port:s.port,secure:s.secure,user:s.user,password:"",clear_password:false,from_name:s.from_name,from_email:s.from_email,staff_recipients:s.staff_recipients.join(", "),reminder_hours:s.reminder_hours,events:s.events});
const eventLabels:[keyof Events,string,string][]=[
  ["confirmed","Pembayaran online diterima","Ke pelanggan, berisi jadwal dan tautan pesanan."],
  ["reschedule","Jadwal dipindah","Ke pelanggan setiap kali booking dipindah, oleh staf maupun pelanggan."],
  ["cancelled","Booking dibatalkan","Ke pelanggan saat staf membatalkan booking."],
  ["reminder","Pengingat sebelum main","Ke pelanggan, sekali per jadwal."],
  ["staff_new","Pemberitahuan untuk staf","Ke email staf di bawah: booking online baru dan pindah jadwal oleh pelanggan."],
];
const kindLabel:Record<string,string>={confirmed:"Pembayaran diterima",reschedule:"Pindah jadwal",cancelled:"Pembatalan",reminder:"Pengingat",staff_new:"Untuk staf"};
const statusLabel={pending:"Antre",sent:"Terkirim",failed:"Gagal"};
const statusTone={pending:"wait",sent:"on",failed:"off"};

/** Pengaturan SMTP, jenis email yang dikirim, email uji, dan riwayat antrean kiriman. */
export function NotificationsPanel(){
  const [data,setData]=useState<Data|null>(null),[form,setForm]=useState<Form|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(""),[testTo,setTestTo]=useState(""),[test,setTest]=useState<{ok:boolean;message:string}|null>(null);
  const load=useCallback(async()=>{
    try{const result=await api<Data>("/operations/notifications");setData(result);setForm(formFrom(result.settings));setError("")}
    catch(e){setError((e as Error).message)}
  },[]);
  useEffect(()=>{void load()},[load]);
  const settings=data?.settings;
  const dirty=useMemo(()=>!!settings&&!!form&&JSON.stringify(form)!==JSON.stringify(formFrom(settings)),[form,settings]);
  const set=<K extends keyof Form>(key:K,value:Form[K])=>setForm(current=>current&&{...current,[key]:value});

  async function save(event:React.FormEvent){
    event.preventDefault();if(!form)return;
    setBusy("simpan");setError("");
    try{
      const staff=form.staff_recipients.split(/[\s,;]+/).map(v=>v.trim()).filter(Boolean);
      const result=await api<{settings:Settings}>("/operations/notifications/settings",{method:"PUT",body:JSON.stringify({...form,staff_recipients:staff})});
      setData(current=>current&&{...current,settings:result.settings});setForm(formFrom(result.settings));
      toast.success("Pengaturan email disimpan");
    }catch(e){setError((e as Error).message)}finally{setBusy("")}
  }
  async function sendTest(){
    setBusy("uji");setTest(null);
    try{setTest(await api<{ok:boolean;message:string}>("/operations/notifications/test",{method:"POST",body:JSON.stringify({to:testTo})}))}
    catch(e){setTest({ok:false,message:(e as Error).message})}finally{setBusy("")}
  }
  async function retry(id:string){
    setBusy(id);
    try{const result=await api<{outbox:Data["outbox"]}>(`/operations/notifications/${id}/retry`,{method:"POST",body:"{}"});setData(current=>current&&{...current,outbox:result.outbox});toast.success("Email dicoba kirim ulang")}
    catch(e){toast.error((e as Error).message)}finally{setBusy("")}
  }

  if(error&&!data)return <ErrorBox message={error} retry={load}/>;
  if(!data||!form||!settings)return <p className="empty-state">Memuat pengaturan email…</p>;
  const env=settings.source==="env";
  const counts=data.outbox.counts;
  return <div className="cms">
    {error&&<ErrorBox message={error}/>}
    <div className="pay-status">
      <div className={`pay-badge ${settings.ready?"on":"off"}`}>
        {settings.ready?<MailCheck size={22} aria-hidden="true"/>:<TriangleAlert size={22} aria-hidden="true"/>}
        <div>
          <b>{settings.ready?"Notifikasi email aktif":settings.host?"Belum diaktifkan":"Server SMTP belum diisi"}</b>
          <small>{settings.ready?"Email dikirim otomatis dan dicoba ulang bila server email sedang gagal.":"Selama belum aktif, tidak ada email yang dikirim ke pelanggan maupun staf."}</small>
        </div>
      </div>
      <dl className="pay-meta">
        <div><dt>Server</dt><dd>{settings.host?`${settings.host}:${settings.port}`:"—"}</dd></div>
        <div><dt>Pengirim</dt><dd>{settings.from_email||"—"}</dd></div>
        <div><dt>Terkirim</dt><dd>{counts.sent??0}</dd></div>
        <div><dt>Antre / gagal</dt><dd>{counts.pending??0} / {counts.failed??0}</dd></div>
      </dl>
    </div>

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
            <small className="cms-hint">Isi 0 untuk mematikan pengingat.</small></label>
        </section>

        <section className="cms-card wide">
          <header><h2>Email yang dikirim</h2><p>Pelanggan menerima email bila alamatnya diketahui: isian kasir saat membuat booking, email saat checkout online, atau email akun Google.</p></header>
          {eventLabels.map(([key,label,hint])=><label className="cms-check" key={key}><input type="checkbox" checked={form.events[key]} onChange={e=>set("events",{...form.events,[key]:e.target.checked})}/> <span><b>{label}</b><small className="cms-hint"> {hint}</small></span></label>)}
        </section>
      </div>
      <div className={`cms-savebar${dirty?" dirty":""}`}>
        <span>{dirty?"Ada perubahan yang belum disimpan.":settings.updated_at?`Terakhir disimpan ${new Date(settings.updated_at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}.`:"Belum pernah disimpan."}</span>
        <button className="ops-primary" type="submit" disabled={!dirty||!!busy}>{busy==="simpan"?"Menyimpan…":"Simpan pengaturan"}</button>
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

    <div className="ops-section-title"><div><h2>Email terakhir</h2><p>Email yang gagal dicoba ulang otomatis sampai 5 kali, lalu dapat dikirim ulang dari sini.</p></div><button type="button" className="ops-secondary" onClick={()=>void load()} disabled={!!busy}><RefreshCw size={14}/> Muat ulang</button></div>
    <div className="manage-table-card ops-table table-cards"><table>
      <thead><tr><th>Waktu</th><th>Penerima</th><th>Jenis</th><th>Status</th><th>Aksi</th></tr></thead>
      <tbody>{data.outbox.items.map(item=><tr key={item.id}>
        <td data-label="Waktu">{new Date(item.created_at).toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"})}</td>
        <td className="wide" data-label="Penerima"><b>{item.recipient}</b><small className="table-description">{item.subject}</small></td>
        <td data-label="Jenis">{kindLabel[item.kind]??item.kind}</td>
        <td data-label="Status"><span className={`status-pill ${statusTone[item.status]}`}>{statusLabel[item.status]}</span>{item.last_error&&item.status!=="sent"&&<small className="table-description">{item.last_error}</small>}</td>
        <td className="actions">{item.status==="failed"&&<button className="ops-secondary" disabled={!!busy} onClick={()=>void retry(item.id)}>{busy===item.id?"Mengirim…":"Kirim ulang"}</button>}</td>
      </tr>)}</tbody>
    </table>{!data.outbox.items.length&&<p className="empty-state">Belum ada email yang dikirim.</p>}</div>
  </div>;
}
