"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, FileSpreadsheet, FileText, Download, Pencil, Plus, Printer, Scale, Search, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  type BalanceSheet, type GeneralLedger, type JournalEntry, type ProfitLoss, type Setup, type SubsidiaryLedger,
  changeOf, formatDate, money, rangeLabel, sourceLabel,
} from "@/lib/finance";
import { type ExportFormat, type ReportDoc, exportReport, row } from "@/lib/report-export";
import { Modal } from "./operation-ui";
import { AmountField, Empty, PeriodPicker, ShareBar } from "./finance-ui";
import { Select, DateInput } from "./form-controls";
import { CashFlowReport, OperationsReport, TrialBalanceReport } from "./finance-statements";
import { InfoTip } from "@/components/tooltip";

type Range = { from:string; to:string };
export type ReportView = "laba-rugi" | "neraca" | "arus-kas" | "neraca-saldo" | "buku-besar" | "pembantu" | "operasional";
const views: [ReportView,string,string][] = [
  ["laba-rugi","Laba rugi","Pendapatan dikurangi biaya pada periode terpilih: untung atau rugi."],
  ["neraca","Neraca","Posisi harta, kewajiban, dan modal pada satu tanggal."],
  ["arus-kas","Arus kas","Uang yang benar-benar masuk dan keluar dari kas dan bank, beserta asalnya."],
  ["neraca-saldo","Neraca saldo","Saldo semua akun. Total debit dan kredit harus sama; dipakai untuk memeriksa pembukuan."],
  ["buku-besar","Buku besar","Rincian setiap mutasi satu akun beserta saldo berjalannya."],
  ["pembantu","Buku besar pembantu","Rincian piutang, utang, uang muka, dan kas per pelanggan, pemasok, atau akun."],
  ["operasional","Operasional","Angka non-keuangan: okupansi lapangan, jam sibuk, pelanggan teratas, voucher, dan item terlaris."],
];

export function ReportsTab({ setup, range, today, onRange }: { setup:Setup; range:Range; today:string; onRange:(range:Range)=>void }) {
  const [view,setView] = useState<ReportView>("laba-rugi");
  return (
    <div className="fin-reports">
      <div className="fin-subtabs" role="tablist" aria-label="Jenis laporan">
        {views.map(([key,label,about]) => (
          <button key={key} type="button" role="tab" aria-selected={view===key} onClick={()=>setView(key)} data-tip={about}>{label}</button>
        ))}
      </div>
      {view!=="neraca" && <PeriodPicker from={range.from} to={range.to} today={today} onChange={onRange}/>}
      {view==="laba-rugi" && <ProfitLossReport range={range}/>}
      {view==="neraca" && <BalanceReport today={today}/>}
      {view==="buku-besar" && <LedgerReport setup={setup} range={range}/>}
      {view==="pembantu" && <SubsidiaryReport range={range}/>}
      {view==="arus-kas" && <CashFlowReport range={range}/>}
      {view==="neraca-saldo" && <TrialBalanceReport range={range}/>}
      {view==="operasional" && <OperationsReport range={range}/>}
    </div>
  );
}

/**
 * Judul laporan beserta tombol unduh. `build` menyusun isi laporan sekali untuk semua format,
 * dan boleh async bila datanya perlu diambil ulang (mis. seluruh jurnal, bukan hanya yang tampil).
 */
export function ReportHead({ title, subtitle, build }: { title:string; subtitle:string; build:()=>ReportDoc|null|Promise<ReportDoc|null> }) {
  const [busy,setBusy] = useState<ExportFormat|null>(null);
  async function download(format:ExportFormat) {
    setBusy(format);
    try {
      const doc = await build();
      if (!doc) return toast.error("Laporan masih dimuat, coba lagi sebentar");
      await exportReport(doc, format);
    } catch (error) { toast.error(`Gagal membuat file: ${(error as Error).message}`) }
    finally { setBusy(null) }
  }
  const label = (format:ExportFormat, text:string) => busy===format ? "Menyiapkan…" : text;
  return (
    <div className="fin-report-head">
      <div><h3>{title}</h3><p>{subtitle}</p></div>
      <div className="fin-report-actions" role="group" aria-label="Unduh laporan">
        <button type="button" className="ops-secondary" disabled={busy!==null} onClick={()=>void download("xlsx")} data-tip="Unduh sebagai file Excel (.xlsx)">
          <FileSpreadsheet size={14}/> {label("xlsx","Excel")}</button>
        <button type="button" className="ops-secondary" disabled={busy!==null} onClick={()=>void download("pdf")} data-tip="Unduh sebagai file PDF">
          <FileText size={14}/> {label("pdf","PDF")}</button>
        <button type="button" className="ops-secondary" disabled={busy!==null} onClick={()=>void download("csv")} data-tip="Unduh sebagai CSV">
          <Download size={14}/> {label("csv","CSV")}</button>
        <button type="button" className="ops-secondary" onClick={()=>window.print()}><Printer size={14}/> Cetak</button>
      </div>
    </div>
  );
}

