"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { Activity,ArrowRight,CalendarDays,CircleDollarSign,WalletCards } from "lucide-react";
import { AdminSectionShell } from "@/components/admin-section-shell";
import { ErrorBox } from "@/components/operation-ui";
import { api,money } from "@/lib/api";
import { type Booking,type Court,statusLabel,statusTone } from "@/lib/operations";
import { formatDay } from "@/lib/shop";
type Summary={date:string;timezone:string;revenueToday:number;revenueWeek:number;bookingsToday:number;occupancy:number;receivable:number;refundsDue:number;daily:{date:string;amount:number}[];bookings:Booking[];courts:Court[]};
const compactMoney=(value:number)=>value===0?"Rp 0":`${value<0?"−":""}Rp ${new Intl.NumberFormat("id-ID",{notation:"compact",maximumFractionDigits:1}).format(Math.abs(value))}`;
const chartDay=(date:string)=>new Intl.DateTimeFormat("id-ID",{weekday:"short",day:"numeric",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
const courtTone:Record<string,string>={Tersedia:"on",Digunakan:"done",Maintenance:"wait",Nonaktif:"off"};
export default function AdminPage(){
  const [data,setData]=useState<Summary|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{try{setData(await api("/dashboard/summary"));setError("")}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),60000);return()=>clearInterval(timer)},[load]);
  const metrics=data?[
    {label:"Penerimaan neto hari ini",value:money(data.revenueToday),hint:`7 hari terakhir: ${money(data.revenueWeek)}`,Icon:CircleDollarSign,tone:"lime"},
    {label:"Booking hari ini",value:String(data.bookingsToday),hint:"Tidak termasuk pembatalan",Icon:CalendarDays,tone:"violet"},
    {label:"Okupansi hari ini",value:data.occupancy+"%",hint:"Dari jam lapangan aktif",Icon:Activity,tone:"cyan"},
    {label:"Tagihan belum lunas",value:money(data.receivable),hint:"Seluruh booking aktif",Icon:WalletCards,tone:"orange"},
  ]:[];
  const maximum=Math.max(1,...(data?.daily.map(d=>Math.abs(d.amount))||[]));
  const quiet=!!data&&data.daily.every(d=>d.amount===0);
  return <AdminSectionShell><div className="manage-content">
    <div className="manage-heading"><div><p>OPERASIONAL / RINGKASAN</p><h1>Operasional hari ini</h1><span>{data?`${formatDay(data.date)} · ${data.timezone}`:"Memuat…"}</span></div><Link className="ops-primary" href="/admin/bookings">Kelola booking <ArrowRight size={16}/></Link></div>
    {error&&<ErrorBox message={error} retry={load}/>}
    {!data?<p className="empty-state">Memuat ringkasan operasional…</p>:<>
    <div className="metric-grid">{metrics.map(({label,value,hint,Icon,tone})=><article key={label} className={`metric-card ${tone}`}><div className="metric-top"><span><Icon/></span></div><p>{label}</p><h2>{value}</h2><small>{hint}</small></article>)}</div>
    {data.refundsDue>0&&<div className="ops-alert">Pengembalian dana yang belum dicatat: <b>{money(data.refundsDue)}</b>. Periksa booking yang dibatalkan.</div>}
    <div className="ops-dashboard-grid">
      <article className="settings-card"><div className="ops-card-head"><h2>Penerimaan 7 hari</h2><strong>{money(data.revenueWeek)}</strong></div><p className="ops-muted">Pembayaran diterima dikurangi pengembalian, menurut tanggal transaksi.</p>
        {quiet?<div className="ops-chart-empty"><p>Belum ada pembayaran tercatat dalam 7 hari terakhir.<br/>Grafik terisi setelah DP atau pelunasan dicatat di menu Booking.</p></div>
        :<div className="ops-chart" role="img" aria-label="Penerimaan neto tujuh hari terakhir">{data.daily.map(day=><div className="ops-chart-column" key={day.date}><span>{compactMoney(day.amount)}</span><div className="ops-bar-track"><i className={day.amount<0?"negative":""} style={{height:`${Math.max(day.amount?3:0,Math.abs(day.amount)/maximum*100)}%`}}/></div><small>{chartDay(day.date)}</small></div>)}</div>}
      </article>
      <article className="settings-card"><div className="ops-card-head"><h2>Status lapangan</h2><Link className="ops-link" href="/admin/courts">Kelola <ArrowRight size={14}/></Link></div>{data.courts.length?data.courts.map(c=><div className="ops-history" key={c.id}><div><b>{c.name}</b><small>Buka {c.opens_at} – {c.closes_at}</small></div><span className={`status-pill ${c.state?courtTone[c.state]??"":""}`}>{c.state}{c.until?` sampai ${c.until}`:""}</span></div>):<div className="ops-empty"><p>Belum ada lapangan.</p><Link className="ops-link" href="/admin/courts">Tambahkan lapangan pertama</Link></div>}</article>
    </div>
    <div className="ops-section-title"><div><h2>Booking hari ini</h2><p>{data.bookings.length} reservasi · pembatalan tidak dihitung</p></div><Link className="ops-link" href="/admin/bookings">Lihat semua <ArrowRight size={14}/></Link></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>PELANGGAN</th><th>LAPANGAN</th><th>JAM</th><th>STATUS</th><th>TAGIHAN</th></tr></thead><tbody>{data.bookings.map(b=><tr key={b.id}><td className="wide" data-label="Pelanggan"><b>{b.customer}</b></td><td data-label="Lapangan">{b.court_name}</td><td data-label="Jam">{b.start_time} – {b.end_time}</td><td data-label="Status"><span className={`status-pill ${statusTone[b.status]}`}>{statusLabel[b.status]}</span></td><td data-label="Tagihan">{money(b.total)}</td></tr>)}</tbody></table>{!data.bookings.length&&<p className="empty-state">Belum ada booking hari ini.</p>}</div>
    <p className="ops-muted">Okupansi = durasi booking ÷ jam lapangan aktif setelah dikurangi perawatan. Ringkasan diperbarui setiap menit.</p>
    </>}</div></AdminSectionShell>;
}
