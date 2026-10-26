"use client";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, money, rangeLabel } from "@/lib/finance";
import { row } from "@/lib/report-export";
import { ReportHead } from "./finance-reports";
import { ShareBar } from "./finance-ui";
import { InfoTip } from "@/components/tooltip";

type Range = { from:string; to:string };
type FlowRow = { activity:string; account_id:string; code:string; name:string; inflow:number; outflow:number; net:number };
type CashFlow = {
  from:string; to:string; opening:number; closing:number; net:number; difference:number;
  sections:{ key:string; label:string; rows:FlowRow[]; inflow:number; outflow:number; net:number }[];
  cash_accounts:{ id:string; code:string; name:string; opening:number; closing:number }[];
};
type Side = { debit:number; credit:number };
type TrialBalance = {
  from:string; to:string; balanced:boolean;
  rows:{ id:string; code:string; name:string; type:string; opening:Side; debit:number; credit:number; closing:Side }[];
  totals:{ opening_debit:number; opening_credit:number; debit:number; credit:number; closing_debit:number; closing_credit:number };
};
type Operations = {
  from:string; to:string; days:number;
  summary:{ sessions:number; booked_hours:number; occupancy:number; court_revenue:number; revenue:number; voucher_uses:number; voucher_discount:number; item_revenue:number };
  courts:{ id:string; name:string; sessions:number; booked_hours:number; open_hours:number; occupancy:number; court_revenue:number; addon_revenue:number; discounts:number; total:number }[];
  heat:{ hour:string; cells:(number|null)[] }[];
  customers:{ key:string; name:string; phone:string; sessions:number; hours:number; spend:number; last_date:string }[];
  vouchers:{ id:string; code:string; name:string; active:number; uses:number; discount:number; customers:number; online:number }[];
  items:{ addon_id:string|null; name:string; type:string; quantity:number; revenue:number; cost:number; margin:number }[];
};

function useReport<T>(path:string) {
  const [data,setData] = useState<T|null>(null);
  useEffect(() => { setData(null); api<T>(path).then(setData).catch(error=>toast.error((error as Error).message)); }, [path]);
  return data;
}
const signedMoney = (value:number) => value>0 ? `+${money(value)}` : money(value);

// --- Arus kas --------------------------------------------------------------