// --- Laba rugi -------------------------------------------------------------

function ProfitLossReport({ range }: { range:Range }) {
  const [data,setData] = useState<ProfitLoss|null>(null);
  useEffect(() => {
    api<ProfitLoss>(`/operations/finance/reports/laba-rugi?from=${range.from}&to=${range.to}`).then(setData).catch(error=>toast.error((error as Error).message));
  }, [range.from, range.to]);
  if (!data) return <p className="empty-state">Menghitung laba rugi…</p>;
  const max = Math.max(1, ...data.income_lines.map(line=>line.amount), ...data.expense_lines.map(line=>line.amount));
  const delta = changeOf(data.net, data.previous.net);
  const section = (title:string, lines:typeof data.income_lines, total:number, tone:string) => (
    <section className="fin-sheet">
      <header><h4>{title}</h4><span>{money(total)}</span></header>
      <table>
        <thead><tr><th>Akun</th><th/><th className="right">Periode ini</th><th className="right">Sebelumnya</th></tr></thead>
        <tbody>
        {lines.map(line => (
          <tr key={line.id}>
            <td className="fin-cell-name"><b>{line.name}</b><small>{line.code}</small></td>
            <td className="fin-cell-bar"><ShareBar value={line.amount} max={max} tone={tone}/></td>
            <td className="right">{money(line.amount)}</td>
            <td className="right muted">{money(line.previous ?? 0)}</td>
          </tr>
        ))}
        {!lines.length && <tr><td colSpan={4} className="muted">Belum ada catatan pada periode ini.</td></tr>}
      </tbody></table>
    </section>
  );
  return (
    <div className="fin-report">
      <ReportHead title="Laporan laba rugi" subtitle={`${rangeLabel(range.from,range.to)} · pembanding: ${rangeLabel(data.previous.from,data.previous.to)}`}
        build={()=>({
          title:"Laporan Laba Rugi", filename:`laba-rugi-${range.from}-sd-${range.to}`,
          meta:[["Periode",rangeLabel(range.from,range.to)],["Pembanding",rangeLabel(data.previous.from,data.previous.to)]],
          columns:[{header:"Kode",width:10},{header:"Akun",width:36},{header:"Periode ini",kind:"money"},{header:"Periode sebelumnya",kind:"money"}],
          rows:[
            row.group("Pendapatan"),
            ...data.income_lines.map(line=>row.line(line.code,line.name,line.amount,line.previous??0)),
            row.subtotal("","Total pendapatan",data.income,data.previous.income),
            row.blank(),
            row.group("Biaya"),
            ...data.expense_lines.map(line=>row.line(line.code,line.name,line.amount,line.previous??0)),
            row.subtotal("","Total biaya",data.expense,data.previous.expense),
            row.blank(),
            row.total("",data.net>=0?"Laba bersih":"Rugi bersih",data.net,data.previous.net),
          ],
          notes:["Periode sebelumnya memiliki panjang hari yang sama dengan periode ini.","Pendapatan booking dihitung pada tanggal sesi bermain, bukan tanggal pemesanan."],
        })}/>
      <div className="fin-result">
        <div><span>Pendapatan<InfoTip text="Pendapatan booking diakui pada tanggal sesi dimainkan, bukan tanggal pemesanan atau pembayaran."/></span><strong className="plus">{money(data.income)}</strong></div>
        <div><span>Biaya</span><strong className="minus">{money(data.expense)}</strong></div>
        <div className="fin-result-net"><span>{data.net>=0?"Laba bersih":"Rugi bersih"}</span>
          <strong className={data.net>=0?"plus":"minus"}>{money(data.net)}</strong>
          {delta!==null && <em className={delta>=0?"plus":"minus"}>{delta>=0?"▲":"▼"} {Math.abs(delta)}% dari periode sebelumnya</em>}
        </div>
      </div>
      <div className="fin-sheet-grid">
        {section("Pendapatan", data.income_lines, data.income, "plus")}
        {section("Biaya", data.expense_lines, data.expense, "minus")}
      </div>
      <p className="fin-note">Kolom kanan adalah periode sebelumnya dengan panjang hari yang sama, supaya perbandingannya adil.
        Pendapatan booking dihitung pada tanggal sesi bermain, bukan tanggal pemesanan.</p>
    </div>
  );
}

