"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { Activity,CalendarDays,CircleDollarSign,WalletCards } from "lucide-react";
import { AdminSectionShell } from "@/components/admin-section-shell";
import { ErrorBox } from "@/components/operation-ui";
import { api,money } from "@/lib/api";
import { type Booking,type Court,statusLabel } from "@/lib/operations";
type Summary={date:string;timezone:string;revenueToday:number;revenueWeek:number;bookingsToday:number;occupancy:number;receivable:number;refundsDue:number;daily:{date:string;amount:number}[];bookings:Booking[];courts:Court[]};
export default function AdminPage(){
  const [data,setData]=useState<Summary|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{try{setData(await api("/dashboard/summary"));setError("")}catch(e){setError((e as Error).message)}},[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),60000);return()=>clearInterval(timer)},[load]);
  const metrics=data?[{label:"Penerimaan neto hari ini",value:money(data.revenueToday),Icon:CircleDollarSign,tone:"lime"},{label:"Booking hari ini",value:String(data.bookingsToday),Icon:CalendarDays,tone:"violet"},{label:"Okupansi hari ini",value:data.occupancy+"%",Icon:Activity,tone:"cyan"},{label:"Tagihan belum lunas",value:money(data.receivable),Icon:WalletCards,tone:"orange"}]:[];
  const maximum=Math.max(1,...(data?.daily.map(d=>Math.abs(d.amount))||[]));
  return <AdminSectionShell><div className="manage-content"><div className="manage-heading"><div><p>WORKSPACE / OVERVIEW</p><h1>Operasional hari ini</h1><span>{data?.date||"Memuat…"} · {data?.timezone||""}</span></div><Link className="ops-primary" href="/admin/bookings">Kelola booking</Link></div>{error&&<ErrorBox message={error} retry={load}/>}
    {!data?<p className="empty-state">Memuat ringkasan operasional…</p>:<><div className="metric-grid">{metrics.map(({label,value,Icon,tone})=><article key={label} className={`metric-card ${tone}`}><div className="metric-top"><span><Icon/></span></div><p>{label}</p><h2>{value}</h2></article>)}</div>
    {data.refundsDue>0&&<div className="ops-alert">Pengembalian dana yang belum dicatat: <b>{money(data.refundsDue)}</b>. Periksa booking dibatalkan.</div>}
    <div className="ops-dashboard-grid"><article className="settings-card"><div className="ops-card-head"><h2>Penerimaan 7 hari</h2><strong>{money(data.revenueWeek)}</strong></div><p className="ops-muted">Pembayaran diterima dikurangi pengembalian pada tanggal transaksi.</p><div className="ops-chart" role="img" aria-label="Penerimaan neto tujuh hari terakhir">{data.daily.map(day=><div className="ops-chart-column" key={day.date}><span>{money(day.amount)}</span><div className="ops-bar-track"><i className={day.amount<0?"negative":""} style={{height:`${Math.max(day.amount?3:0,Math.abs(day.amount)/maximum*100)}%`}}/></div><small>{day.date.slice(5)}</small></div>)}</div></article>
    <article className="settings-card"><div className="ops-card-head"><h2>Status lapangan</h2><Link href="/admin/courts">Kelola</Link></div>{data.courts.length?data.courts.map(c=><div className="ops-history" key={c.id}><div><b>{c.name}</b><small>{c.opens_at} – {c.closes_at}</small></div><span className={c.state==="Tersedia"?"status-pill on":"status-pill"}>{c.state}{c.until?" · "+c.until:""}</span></div>):<div className="ops-empty"><p>Belum ada lapangan.</p><Link href="/admin/courts">Tambahkan lapangan pertama</Link></div>}</article></div>
    <div className="ops-section-title"><div><h2>Booking hari ini</h2><p>{data.bookings.length} reservasi · pembatalan tidak dihitung</p></div><Link href="/admin/bookings">Lihat semua</Link></div><div className="manage-table-card ops-table"><table><thead><tr><th>PELANGGAN</th><th>LAPANGAN</th><th>JAM</th><th>STATUS</th><th>TAGIHAN</th></tr></thead><tbody>{data.bookings.map(b=><tr key={b.id}><td>{b.customer}</td><td>{b.court_name}</td><td>{b.start_time} – {b.end_time}</td><td>{statusLabel[b.status]}</td><td>{money(b.total)}</td></tr>)}</tbody></table>{!data.bookings.length&&<p className="empty-state">Belum ada booking hari ini.</p>}</div><p className="ops-muted">Okupansi = durasi booking / jam lapangan aktif setelah dikurangi maintenance. Ringkasan diperbarui setiap menit.</p>
    </>}</div></AdminSectionShell>;
}