export function CashFlowReport({ range }: { range:Range }) {
  const data = useReport<CashFlow>(`/operations/finance/reports/arus-kas?from=${range.from}&to=${range.to}`);
  if (!data) return <p className="empty-state">Menghitung arus kas…</p>;
  const max = Math.max(1, ...data.sections.flatMap(section=>section.rows.map(item=>Math.abs(item.net))));
  return (
    <div className="fin-report">
      <ReportHead title="Laporan arus kas" subtitle={`${rangeLabel(range.from,range.to)} · metode langsung, dari jurnal kas dan bank`}
        build={()=>({
          title:"Laporan Arus Kas", filename:`arus-kas-${range.from}-sd-${range.to}`,
          meta:[["Periode",rangeLabel(range.from,range.to)],["Metode","Langsung"]],
          columns:[{header:"Kode",width:10},{header:"Uraian",width:40},{header:"Masuk",kind:"money"},{header:"Keluar",kind:"money"},{header:"Bersih",kind:"money"}],
          rows:[
            row.subtotal("","Saldo kas & bank awal",null,null,data.opening),
            row.blank(),
            ...data.sections.flatMap(section=>[
              row.group(section.label),
              ...section.rows.map(item=>row.line(item.code,item.name,item.inflow||null,item.outflow||null,item.net)),
              row.subtotal("",`Kas bersih ${section.label.toLowerCase()}`,section.inflow,section.outflow,section.net),
              row.blank(),
            ]),
            row.subtotal("","Kenaikan (penurunan) kas",null,null,data.net),
            row.total("","Saldo kas & bank akhir",null,null,data.closing),
          ],
          notes:["Setiap baris adalah akun lawan dari jurnal yang menyentuh kas atau bank. Pindah dana antar kas tidak dihitung."],
        })}/>
      <div className="fin-result">
        <div><span>Saldo awal</span><strong>{money(data.opening)}</strong></div>
        <div><span>Kenaikan / penurunan<InfoTip text="Selisih uang masuk dan keluar pada periode ini. Pindah dana antar kas tidak dihitung karena uangnya tetap di venue."/></span><strong className={data.net>=0?"plus":"minus"}>{signedMoney(data.net)}</strong></div>
        <div className="fin-result-net"><span>Saldo akhir</span><strong>{money(data.closing)}</strong>
          <em className={data.difference===0?"plus":"minus"}>{data.difference===0?"Cocok dengan saldo kas & bank":`Selisih ${money(data.difference)}`}</em></div>
      </div>
      <div className="fin-flow">
        {data.sections.map(section => (
          <section key={section.key} className="fin-sheet">
            <header><h4>{section.label}</h4><span className={section.net<0?"minus":""}>{signedMoney(section.net)}</span></header>
            <table>
              <thead><tr><th>Uraian<InfoTip text="Akun lawan dari setiap jurnal yang menyentuh kas atau bank, mis. Pendapatan Sewa Lapangan untuk uang booking."/></th><th/><th className="right">Masuk</th><th className="right">Keluar</th></tr></thead>
              <tbody>
                {section.rows.map(item => (
                  <tr key={item.account_id}>
                    <td className="fin-cell-name"><b>{item.name}</b><small>{item.code}</small></td>
                    <td className="fin-cell-bar"><ShareBar value={item.net} max={max} tone={item.net>=0?"plus":"minus"}/></td>
                    <td className="right">{item.inflow?money(item.inflow):"—"}</td>
                    <td className="right">{item.outflow?money(item.outflow):"—"}</td>
                  </tr>
                ))}
                {!section.rows.length && <tr><td colSpan={4} className="muted">Tidak ada arus kas.</td></tr>}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      {data.cash_accounts.length>0 && <section className="fin-sheet">
        <header><h4>Saldo per akun kas & bank</h4></header>
        <table><thead><tr><th>Akun</th><th className="right">Awal</th><th className="right">Akhir</th></tr></thead>
          <tbody>{data.cash_accounts.map(account=><tr key={account.id}><td className="fin-cell-name"><b>{account.name}</b><small>{account.code}</small></td><td className="right">{money(account.opening)}</td><td className="right">{money(account.closing)}</td></tr>)}</tbody></table>
      </section>}
      <p className="fin-note">Operasi: uang dari pelanggan dan untuk biaya harian. Investasi: beli dan jual peralatan. Pendanaan: setoran dan pengambilan pemilik, serta pinjaman.</p>
    </div>
  );
}

// --- Neraca saldo ------------------------------------------------------------

export function TrialBalanceReport({ range }: { range:Range }) {
  const data = useReport<TrialBalance>(`/operations/finance/reports/neraca-saldo?from=${range.from}&to=${range.to}`);
  if (!data) return <p className="empty-state">Menyusun neraca saldo…</p>;
  const cell = (value:number) => value ? money(value) : "—";
  const t = data.totals;
  return (
    <div className="fin-report">
      <ReportHead title="Neraca saldo" subtitle={`${rangeLabel(range.from,range.to)} · saldo awal, mutasi, dan saldo akhir setiap akun`}
        build={()=>({
          title:"Neraca Saldo", filename:`neraca-saldo-${range.from}-sd-${range.to}`, landscape:true,
          meta:[["Periode",rangeLabel(range.from,range.to)],["Status",data.balanced?"Seimbang":"Tidak seimbang"]],
          columns:[{header:"Kode",width:10},{header:"Akun",width:32},{header:"Awal debit",kind:"money"},{header:"Awal kredit",kind:"money"},{header:"Mutasi debit",kind:"money"},{header:"Mutasi kredit",kind:"money"},{header:"Akhir debit",kind:"money"},{header:"Akhir kredit",kind:"money"}],
          rows:[
            ...data.rows.map(item=>row.line(item.code,item.name,item.opening.debit||null,item.opening.credit||null,item.debit||null,item.credit||null,item.closing.debit||null,item.closing.credit||null)),
            row.total("","Total",t.opening_debit,t.opening_credit,t.debit,t.credit,t.closing_debit,t.closing_credit),
          ],
        })}/>
      <div className="fin-balance-toolbar">
        <span className={`fin-tag ${data.balanced?"ok":"warn"}`}>{data.balanced?<><Check size={13}/> Debit dan kredit seimbang</>:<><TriangleAlert size={13}/> Tidak seimbang</>}</span>
      </div>
      <div className="manage-table-card ops-table table-cards fin-trial"><table>
        <thead><tr><th>Akun</th><th className="right">Saldo awal</th><th className="right">Mutasi debit<InfoTip text="Jumlah semua debit ke akun ini selama periode."/></th><th className="right">Mutasi kredit<InfoTip text="Jumlah semua kredit ke akun ini selama periode."/></th><th className="right">Saldo akhir</th></tr></thead>
        <tbody>
          {data.rows.map(item => (
            <tr key={item.id}>
              <td className="wide" data-label="Akun"><b>{item.name}</b><small className="table-description">{item.code}</small></td>
              <td className="right" data-label="Saldo awal">{item.opening.debit?`D ${money(item.opening.debit)}`:item.opening.credit?`K ${money(item.opening.credit)}`:"—"}</td>
              <td className="right" data-label="Mutasi debit">{cell(item.debit)}</td>
              <td className="right" data-label="Mutasi kredit">{cell(item.credit)}</td>
              <td className="right" data-label="Saldo akhir"><b>{item.closing.debit?`D ${money(item.closing.debit)}`:item.closing.credit?`K ${money(item.closing.credit)}`:"—"}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td className="wide" data-label="Total"><b>Total</b></td>
          <td className="right" data-label="Saldo awal">D {money(t.opening_debit)} · K {money(t.opening_credit)}</td>
          <td className="right" data-label="Mutasi debit"><b>{money(t.debit)}</b></td>
          <td className="right" data-label="Mutasi kredit"><b>{money(t.credit)}</b></td>
          <td className="right" data-label="Saldo akhir"><b>D {money(t.closing_debit)} · K {money(t.closing_credit)}</b></td>
        </tr></tfoot>
      </table>{!data.rows.length && <p className="empty-state">Belum ada jurnal.</p>}</div>
      <p className="fin-note">D = saldo di sisi debit, K = sisi kredit. Total debit dan kredit selalu sama karena setiap jurnal seimbang.</p>
    </div>
  );
}

// --- Laporan operasional -----------------------------------------------------

const weekdays = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
const order = [1,2,3,4,5,6,0];
const typeName:Record<string,string> = { sewa:"Sewa", jual:"Jual", layanan:"Layanan", lainnya:"Lainnya" };

export function OperationsReport({ range }: { range:Range }) {
  const data = useReport<Operations>(`/operations/finance/reports/operasional?from=${range.from}&to=${range.to}`);
  const [tab,setTab] = useState<"lapangan"|"pelanggan"|"voucher"|"item">("lapangan");
  if (!data) return <p className="empty-state">Menghitung laporan operasional…</p>;
  const s = data.summary;
  const maxRevenue = Math.max(1, ...data.courts.map(court=>court.total));
  return (
    <div className="fin-report">
      <ReportHead title="Laporan operasional" subtitle={`${rangeLabel(range.from,range.to)} · ${data.days} hari · booking terkonfirmasi dan selesai`}
        build={()=>({
          title:"Laporan Operasional", filename:`operasional-${range.from}-sd-${range.to}`, landscape:true,
          meta:[["Periode",rangeLabel(range.from,range.to)],["Okupansi rata-rata",`${s.occupancy.toLocaleString("id-ID")}%`],["Sesi",String(s.sessions)]],
          columns:[{header:"Bagian",width:18},{header:"Nama",width:30},{header:"Jumlah",width:14},{header:"Jam / qty",width:12},{header:"Okupansi / pelanggan",width:16},{header:"Nilai",kind:"money"},{header:"Lain",kind:"money"}],
          rows:[
            row.group("Per lapangan (sesi, jam terisi, okupansi %, pendapatan bersih, sewa lapangan)"),
            ...data.courts.map(court=>row.line("Lapangan",court.name,court.sessions,court.booked_hours,`${court.occupancy}%`,court.total,court.court_revenue)),
            row.blank(),
            row.group("Pelanggan teratas (sesi, jam, terakhir main, belanja)"),
            ...data.customers.map(item=>row.line("Pelanggan",`${item.name} (${item.phone})`,item.sessions,item.hours,formatDate(item.last_date),item.spend,null)),
            row.blank(),
            row.group("Voucher (dipakai, pelanggan, potongan)"),
            ...data.vouchers.map(item=>row.line("Voucher",`${item.code} · ${item.name}`,item.uses,null,item.customers,item.discount,null)),
            row.blank(),
            row.group("Penjualan per item (qty, pendapatan, harga pokok)"),
            ...data.items.map(item=>row.line(typeName[item.type]??item.type,item.name,null,item.quantity,null,item.revenue,item.cost)),
          ],
        })}/>
      <div className="fin-result">
        <div><span>Okupansi<InfoTip text="Jam terisi booking dibagi jam buka semua lapangan aktif pada periode ini. Jam perawatan tidak ikut dihitung sebagai jam buka."/></span><strong>{s.occupancy.toLocaleString("id-ID")}%</strong><em>{s.booked_hours.toLocaleString("id-ID")} jam terisi</em></div>
        <div><span>Sesi main</span><strong>{s.sessions.toLocaleString("id-ID")}</strong></div>
        <div><span>Pendapatan booking<InfoTip text="Sewa lapangan dan tambahan dari booking yang tidak dibatalkan, setelah potongan dan sebelum pajak."/></span><strong>{money(s.revenue)}</strong><em>Sebelum pajak, setelah potongan</em></div>
        <div><span>Voucher dipakai</span><strong>{s.voucher_uses}</strong><em>Potongan {money(s.voucher_discount)}</em></div>
      </div>
      <div className="fin-subtabs" role="tablist" aria-label="Bagian laporan operasional">
        {([["lapangan","Lapangan & jam"],["pelanggan","Pelanggan teratas"],["voucher","Voucher"],["item","Penjualan item"]] as const).map(([key,label])=>
          <button key={key} type="button" role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}</button>)}
      </div>
      {tab==="lapangan" && <>
        <div className="manage-table-card ops-table table-cards"><table>
          <thead><tr><th>Lapangan</th><th>Okupansi<InfoTip text="Persentase jam buka lapangan ini yang terisi booking."/></th><th className="right">Sesi</th><th className="right">Jam terisi</th><th className="right">Sewa lapangan</th><th className="right">Tambahan</th><th className="right">Potongan<InfoTip text="Gabungan potongan manual, potongan member, dan voucher."/></th><th className="right">Bersih</th></tr></thead>
          <tbody>{data.courts.map(court=>(
            <tr key={court.id}>
              <td className="wide" data-label="Lapangan"><b>{court.name}</b><small className="table-description">dari {court.open_hours.toLocaleString("id-ID")} jam buka</small></td>
              <td data-label="Okupansi"><div className="occupancy"><span className="fin-share"><i style={{width:`${Math.min(100,court.occupancy)}%`}}/></span><b>{court.occupancy.toLocaleString("id-ID")}%</b></div></td>
              <td className="right" data-label="Sesi">{court.sessions}</td>
              <td className="right" data-label="Jam terisi">{court.booked_hours.toLocaleString("id-ID")}</td>
              <td className="right" data-label="Sewa lapangan">{money(court.court_revenue)}</td>
              <td className="right" data-label="Tambahan">{money(court.addon_revenue)}</td>
              <td className="right" data-label="Potongan">{court.discounts?`−${money(court.discounts)}`:"—"}</td>
              <td className="right" data-label="Bersih"><b>{money(court.total)}</b><ShareBar value={court.total} max={maxRevenue} tone="plus"/></td>
            </tr>))}</tbody>
        </table>{!data.courts.length && <p className="empty-state">Belum ada lapangan.</p>}</div>
        {data.heat.length>0 && <section className="fin-sheet">
          <header><h4>Okupansi per jam dan hari</h4><span className="heat-legend"><i className="h0"/>sepi <i className="h3"/>sedang <i className="h5"/>penuh</span></header>
          <div className="heat-scroll"><table className="heatmap" aria-label="Persentase jam terisi per jam dan hari">
            <thead><tr><th/>{order.map(day=><th key={day}>{weekdays[day]}</th>)}</tr></thead>
            <tbody>{data.heat.map(line=>(
              <tr key={line.hour}><th>{line.hour}</th>{order.map(day=>{const value=line.cells[day];return <td key={day} className={value===null?"none":`h${Math.min(5,Math.ceil(value/20))}`} data-tip={value===null?"Tutup / tidak ada hari ini":`${weekdays[day]} ${line.hour}: ${value}% terisi`}>{value?value:""}</td>})}</tr>
            ))}</tbody>
          </table></div>
        </section>}
      </>}
      {tab==="pelanggan" && <div className="manage-table-card ops-table table-cards"><table>
        <thead><tr><th>#</th><th>Pelanggan</th><th className="right">Sesi</th><th className="right">Jam main</th><th>Terakhir main</th><th className="right">Belanja</th></tr></thead>
        <tbody>{data.customers.map((item,index)=>(
          <tr key={item.key}><td data-label="#">{index+1}</td><td className="wide" data-label="Pelanggan"><b>{item.name}</b><small className="table-description">{item.phone}</small></td>
            <td className="right" data-label="Sesi">{item.sessions}</td><td className="right" data-label="Jam main">{item.hours.toLocaleString("id-ID")}</td>
            <td data-label="Terakhir main">{formatDate(item.last_date)}</td><td className="right" data-label="Belanja"><b>{money(item.spend)}</b></td></tr>))}</tbody>
      </table>{!data.customers.length && <p className="empty-state">Belum ada booking pada periode ini.</p>}</div>}
      {tab==="voucher" && <div className="manage-table-card ops-table table-cards"><table>
        <thead><tr><th>Voucher</th><th className="right">Dipakai</th><th className="right">Pelanggan<InfoTip text="Jumlah pelanggan berbeda (dihitung dari nomor telepon) yang memakai voucher ini."/></th><th className="right">Online<InfoTip text="Berapa kali voucher dipakai pelanggan sendiri saat checkout di situs, bukan lewat kasir."/></th><th className="right">Total potongan</th></tr></thead>
        <tbody>{data.vouchers.map(item=>(
          <tr key={item.id}><td className="wide" data-label="Voucher"><b>{item.code}</b><small className="table-description">{item.name}{item.active?"":" · nonaktif"}</small></td>
            <td className="right" data-label="Dipakai">{item.uses}</td><td className="right" data-label="Pelanggan">{item.customers}</td>
            <td className="right" data-label="Online">{item.online} <small className="muted">/ kasir {item.uses-item.online}</small></td><td className="right" data-label="Total potongan"><b>{money(item.discount)}</b></td></tr>))}</tbody>
      </table>{!data.vouchers.length && <p className="empty-state">Belum ada voucher yang dipakai pada periode ini.</p>}</div>}
      {tab==="item" && <div className="manage-table-card ops-table table-cards"><table>
        <thead><tr><th>Item</th><th>Jenis</th><th className="right">Qty</th><th className="right">Pendapatan</th><th className="right">Harga pokok<InfoTip text="HPP: harga beli rata-rata barang yang terjual. Hanya untuk barang jual yang harga belinya diisi."/></th><th className="right">Margin<InfoTip text="Pendapatan dikurangi harga pokok."/></th></tr></thead>
        <tbody>{data.items.map(item=>(
          <tr key={`${item.addon_id}-${item.name}`}><td className="wide" data-label="Item"><b>{item.name}</b></td><td data-label="Jenis">{typeName[item.type]??item.type}</td>
            <td className="right" data-label="Qty">{item.quantity.toLocaleString("id-ID")}</td><td className="right" data-label="Pendapatan">{money(item.revenue)}</td>
            <td className="right" data-label="Harga pokok">{item.cost?money(item.cost):"—"}</td>
            <td className="right" data-label="Margin">{item.cost?<b className={item.margin<0?"minus":""}>{money(item.margin)}</b>:<span className="muted">—</span>}</td></tr>))}</tbody>
      </table>{!data.items.length && <p className="empty-state">Belum ada sewa atau penjualan item pada periode ini.</p>}</div>}
      <p className="fin-note"><ArrowUpRight size={12}/> Okupansi = jam terisi dibanding jam buka lapangan, dikurangi jadwal perawatan. <ArrowDownLeft size={12}/> Item mencakup tambahan di booking dan transaksi kasir yang lunas; harga pokok hanya untuk barang jual yang harga belinya diisi.</p>
    </div>
  );
}