// --- Neraca ----------------------------------------------------------------

function BalanceReport({ today }: { today:string }) {
  const [asOf,setAsOf] = useState(today);
  const [data,setData] = useState<BalanceSheet|null>(null);
  useEffect(() => {
    api<BalanceSheet>(`/operations/finance/reports/neraca?as_of=${asOf}`).then(setData).catch(error=>toast.error((error as Error).message));
  }, [asOf]);
  if (!data) return (
    <>
      <label className="fin-inline-field"><span>Posisi tanggal</span><DateInput value={asOf} onChange={e=>e.target.value&&setAsOf(e.target.value)}/></label>
      <p className="empty-state">Menyusun neraca…</p>
    </>
  );
  const rows = (lines:typeof data.assets) => lines.map(line => (
    <tr key={line.id}>
      <td className="fin-cell-name"><b>{line.name}</b><small>{line.code}</small></td>
      <td className={`right${line.amount<0?" minus":""}`}>{money(line.amount)}</td>
    </tr>
  ));
  return (
    <div className="fin-report">
      <ReportHead title="Neraca" subtitle={`Posisi keuangan per ${formatDate(asOf)}`}
        build={()=>({
          title:"Neraca", filename:`neraca-${asOf}`,
          meta:[["Posisi per",formatDate(asOf)],["Status",data.difference===0?"Seimbang":`Selisih ${money(data.difference)}`]],
          columns:[{header:"Kode",width:10},{header:"Pos",width:40},{header:"Jumlah",kind:"money",width:20}],
          rows:[
            row.group("HARTA"),
            ...data.asset_groups.flatMap(group=>[row.line("",group.label),...group.rows.map(line=>row.line(line.code,`    ${line.name}`,line.amount))]),
            row.total("","Total harta",data.total_assets),
            row.blank(),
            row.group("KEWAJIBAN"),
            ...data.liabilities.map(line=>row.line(line.code,line.name,line.amount)),
            row.subtotal("","Total kewajiban",data.total_liabilities),
            row.blank(),
            row.group("MODAL"),
            ...data.equity.map(line=>row.line(line.code,line.name,line.amount)),
            row.subtotal("","Total modal",data.total_equity),
            row.blank(),
            row.total("","Total kewajiban & modal",data.total_liabilities+data.total_equity),
          ],
          notes:data.advances>0?[`Kewajiban termasuk ${money(data.advances)} uang pelanggan untuk sesi yang belum dimainkan.`]:[],
        })}/>
      <div className="fin-balance-toolbar">
        <label className="fin-inline-field"><span>Posisi tanggal<InfoTip text="Neraca menunjukkan saldo pada akhir hari tanggal ini, bukan selama periode."/></span><DateInput value={asOf} onChange={e=>e.target.value&&setAsOf(e.target.value)}/></label>
        <span className={`fin-tag ${data.difference===0?"ok":"warn"}`}>
          {data.difference===0 ? <><Check size={13}/> Seimbang</> : <><TriangleAlert size={13}/> Selisih {money(data.difference)}</>}
        </span>
      </div>
      <div className="fin-sheet-grid">
        <section className="fin-sheet">
          <header><h4>Harta<InfoTip text="Apa yang dimiliki venue: kas dan bank, piutang, persediaan, dan aset tetap setelah penyusutan."/></h4><span>{money(data.total_assets)}</span></header>
          {data.asset_groups.map(group => (
            <table key={group.label}>
              <thead><tr><th colSpan={2}>{group.label}</th></tr></thead>
              <tbody>{rows(group.rows)}</tbody>
            </table>
          ))}
          {!data.assets.length && <p className="muted">Belum ada harta tercatat.</p>}
          <footer><span>Total harta</span><strong>{money(data.total_assets)}</strong></footer>
        </section>
        <section className="fin-sheet">
          <header><h4>Kewajiban & modal<InfoTip text="Asal dana harta: utang ke pihak lain (termasuk uang pelanggan untuk sesi yang belum main) dan modal pemilik ditambah laba yang ditahan."/></h4><span>{money(data.total_liabilities+data.total_equity)}</span></header>
          <table><thead><tr><th colSpan={2}>Kewajiban</th></tr></thead>
            <tbody>{data.liabilities.length?rows(data.liabilities):<tr><td className="muted" colSpan={2}>Tidak ada kewajiban.</td></tr>}</tbody></table>
          <table><thead><tr><th colSpan={2}>Modal</th></tr></thead>
            <tbody>{data.equity.length?rows(data.equity):<tr><td className="muted" colSpan={2}>Belum ada modal tercatat.</td></tr>}</tbody></table>
          <footer><span>Total kewajiban & modal</span><strong>{money(data.total_liabilities+data.total_equity)}</strong></footer>
        </section>
      </div>
      <p className="fin-note">Sisi kiri adalah apa yang dimiliki venue, sisi kanan asal uangnya. Keduanya selalu sama besar.
        {data.advances>0 && ` Termasuk ${money(data.advances)} uang pelanggan untuk sesi yang belum dimainkan — itu kewajiban, bukan pendapatan.`}</p>
    </div>
  );
}

