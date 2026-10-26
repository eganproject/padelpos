"use client";
import { useCallback,useEffect,useMemo,useState } from "react";
import { Check,Copy,ExternalLink,Loader2,RefreshCw,ShieldCheck,TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api,money } from "@/lib/api";
import { formatShortDay } from "@/lib/shop";
import { type AdminIntent,type ChannelFee,type FeeBearer,type PaymentSettings,amountDue,feeFor,intentLabel,intentTone,payTypeLabel,rateLabel,surchargeFor } from "@/lib/payments";
import { ErrorBox } from "./operation-ui";
import { Select } from "./form-controls";
import { InfoTip } from "@/components/tooltip";

type Data={settings:PaymentSettings;intents:AdminIntent[];date:string;time:string;timezone:string};
type Form={enabled:boolean;environment:"sandbox"|"production";client_key:string;server_key:string;clear_server_key:boolean;mode:"full"|"dp";dp_percent:number;hold_minutes:number;note:string;fee_bearer:FeeBearer;vat_percent:number;channels:ChannelFee[]};
const formFrom=(settings:PaymentSettings):Form=>({enabled:settings.enabled,environment:settings.environment,client_key:settings.client_key,server_key:"",clear_server_key:false,mode:settings.mode,dp_percent:settings.dp_percent,hold_minutes:settings.hold_minutes,note:settings.note,
  fee_bearer:settings.fee_bearer,vat_percent:settings.vat_percent,channels:settings.channels.map(channel=>({...channel}))});
/** Contoh di panel: harga lapangan yang mudah dibayangkan. */
const sample=350000;

export function PaymentsPanel(){
  const [data,setData]=useState<Data|null>(null),[form,setForm]=useState<Form|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(""),[test,setTest]=useState<{ok:boolean;message:string}|null>(null);
  const load=useCallback(async()=>{
    try{const result=await api<Data>("/operations/payments");setData(result);setForm(formFrom(result.settings));setError("")}
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
      const body={...form,channels:Object.fromEntries(form.channels.map(({key,enabled,percent,flat,vat})=>[key,{enabled,percent,flat,vat}]))};
      const result=await api<{settings:PaymentSettings}>("/operations/payments/settings",{method:"PUT",body:JSON.stringify(body)});
      setData(current=>current&&{...current,settings:result.settings});setForm(formFrom(result.settings));setTest(null);
      toast.success("Pengaturan pembayaran disimpan");
    }catch(e){setError((e as Error).message)}finally{setBusy("")}
  }
  async function runTest(){
    setBusy("uji");setTest(null);
    try{setTest(await api<{ok:boolean;message:string}>("/operations/payments/test",{method:"POST",body:"{}"}))}
    catch(e){setTest({ok:false,message:(e as Error).message})}finally{setBusy("")}
  }
  async function recheck(orderId:string){
    setBusy(orderId);
    try{
      const result=await api<{settings:PaymentSettings;intents:AdminIntent[]}>(`/operations/payments/intents/${encodeURIComponent(orderId)}/refresh`,{method:"POST",body:"{}"});
      setData(current=>current&&{...current,...result});toast.success("Status transaksi diperbarui");
    }catch(e){toast.error((e as Error).message)}finally{setBusy("")}
  }
  async function copy(text:string,label:string){
    try{await navigator.clipboard.writeText(text);toast.success(`${label} disalin`)}
    catch{toast.error("Tidak dapat menyalin otomatis. Salin manual dari kolomnya.")}
  }

  if(error&&!data)return <ErrorBox message={error} retry={load}/>;
  if(!data||!form||!settings)return <p className="empty-state">Memuat pengaturan pembayaran…</p>;
  const sandbox=form.environment==="sandbox";
  const setChannel=(key:string,patch:Partial<ChannelFee>)=>setForm(current=>current&&{...current,channels:current.channels.map(channel=>channel.key===key?{...channel,...patch}:channel)});
  const qris=form.channels.find(channel=>channel.key==="qris"&&channel.enabled)??form.channels.find(channel=>channel.enabled);
  const keyHint=sandbox?"SB-Mid-server-…":"Mid-server-…";
  return <div className="cms">
    {error&&<ErrorBox message={error}/>}
    <div className="pay-status">
      <div className={`pay-badge ${settings.ready?"on":"off"}`}>
        {settings.ready?<ShieldCheck size={22} aria-hidden="true"/>:<TriangleAlert size={22} aria-hidden="true"/>}
        <div>
          <b>{settings.ready?"Pembayaran online aktif":settings.server_key_set?"Belum diaktifkan":"Kunci Midtrans belum diisi"}</b>
          <small>{settings.ready?"Pelanggan dapat memesan dan membayar sendiri dari halaman jadwal.":"Selama belum aktif, pelanggan memesan lewat WhatsApp seperti biasa."}</small>
        </div>
      </div>
      <dl className="pay-meta">
        <div><dt>Lingkungan</dt><dd>{settings.environment==="production"?"Produksi":"Sandbox (uji coba)"}</dd></div>
        <div><dt>Server key</dt><dd>{settings.server_key_set?(settings.key_source==="env"?"Dari environment":"Tersimpan di panel"):"Belum diisi"}</dd></div>
        <div><dt>Cara menagih</dt><dd>{settings.mode==="dp"?`DP ${settings.dp_percent}%`:"Bayar penuh"}</dd></div>
        <div><dt>Batas bayar</dt><dd>{settings.hold_minutes} menit</dd></div>
        <div><dt>Biaya admin</dt><dd>{settings.fee_bearer==="customer"?"Ditanggung pelanggan":"Ditanggung venue"}</dd></div>
      </dl>
      <button type="button" className="ops-secondary" onClick={()=>void runTest()} disabled={!settings.server_key_set||!!busy}>
        {busy==="uji"?<Loader2 size={15} className="spin"/>:<RefreshCw size={15}/>} Uji koneksi
      </button>
    </div>
    {test&&<p className={`pay-test ${test.ok?"ok":"warn"}`} role="status">{test.ok?<Check size={15}/>:<TriangleAlert size={15}/>} {test.message}</p>}

    <form className="cms-form" onSubmit={save}>
      <div className="cms-grid">
        <section className="cms-card">
          <header><h2>Kunci Midtrans</h2><p>Ambil dari dashboard Midtrans: Settings → Access Keys. Server key bersifat rahasia dan tidak pernah ditampilkan lagi setelah disimpan.</p></header>
          <label className="cms-check"><input type="checkbox" checked={form.enabled} onChange={e=>set("enabled",e.target.checked)}/> Aktifkan pembayaran online</label>
          <label className="cms-field"><span className="cms-label">Lingkungan</span>
            <Select value={form.environment} onChange={e=>set("environment",e.target.value as Form["environment"])}>
              <option value="sandbox">Sandbox — untuk uji coba</option>
              <option value="production">Produksi — uang sungguhan</option>
            </Select>
            <small className="cms-hint">Sandbox memakai kunci berawalan SB-. Ganti ke produksi setelah alurnya terbukti.</small>
          </label>
          <label className="cms-field"><span className="cms-label">Client key<InfoTip text="Kunci publik untuk menampilkan halaman bayar Midtrans di browser pelanggan. Aman terlihat."/></span>
            <input value={form.client_key} maxLength={120} placeholder={sandbox?"SB-Mid-client-…":"Mid-client-…"} onChange={e=>set("client_key",e.target.value)}/>
          </label>
          <label className="cms-field"><span className="cms-label">Server key<InfoTip text="Kunci rahasia untuk membuat tagihan dan memeriksa notifikasi pembayaran. Disimpan terenkripsi dan tidak pernah ditampilkan lagi."/></span>
            <input type="password" autoComplete="off" maxLength={120} value={form.server_key} disabled={form.clear_server_key}
              placeholder={settings.server_key_set?"Tersimpan — isi hanya bila ingin mengganti":keyHint} onChange={e=>set("server_key",e.target.value)}/>
            <small className="cms-hint">{settings.key_source==="env"?"Saat ini server key diambil dari environment (MIDTRANS_SERVER_KEY) dan mengalahkan isian ini.":`Formatnya ${keyHint}`}</small>
          </label>
          {settings.server_key_set&&settings.key_source==="panel"&&(
            <label className="cms-check"><input type="checkbox" checked={form.clear_server_key} onChange={e=>set("clear_server_key",e.target.checked)}/> Hapus server key tersimpan</label>
          )}
        </section>

        <section className="cms-card">
          <header><h2>Cara menagih</h2><p>Berlaku untuk pemesanan online. Booking yang dibuat kasir tidak terpengaruh.</p></header>
          <fieldset className="chip-field"><legend>Nominal yang dibayar online<InfoTip text="Bayar penuh: pelanggan melunasi saat memesan. DP sebagian: pelanggan membayar sebagian dulu, sisanya dilunasi di venue dan dicatat kasir."/></legend>
            <div className="chip-group">
              <button type="button" aria-pressed={form.mode==="full"} onClick={()=>set("mode","full")}>Bayar penuh</button>
              <button type="button" aria-pressed={form.mode==="dp"} onClick={()=>set("mode","dp")}>DP sebagian</button>
            </div>
          </fieldset>
          {form.mode==="dp"&&(
            <label className="cms-field"><span className="cms-label">Besar DP (%)</span>
              <input type="number" min={10} max={90} step={1} value={form.dp_percent} onChange={e=>set("dp_percent",Number(e.target.value))}/>
              <small className="cms-hint">Contoh: tagihan {money(300000)} menjadi {money(amountDue(form,300000))} dibayar online, sisanya di venue.</small>
            </label>
          )}
          <label className="cms-field"><span className="cms-label">Batas waktu bayar (menit)</span>
            <input type="number" min={10} max={120} step={1} value={form.hold_minutes} onChange={e=>set("hold_minutes",Number(e.target.value))}/>
            <small className="cms-hint">Selama itu slot ditahan. Lewat batas, booking otomatis kedaluwarsa dan slotnya terbuka lagi.</small>
          </label>
          <label className="cms-field"><span className="cms-label">Catatan di halaman pembayaran</span>
            <textarea rows={3} maxLength={300} value={form.note} onChange={e=>set("note",e.target.value)} placeholder="Mis. bukti pembayaran otomatis dikirim ke email."/>
          </label>
        </section>

        <section className="cms-card wide">
          <header><h2>Biaya admin Midtrans</h2><p>Midtrans memotong biaya setiap transaksi yang berhasil, besarnya berbeda per metode. Tarif awal mengikuti harga standar di midtrans.com/pricing; ubah bila kontrak venue Anda berbeda. Berlaku untuk booking online, link tagihan, member, dan kasir.</p></header>
          <fieldset className="chip-field"><legend>Siapa yang menanggung<InfoTip text="Venue: harga tetap, potongan Midtrans jadi biaya venue. Pelanggan: biaya ditambahkan ke tagihan sesuai metode yang dipilih, venue menerima harga penuh."/></legend>
            <div className="chip-group">
              <button type="button" aria-pressed={form.fee_bearer==="venue"} onClick={()=>set("fee_bearer","venue")}>Venue</button>
              <button type="button" aria-pressed={form.fee_bearer==="customer"} onClick={()=>set("fee_bearer","customer")}>Pelanggan</button>
            </div>
          </fieldset>
          {qris&&<p className="fee-example">{form.fee_bearer==="customer"
            ?<>Contoh harga {money(sample)} lewat {qris.label}: pelanggan memilih metode dulu, lalu membayar <b>{money(sample+surchargeFor(form,qris,sample))}</b> (biaya layanan {money(surchargeFor(form,qris,sample))}). Venue tetap menerima {money(sample)}. Biaya layanan dicatat sebagai Pendapatan Biaya Layanan Pembayaran dan potongan Midtrans sebagai Biaya Bank &amp; Payment Gateway.</>
            :<>Contoh harga {money(sample)} lewat {qris.label}: pelanggan membayar {money(sample)}, Midtrans memotong {money(feeFor(qris,sample,form.vat_percent))}, dan venue menerima <b>{money(sample-feeFor(qris,sample,form.vat_percent))}</b>. Potongannya dicatat sebagai Biaya Bank &amp; Payment Gateway di laba rugi.</>}
          </p>}
          <div className="fee-scroll"><table className="fee-table">
            <thead><tr><th>Metode<InfoTip text="Centang untuk menampilkan metode ini di halaman bayar."/></th><th>Persen<InfoTip text="Biaya persen dari nominal transaksi, mis. 0,7 untuk QRIS."/></th><th>Biaya tetap<InfoTip text="Biaya rupiah per transaksi, mis. Rp4.000 untuk virtual account."/></th><th>+PPN<InfoTip text="Centang bila Midtrans menambahkan PPN di atas tarif metode ini."/></th><th className="num">{form.fee_bearer==="customer"?`Biaya layanan dari ${money(sample)}`:`Potongan dari ${money(sample)}`}</th></tr></thead>
            <tbody>{form.channels.map(channel=><tr key={channel.key} className={channel.enabled?"":"off"}>
              <td><label className="cms-check"><input type="checkbox" checked={channel.enabled} onChange={e=>setChannel(channel.key,{enabled:e.target.checked})}/> <span>{channel.label}<small>{channel.hint}</small></span></label></td>
              <td><input type="number" min={0} max={10} step={0.01} value={channel.percent} aria-label={`Persen ${channel.label}`} onChange={e=>setChannel(channel.key,{percent:Number(e.target.value)||0})}/></td>
              <td><input type="number" min={0} max={50000} step={100} value={channel.flat} aria-label={`Biaya tetap ${channel.label}`} onChange={e=>setChannel(channel.key,{flat:Math.round(Number(e.target.value))||0})}/></td>
              <td><input type="checkbox" checked={channel.vat} aria-label={`Tambah PPN untuk ${channel.label}`} onChange={e=>setChannel(channel.key,{vat:e.target.checked})}/></td>
              <td className="num">{money(form.fee_bearer==="customer"?surchargeFor(form,channel,sample):feeFor(channel,sample,form.vat_percent))}<small>{rateLabel(channel)}</small></td>
            </tr>)}</tbody>
          </table></div>
          <label className="cms-field"><span className="cms-label">PPN atas biaya Midtrans (%)</span>
            <input type="number" min={0} max={20} step={0.5} value={form.vat_percent} onChange={e=>set("vat_percent",Number(e.target.value)||0)}/>
            <small className="cms-hint">Midtrans menagih PPN untuk tarif yang ditandai +PPN (VA, kartu, paylater). QRIS, GoPay, ShopeePay, dan gerai retail sudah termasuk pajak. Metode yang dimatikan tidak tampil di halaman bayar.</small>
          </label>
        </section>

        <section className="cms-card wide">
          <header><h2>Webhook Midtrans</h2><p>Tempel alamat ini di dashboard Midtrans: Settings → Configuration → Payment Notification URL. Tanpa itu, pembayaran yang masuk tidak otomatis mengonfirmasi booking.</p></header>
          <div className="pay-copy">
            <input readOnly value={settings.webhook_url} onFocus={e=>e.target.select()}/>
            <button type="button" className="ops-secondary" onClick={()=>void copy(settings.webhook_url,"Alamat webhook")}><Copy size={14}/> Salin</button>
          </div>
          <ul className="pay-steps">
            <li>Pastikan alamat ini dapat diakses dari internet. Saat mencoba di komputer sendiri, gunakan terowongan seperti ngrok, lalu isi <code>PUBLIC_URL</code> pada .env.</li>
            <li>Pelanggan kembali ke <code>{settings.finish_url}&lt;kode&gt;</code> setelah membayar, dan halaman itu juga menanyakan status ke Midtrans sebagai cadangan.</li>
            <li>Uji dulu di sandbox memakai kartu atau QRIS simulator Midtrans sebelum berpindah ke produksi.</li>
          </ul>
        </section>
      </div>
      <div className={`cms-savebar${dirty?" dirty":""}`}>
        <span>{dirty?"Ada perubahan yang belum disimpan.":settings.updated_at?`Terakhir disimpan ${new Date(settings.updated_at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}.`:"Belum pernah disimpan."}</span>
        <button className="ops-primary" type="submit" disabled={!dirty||!!busy}>{busy==="simpan"?"Menyimpan…":"Simpan pengaturan"}</button>
      </div>
    </form>

    <div className="ops-section-title"><div><h2>Transaksi terakhir</h2><p>Dari checkout pelanggan dan link tagihan kasir. Zona waktu venue: {data.timezone}.</p></div></div>
    <div className="manage-table-card ops-table table-cards"><table>
      <thead><tr><th>Waktu</th><th>Pesanan<InfoTip text="Nomor order Midtrans. Satu pesanan online bisa berisi beberapa booking."/></th><th>Jadwal</th><th>Nominal</th><th>Metode</th><th>Status<InfoTip text="Menunggu: halaman bayar dibuka tapi belum dibayar. Lunas: uang diterima dan booking terkonfirmasi otomatis. Kedaluwarsa/Gagal: tidak ada uang masuk."/></th><th>Aksi</th></tr></thead>
      <tbody>{data.intents.map(intent=><tr key={intent.order_id}>
        <td data-label="Waktu">{new Date(intent.created_at).toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"})}<small className="table-description">{intent.environment==="production"?"Produksi":"Sandbox"}</small></td>
        <td className="wide" data-label="Pesanan"><b>{intent.customer}</b><small className="table-description">{intent.order_id} · {intent.kind==="tagihan"?"Link kasir":"Checkout online"}</small></td>
        <td data-label="Jadwal">{intent.court_name}<small className="table-description">{formatShortDay(intent.date)} · {intent.start_time} – {intent.end_time}</small></td>
        <td data-label="Nominal">{money(intent.amount)}{(intent.surcharge??0)>0&&<small className="table-description">termasuk biaya layanan {money(intent.surcharge!)}</small>}</td>
        <td data-label="Metode">{intent.payment_type?payTypeLabel(intent.payment_type):"—"}</td>
        <td data-label="Status"><span className={`status-pill ${intentTone[intent.status]}`}>{intentLabel[intent.status]}</span></td>
        <td className="actions"><div className="row-actions">
          <button onClick={()=>void recheck(intent.order_id)} disabled={!!busy} aria-label={`Periksa status ${intent.order_id}`} data-tip="Tanya status ke Midtrans"><RefreshCw/></button>
          {/* Halaman pesanan hanya ada untuk checkout online; link kasir dibuka lewat halaman Midtrans-nya. */}
          {intent.kind==="booking"?<a href={`/pesanan/${intent.booking_id}`} target="_blank" rel="noopener" aria-label={`Buka halaman pesanan ${intent.order_id}`} data-tip="Buka halaman pesanan pelanggan"><ExternalLink/></a>
            :intent.status==="pending"&&intent.redirect_url?<a href={intent.redirect_url} target="_blank" rel="noopener" aria-label={`Buka link pembayaran ${intent.order_id}`} data-tip="Buka link pembayaran Midtrans"><ExternalLink/></a>:null}
        </div></td>
      </tr>)}</tbody>
    </table>{!data.intents.length&&<p className="empty-state">Belum ada transaksi online.</p>}</div>
  </div>;
}