// --- Buku besar ------------------------------------------------------------

function LedgerReport({ setup, range }: { setup:Setup; range:Range }) {
  const [accountId,setAccountId] = useState(() => setup.accounts.find(account=>account.system_key==="kas")?.id ?? setup.accounts[0]?.id ?? "");
  const [data,setData] = useState<GeneralLedger|null>(null);
  useEffect(() => {
    if (!accountId) return;
    api<GeneralLedger>(`/operations/finance/reports/buku-besar?account_id=${accountId}&from=${range.from}&to=${range.to}`).then(setData).catch(error=>toast.error((error as Error).message));
  }, [accountId, range.from, range.to]);
  return (
    <div className="fin-report">
      <ReportHead title="Buku besar" subtitle={`Seluruh mutasi satu akun, ${rangeLabel(range.from,range.to)}`}
        build={()=>data&&{
          title:"Buku Besar", filename:`buku-besar-${data.account.code}-${range.from}-sd-${range.to}`, landscape:true,
          meta:[["Akun",`${data.account.code} ${data.account.name}`],["Periode",rangeLabel(range.from,range.to)]],
          columns:[{header:"Tanggal",kind:"date"},{header:"Nomor",width:16},{header:"Keterangan",width:42},{header:"Lawan akun",width:26},
            {header:"Debit",kind:"money"},{header:"Kredit",kind:"money"},{header:"Saldo",kind:"money"}],
          rows:[
            row.subtotal("","","Saldo awal","",null,null,data.opening),
            ...data.rows.map(item=>row.line(item.date,item.number,item.line_memo||item.memo,item.counter,item.debit||null,item.credit||null,item.balance)),
            row.total("","","Saldo akhir","",data.debit,data.credit,data.closing),
          ],
          notes:data.truncated?[`Rincian dipotong pada ${data.rows.length.toLocaleString("id-ID")} baris pertama; total debit, kredit, dan saldo akhir tetap menghitung seluruh mutasi. Persempit periode untuk rincian lengkap.`]:[],
        }}/>
      <label className="fin-inline-field wide"><span>Akun</span>
        <Select value={accountId} onChange={e=>setAccountId(e.target.value)}>
          {setup.accounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
        </Select>
      </label>
      {!data ? <p className="empty-state">Memuat buku besar…</p> : (
        <>
          <div className="fin-result">
            <div><span>Saldo awal<InfoTip text="Saldo akun sebelum tanggal awal periode."/></span><strong>{money(data.opening)}</strong></div>
            <div><span>Debit<InfoTip text="Untuk akun harta dan biaya, debit menambah saldo. Untuk akun kewajiban, modal, dan pendapatan, debit mengurangi saldo."/></span><strong className="plus">{money(data.debit)}</strong></div>
            <div><span>Kredit</span><strong className="minus">{money(data.credit)}</strong></div>
            <div className="fin-result-net"><span>Saldo akhir</span><strong>{money(data.closing)}</strong></div>
          </div>
          <div className="manage-table-card ops-table table-cards">
            <table>
              <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Lawan akun<InfoTip text="Akun pasangan dalam jurnal yang sama, mis. Kas untuk penjualan tunai."/></th><th className="right">Debit</th><th className="right">Kredit</th><th className="right">Saldo</th></tr></thead>
              <tbody>{data.rows.map((row,index) => (
                <tr key={`${row.entry_id}-${index}`}>
                  <td data-label="Tanggal">{formatDate(row.date)}<small className="table-description">{row.number}</small></td>
                  <td className="wide" data-label="Keterangan"><b>{row.line_memo||row.memo}</b><small className="table-description">{sourceLabel[row.source]}</small></td>
                  <td data-label="Lawan akun">{row.counter}</td>
                  <td className="right" data-label="Debit">{row.debit?money(row.debit):"—"}</td>
                  <td className="right" data-label="Kredit">{row.credit?money(row.credit):"—"}</td>
                  <td className="right" data-label="Saldo"><b className={row.balance<0?"minus":""}>{money(row.balance)}</b></td>
                </tr>
              ))}</tbody>
            </table>
            {!data.rows.length && <Empty title="Tidak ada mutasi" text="Akun ini belum dipakai pada rentang tanggal yang dipilih."/>}
          </div>
          {data.truncated && <p className="fin-note">Rincian dipotong pada {data.rows.length.toLocaleString("id-ID")} baris pertama. Debit, kredit, dan saldo akhir di atas tetap menghitung seluruh mutasi; persempit periode untuk melihat sisanya.</p>}
        </>
      )}
    </div>
  );
}

// --- Buku besar pembantu ---------------------------------------------------

const subsidiaryViews: [SubsidiaryLedger["kind"],string,string][] = [
  ["piutang","Piutang pelanggan","Sisa tagihan tiap pelanggan dari booking yang sudah berjalan."],
  ["utang","Utang pemasok","Tagihan pemasok yang belum dibayar, per pihak."],
  ["kas","Kas & bank","Saldo dan mutasi tiap tempat penyimpanan uang."],
];
function SubsidiaryReport({ range }: { range:Range }) {
  const [kind,setKind] = useState<SubsidiaryLedger["kind"]>("piutang");
  const [data,setData] = useState<SubsidiaryLedger|null>(null);
  const [open,setOpen] = useState<string>("");
  useEffect(() => {
    setData(null);
    api<SubsidiaryLedger>(`/operations/finance/reports/pembantu?kind=${kind}&from=${range.from}&to=${range.to}`).then(setData).catch(error=>toast.error((error as Error).message));
  }, [kind, range.from, range.to]);
  const meta = subsidiaryViews.find(view => view[0]===kind)!;
  return (
    <div className="fin-report">
      <ReportHead title="Buku besar pembantu" subtitle={`${meta[1]} · ${rangeLabel(range.from,range.to)}`}
        build={()=>data&&{
          title:`Buku Besar Pembantu ${meta[1]}`, filename:`buku-pembantu-${kind}-${range.from}-sd-${range.to}`, landscape:true,
          meta:[["Jenis",meta[1]],["Periode",rangeLabel(range.from,range.to)]],
          columns:[{header:"Nama",width:28},{header:"Keterangan",width:34},{header:"Saldo awal",kind:"money"},{header:"Debit",kind:"money"},{header:"Kredit",kind:"money"},{header:"Saldo akhir",kind:"money"}],
          rows:[
            ...data.rows.map(item=>row.line(item.name,item.subtitle,item.opening,item.debit||null,item.credit||null,item.balance)),
            row.total("Total","",data.rows.reduce((sum,item)=>sum+item.opening,0),data.rows.reduce((sum,item)=>sum+item.debit,0),data.rows.reduce((sum,item)=>sum+item.credit,0),data.total),
          ],
          notes:[meta[2]],
        }}/>
      <div className="fin-chips" role="group" aria-label="Jenis buku pembantu">
        {subsidiaryViews.map(([key,label]) => <button key={key} type="button" aria-pressed={kind===key} onClick={()=>setKind(key)}>{label}</button>)}
      </div>
      <p className="fin-note">{meta[2]}</p>
      {!data ? <p className="empty-state">Memuat rincian…</p> : !data.rows.length ? (
        <Empty title="Belum ada rincian" text="Buku pembantu terisi sendiri begitu ada tagihan, pembayaran, atau mutasi kas pada periode ini."/>
      ) : (
        <div className="manage-table-card ops-table table-cards">
          <table>
            <thead><tr><th>Nama</th><th className="right">Saldo awal</th><th className="right">Debit</th><th className="right">Kredit</th><th className="right">Saldo akhir</th><th/></tr></thead>
            <tbody>{data.rows.map(row => (
              <tr key={row.key} className={open===row.key?"open":""}>
                <td className="wide" data-label="Nama">
                  <b>{row.name}</b>{row.subtitle && <small className="table-description">{row.subtitle}</small>}
                  {open===row.key && row.detail.length>0 && (
                    <ul className="fin-subdetail">{row.detail.map((item,index)=><li key={index}><span>{item.label}</span><b>{money(item.amount)}</b></li>)}</ul>
                  )}
                </td>
                <td className="right" data-label="Saldo awal">{money(row.opening)}</td>
                <td className="right" data-label="Debit">{row.debit?money(row.debit):"—"}</td>
                <td className="right" data-label="Kredit">{row.credit?money(row.credit):"—"}</td>
                <td className="right" data-label="Saldo akhir"><b className={row.balance<0?"minus":""}>{money(row.balance)}</b></td>
                <td className="actions">{row.detail.length>0 && (
                  <button type="button" className="ops-secondary" onClick={()=>setOpen(open===row.key?"":row.key)}>{open===row.key?"Tutup":"Rincian"}</button>
                )}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td><b>Total</b></td><td colSpan={3}/><td className="right"><b>{money(data.total)}</b></td><td/></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Jurnal umum -----------------------------------------------------------

export function JournalReport({ setup, range, today, onChanged }: { setup:Setup; range:Range; today:string; onChanged:()=>void }) {
  const [entries,setEntries] = useState<JournalEntry[]|null>(null);
  const [total,setTotal] = useState(0);
  const [term,setTerm] = useState("");
  const [source,setSource] = useState("");
  const [editing,setEditing] = useState<JournalEntry|null>(null);
  const [creating,setCreating] = useState(false);
  const query = useCallback((limit:number) => {
    const params = new URLSearchParams({ from:range.from, to:range.to, q:term, limit:String(limit) });
    if (source) params.set("source", source);
    return `/operations/finance/journal?${params}`;
  }, [range.from, range.to, term, source]);
  const load = useCallback(async () => {
    try { const result = await api<{entries:JournalEntry[];total:number}>(query(200)); setEntries(result.entries); setTotal(result.total) }
    catch (error) { toast.error((error as Error).message) }
  }, [query]);
  /** File unduhan memuat seluruh jurnal periode ini, bukan hanya 200 yang tampil di layar. */
  async function buildExport():Promise<ReportDoc> {
    const { entries:all, total:count } = await api<{entries:JournalEntry[];total:number}>(query(10000));
    if (count>all.length) toast.warning(`Hanya ${all.length} dari ${count} jurnal yang terunduh. Persempit periodenya.`);
    const debit = all.reduce((sum,entry)=>sum+entry.lines.reduce((total,line)=>total+line.debit,0),0);
    const credit = all.reduce((sum,entry)=>sum+entry.lines.reduce((total,line)=>total+line.credit,0),0);
    const filters:[string,string][] = [];
    if (source) filters.push(["Sumber",sourceLabel[source as keyof typeof sourceLabel] ?? source]);
    if (term) filters.push(["Pencarian",term]);
    return {
      title:"Jurnal Umum", filename:`jurnal-${range.from}-sd-${range.to}`, landscape:true,
      meta:[["Periode",rangeLabel(range.from,range.to)],...filters,["Jumlah jurnal",all.length.toLocaleString("id-ID")]],
      columns:[{header:"Tanggal",kind:"date"},{header:"Nomor",width:16},{header:"Keterangan",width:40},{header:"Akun",width:32},{header:"Debit",kind:"money"},{header:"Kredit",kind:"money"}],
      rows:[
        ...[...all].reverse().flatMap(entry=>entry.lines.map((line,index)=>row.line(
          index===0?entry.date:"", index===0?entry.number:"", line.memo||entry.memo, `${line.account_code} ${line.account_name}`, line.debit||null, line.credit||null))),
        row.total("","","Total","",debit,credit),
      ],
    };
  }
  useEffect(() => { const timer=setTimeout(()=>void load(),term?250:0); return ()=>clearTimeout(timer) }, [load, term]);

  async function remove(entry:JournalEntry) {
    if (!confirm(`Hapus jurnal ${entry.number}?`)) return;
    try { await api(`/operations/finance/journal/${entry.id}`,{method:"DELETE"}); toast.success("Jurnal dihapus"); void load(); onChanged() }
    catch (error) { toast.error((error as Error).message) }
  }
  return (
    <div className="fin-report">
      <ReportHead title="Jurnal umum" subtitle={`Semua pencatatan, ${rangeLabel(range.from,range.to)}`}
        build={buildExport}/>
      <div className="fin-toolbar">
        <label className="fin-search"><Search size={15} aria-hidden="true"/>
          <input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Cari keterangan atau nomor jurnal…" aria-label="Cari jurnal"/>
        </label>
        <label className="fin-inline-field"><span>Sumber<InfoTip text="Asal jurnal: manual dicatat staf, lainnya dibuat otomatis dari booking, kasir, pembayaran, member, persediaan, atau penyusutan."/></span>
          <Select value={source} onChange={e=>setSource(e.target.value)}>
            <option value="">Semua sumber</option>
            {Object.entries(sourceLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
          </Select>
        </label>
        <div className="fin-toolbar-actions">
          <button type="button" className="ops-primary" onClick={()=>setCreating(true)} data-tip="Untuk pencatatan yang tidak punya formulir sendiri, mis. koreksi saldo awal. Total debit harus sama dengan kredit."><Plus size={14}/> Jurnal manual</button>
        </div>
      </div>
      {!entries ? <p className="empty-state">Memuat jurnal…</p> : !entries.length ? (
        <Empty title="Belum ada jurnal" text="Jurnal terbentuk sendiri dari booking, pembayaran, dan catatan keuangan."/>
      ) : (
        <ul className="fin-journal">{entries.map(entry => {
          const debit = entry.lines.reduce((sum,line)=>sum+line.debit,0);
          return (
            <li key={entry.id}>
              <header>
                <div><b>{entry.memo}</b><small>{entry.number} · {formatDate(entry.date)} · {sourceLabel[entry.source]}</small></div>
                <div className="fin-journal-actions">
                  <strong>{money(debit)}</strong>
                  {entry.source==="manual" && (
                    <>
                      <button type="button" onClick={()=>setEditing(entry)} aria-label={`Ubah ${entry.number}`} data-tip="Ubah"><Pencil size={15}/></button>
                      <button type="button" className="delete" onClick={()=>void remove(entry)} aria-label={`Hapus ${entry.number}`} data-tip="Hapus"><Trash2 size={15}/></button>
                    </>
                  )}
                </div>
              </header>
              <table><tbody>{entry.lines.map(line => (
                <tr key={line.id}>
                  <td>{line.account_code} — {line.account_name}{line.memo && <small> · {line.memo}</small>}{line.partner_name && <small> · {line.partner_name}</small>}</td>
                  <td className="right">{line.debit?money(line.debit):""}</td>
                  <td className="right">{line.credit?money(line.credit):""}</td>
                </tr>
              ))}</tbody></table>
            </li>
          );
        })}</ul>
      )}
      {entries && total>entries.length && <p className="fin-note">Menampilkan {entries.length} jurnal terbaru dari {total}. Unduh Excel, PDF, atau CSV untuk daftar lengkapnya.</p>}
      {(creating||editing) && (
        <JournalForm setup={setup} today={today} entry={editing} close={()=>{setCreating(false);setEditing(null)}}
          saved={()=>{setCreating(false);setEditing(null);void load();onChanged()}}/>
      )}
    </div>
  );
}

type FormLine = { account_id:string; debit:number; credit:number; memo:string; partner_id:string|null };
function JournalForm({ setup, today, entry, close, saved }: { setup:Setup; today:string; entry?:JournalEntry|null; close:()=>void; saved:()=>void }) {
  const [date,setDate] = useState(entry?.date ?? today);
  const [memo,setMemo] = useState(entry?.memo ?? "");
  const [lines,setLines] = useState<FormLine[]>(() => entry
    ? entry.lines.map(line => ({ account_id:line.account_id, debit:line.debit, credit:line.credit, memo:line.memo, partner_id:line.partner_id }))
    : [{ account_id:"", debit:0, credit:0, memo:"", partner_id:null },{ account_id:"", debit:0, credit:0, memo:"", partner_id:null }]);
  const [saving,setSaving] = useState(false);
  const debit = lines.reduce((sum,line)=>sum+line.debit,0);
  const credit = lines.reduce((sum,line)=>sum+line.credit,0);
  const balanced = debit>0 && debit===credit;
  const update = (index:number, patch:Partial<FormLine>) => setLines(current => current.map((line,position) => position===index ? { ...line, ...patch } : line));
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (!balanced) return toast.error("Total debit dan kredit harus sama");
    // Baris bernominal tanpa akun dulu dibuang diam-diam, sehingga yang tersimpan berbeda dari yang diketik.
    if (lines.some(line => !line.account_id && (line.debit || line.credit))) return toast.error("Pilih akun untuk setiap baris yang berisi nominal");
    setSaving(true);
    try {
      await api(`/operations/finance/journal${entry?`/${entry.id}`:""}`,{ method: entry?"PUT":"POST", body: JSON.stringify({ date, memo, lines: lines.filter(line=>line.account_id && (line.debit||line.credit)) }) });
      toast.success(entry?"Jurnal diperbarui":"Jurnal tersimpan"); saved();
    } catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <Modal title={entry?`Ubah ${entry.number}`:"Jurnal manual"} close={close}>
      <form className="fin-form" onSubmit={submit}>
        <p className="fin-note">Untuk pencatatan yang tidak punya formulir sendiri, misalnya penyusutan peralatan atau koreksi saldo awal.</p>
        <div className="fin-form-grid">
          <label className="fin-field"><span className="fin-label">Tanggal</span><DateInput value={date} onChange={e=>e.target.value&&setDate(e.target.value)} required/></label>
          <label className="fin-field"><span className="fin-label">Keterangan</span><input value={memo} minLength={3} maxLength={200} required placeholder="Mis. Penyusutan peralatan Agustus" onChange={e=>setMemo(e.target.value)}/></label>
        </div>
        <div className="fin-lines">
          {lines.map((line,index) => (
            <div className="fin-line" key={index}>
              <Select value={line.account_id} onChange={e=>update(index,{account_id:e.target.value})} aria-label={`Akun baris ${index+1}`}>
                <option value="">Pilih akun…</option>
                {setup.accounts.filter(account=>account.active||account.id===line.account_id).map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
              </Select>
              <AmountField label="Debit" value={line.debit} onChange={value=>update(index,{debit:value,credit:value?0:line.credit})}/>
              <AmountField label="Kredit" value={line.credit} onChange={value=>update(index,{credit:value,debit:value?0:line.debit})}/>
              <button type="button" className="ops-danger" disabled={lines.length<=2} aria-label={`Hapus baris ${index+1}`} data-tip={`Hapus baris ${index+1}`}
                onClick={()=>setLines(current=>current.filter((_,position)=>position!==index))}><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
        <div className="fin-lines-foot">
          <button type="button" className="ops-secondary" disabled={lines.length>=20} onClick={()=>setLines(current=>[...current,{account_id:"",debit:0,credit:0,memo:"",partner_id:null}])}><Plus size={14}/> Tambah baris</button>
          <span className={balanced?"fin-tag ok":"fin-tag warn"}>
            {balanced ? <><Check size={13}/> Seimbang</> : <><Scale size={13}/> Debit {money(debit)} · Kredit {money(credit)}</>}
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={close}>Batal</button>
          <button className="ops-primary" type="submit" disabled={saving||!balanced}>{saving?"Menyimpan…":"Simpan jurnal"}</button>
        </div>
      </form>
    </Modal>
  );
}
