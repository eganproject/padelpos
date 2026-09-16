"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Pencil, Plus, Printer, Scale, Search, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  type BalanceSheet, type GeneralLedger, type JournalEntry, type ProfitLoss, type Setup, type SubsidiaryLedger,
  changeOf, downloadCsv, formatDate, money, rangeLabel, sourceLabel,
} from "@/lib/finance";
import { Modal } from "./operation-ui";
import { AmountField, Empty, PeriodPicker, ShareBar } from "./finance-ui";

type Range = { from:string; to:string };
export type ReportView = "laba-rugi" | "neraca" | "buku-besar" | "pembantu" | "jurnal";
const views: [ReportView,string][] = [["laba-rugi","Laba rugi"],["neraca","Neraca"],["buku-besar","Buku besar"],["pembantu","Buku besar pembantu"],["jurnal","Jurnal umum"]];

export function ReportsTab({ setup, range, today, onRange, onChanged }: { setup:Setup; range:Range; today:string; onRange:(range:Range)=>void; onChanged:()=>void }) {
  const [view,setView] = useState<ReportView>("laba-rugi");
  return (
    <div className="fin-reports">
      <div className="fin-subtabs" role="tablist" aria-label="Jenis laporan">
        {views.map(([key,label]) => (
          <button key={key} type="button" role="tab" aria-selected={view===key} onClick={()=>setView(key)}>{label}</button>
        ))}
      </div>
      {view!=="neraca" && <PeriodPicker from={range.from} to={range.to} today={today} onChange={onRange}/>}
      {view==="laba-rugi" && <ProfitLossReport range={range}/>}
      {view==="neraca" && <BalanceReport today={today}/>}
      {view==="buku-besar" && <LedgerReport setup={setup} range={range}/>}
      {view==="pembantu" && <SubsidiaryReport range={range}/>}
      {view==="jurnal" && <JournalReport setup={setup} range={range} today={today} onChanged={onChanged}/>}
    </div>
  );
}

function ReportHead({ title, subtitle, onCsv }: { title:string; subtitle:string; onCsv:()=>void }) {
  return (
    <div className="fin-report-head">
      <div><h3>{title}</h3><p>{subtitle}</p></div>
      <div className="fin-report-actions">
        <button type="button" className="ops-secondary" onClick={onCsv}><Download size={14}/> Unduh CSV</button>
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
        onCsv={()=>downloadCsv(`laba-rugi-${range.from}-sd-${range.to}.csv`,[
          ["Laporan Laba Rugi"],["Periode",range.from,range.to],[],
          ["Kode","Akun","Jenis","Periode ini","Periode sebelumnya"],
          ...data.income_lines.map(line=>[line.code,line.name,"Pendapatan",line.amount,line.previous??0]),
          ["","Total pendapatan","",data.income,data.previous.income],[],
          ...data.expense_lines.map(line=>[line.code,line.name,"Biaya",line.amount,line.previous??0]),
          ["","Total biaya","",data.expense,data.previous.expense],[],
          ["","Laba bersih","",data.net,data.previous.net],
        ])}/>
      <div className="fin-result">
        <div><span>Pendapatan</span><strong className="plus">{money(data.income)}</strong></div>
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
      <label className="fin-inline-field"><span>Posisi tanggal</span><input type="date" value={asOf} onChange={e=>e.target.value&&setAsOf(e.target.value)}/></label>
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
        onCsv={()=>downloadCsv(`neraca-${asOf}.csv`,[
          ["Neraca"],["Per tanggal",asOf],[],["Kode","Pos","Kelompok","Jumlah"],
          ...data.assets.map(line=>[line.code,line.name,"Harta",line.amount]),
          ["","Total harta","",data.total_assets],[],
          ...data.liabilities.map(line=>[line.code,line.name,"Kewajiban",line.amount]),
          ["","Total kewajiban","",data.total_liabilities],[],
          ...data.equity.map(line=>[line.code,line.name,"Modal",line.amount]),
          ["","Total modal","",data.total_equity],
        ])}/>
      <div className="fin-balance-toolbar">
        <label className="fin-inline-field"><span>Posisi tanggal</span><input type="date" value={asOf} onChange={e=>e.target.value&&setAsOf(e.target.value)}/></label>
        <span className={`fin-tag ${data.difference===0?"ok":"warn"}`}>
          {data.difference===0 ? <><Check size={13}/> Seimbang</> : <><TriangleAlert size={13}/> Selisih {money(data.difference)}</>}
        </span>
      </div>
      <div className="fin-sheet-grid">
        <section className="fin-sheet">
          <header><h4>Harta</h4><span>{money(data.total_assets)}</span></header>
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
          <header><h4>Kewajiban & modal</h4><span>{money(data.total_liabilities+data.total_equity)}</span></header>
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
        onCsv={()=>data&&downloadCsv(`buku-besar-${data.account.code}-${range.from}-sd-${range.to}.csv`,[
          ["Buku Besar"],["Akun",`${data.account.code} ${data.account.name}`],["Periode",range.from,range.to],[],
          ["Tanggal","Nomor","Keterangan","Lawan akun","Debit","Kredit","Saldo"],
          ["","","Saldo awal","","","",data.opening],
          ...data.rows.map(row=>[row.date,row.number,row.line_memo||row.memo,row.counter,row.debit,row.credit,row.balance]),
          ["","","Saldo akhir","",data.debit,data.credit,data.closing],
        ])}/>
      <label className="fin-inline-field wide"><span>Akun</span>
        <select value={accountId} onChange={e=>setAccountId(e.target.value)}>
          {setup.accounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
        </select>
      </label>
      {!data ? <p className="empty-state">Memuat buku besar…</p> : (
        <>
          <div className="fin-result">
            <div><span>Saldo awal</span><strong>{money(data.opening)}</strong></div>
            <div><span>Debit</span><strong className="plus">{money(data.debit)}</strong></div>
            <div><span>Kredit</span><strong className="minus">{money(data.credit)}</strong></div>
            <div className="fin-result-net"><span>Saldo akhir</span><strong>{money(data.closing)}</strong></div>
          </div>
          <div className="manage-table-card ops-table table-cards">
            <table>
              <thead><tr><th>TANGGAL</th><th>KETERANGAN</th><th>LAWAN AKUN</th><th className="right">DEBIT</th><th className="right">KREDIT</th><th className="right">SALDO</th></tr></thead>
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
        onCsv={()=>data&&downloadCsv(`buku-pembantu-${kind}-${range.from}-sd-${range.to}.csv`,[
          ["Buku Besar Pembantu"],["Jenis",meta[1]],["Periode",range.from,range.to],[],
          ["Nama","Keterangan","Saldo awal","Debit","Kredit","Saldo akhir"],
          ...data.rows.map(row=>[row.name,row.subtitle,row.opening,row.debit,row.credit,row.balance]),
          ["","Total","","","",data.total],
        ])}/>
      <div className="fin-chips" role="group" aria-label="Jenis buku pembantu">
        {subsidiaryViews.map(([key,label]) => <button key={key} type="button" aria-pressed={kind===key} onClick={()=>setKind(key)}>{label}</button>)}
      </div>
      <p className="fin-note">{meta[2]}</p>
      {!data ? <p className="empty-state">Memuat rincian…</p> : !data.rows.length ? (
        <Empty title="Belum ada rincian" text="Buku pembantu terisi sendiri begitu ada tagihan, pembayaran, atau mutasi kas pada periode ini."/>
      ) : (
        <div className="manage-table-card ops-table table-cards">
          <table>
            <thead><tr><th>NAMA</th><th className="right">SALDO AWAL</th><th className="right">DEBIT</th><th className="right">KREDIT</th><th className="right">SALDO AKHIR</th><th/></tr></thead>
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

function JournalReport({ setup, range, today, onChanged }: { setup:Setup; range:Range; today:string; onChanged:()=>void }) {
  const [entries,setEntries] = useState<JournalEntry[]|null>(null);
  const [term,setTerm] = useState("");
  const [source,setSource] = useState("");
  const [editing,setEditing] = useState<JournalEntry|null>(null);
  const [creating,setCreating] = useState(false);
  const load = useCallback(async () => {
    const query = new URLSearchParams({ from:range.from, to:range.to, q:term });
    if (source) query.set("source", source);
    try { setEntries((await api<{entries:JournalEntry[]}>(`/operations/finance/journal?${query}`)).entries) }
    catch (error) { toast.error((error as Error).message) }
  }, [range.from, range.to, term, source]);
  useEffect(() => { const timer=setTimeout(()=>void load(),term?250:0); return ()=>clearTimeout(timer) }, [load, term]);

  async function remove(entry:JournalEntry) {
    if (!confirm(`Hapus jurnal ${entry.number}?`)) return;
    try { await api(`/operations/finance/journal/${entry.id}`,{method:"DELETE"}); toast.success("Jurnal dihapus"); void load(); onChanged() }
    catch (error) { toast.error((error as Error).message) }
  }
  return (
    <div className="fin-report">
      <ReportHead title="Jurnal umum" subtitle={`Semua pencatatan, ${rangeLabel(range.from,range.to)}`}
        onCsv={()=>entries&&downloadCsv(`jurnal-${range.from}-sd-${range.to}.csv`,[
          ["Jurnal Umum"],["Periode",range.from,range.to],[],["Tanggal","Nomor","Keterangan","Akun","Debit","Kredit"],
          ...entries.flatMap(entry=>entry.lines.map(line=>[entry.date,entry.number,line.memo||entry.memo,`${line.account_code} ${line.account_name}`,line.debit,line.credit])),
        ])}/>
      <div className="fin-toolbar">
        <label className="fin-search"><Search size={15} aria-hidden="true"/>
          <input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Cari keterangan atau nomor jurnal…" aria-label="Cari jurnal"/>
        </label>
        <label className="fin-inline-field"><span>Sumber</span>
          <select value={source} onChange={e=>setSource(e.target.value)}>
            <option value="">Semua sumber</option>
            {Object.entries(sourceLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <div className="fin-toolbar-actions">
          <button type="button" className="ops-primary" onClick={()=>setCreating(true)}><Plus size={14}/> Jurnal manual</button>
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
                      <button type="button" onClick={()=>setEditing(entry)} aria-label={`Ubah ${entry.number}`} title="Ubah"><Pencil size={15}/></button>
                      <button type="button" className="delete" onClick={()=>void remove(entry)} aria-label={`Hapus ${entry.number}`} title="Hapus"><Trash2 size={15}/></button>
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
      {(creating||editing) && (
        <JournalForm setup={setup} today={today} entry={editing} close={()=>{setCreating(false);setEditing(null)}}
          saved={()=>{setCreating(false);setEditing(null);void load();onChanged()}}/>
      )}
    </div>
  );
}

type FormLine = { account_id:string; debit:number; credit:number; memo:string };
function JournalForm({ setup, today, entry, close, saved }: { setup:Setup; today:string; entry?:JournalEntry|null; close:()=>void; saved:()=>void }) {
  const [date,setDate] = useState(entry?.date ?? today);
  const [memo,setMemo] = useState(entry?.memo ?? "");
  const [lines,setLines] = useState<FormLine[]>(() => entry
    ? entry.lines.map(line => ({ account_id:line.account_id, debit:line.debit, credit:line.credit, memo:line.memo }))
    : [{ account_id:"", debit:0, credit:0, memo:"" },{ account_id:"", debit:0, credit:0, memo:"" }]);
  const [saving,setSaving] = useState(false);
  const debit = lines.reduce((sum,line)=>sum+line.debit,0);
  const credit = lines.reduce((sum,line)=>sum+line.credit,0);
  const balanced = debit>0 && debit===credit;
  const update = (index:number, patch:Partial<FormLine>) => setLines(current => current.map((line,position) => position===index ? { ...line, ...patch } : line));
  async function submit(event:React.FormEvent) {
    event.preventDefault();
    if (!balanced) return toast.error("Total debit dan kredit harus sama");
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
          <label className="fin-field"><span className="fin-label">Tanggal</span><input type="date" value={date} onChange={e=>e.target.value&&setDate(e.target.value)} required/></label>
          <label className="fin-field"><span className="fin-label">Keterangan</span><input value={memo} minLength={3} maxLength={200} required placeholder="Mis. Penyusutan peralatan Agustus" onChange={e=>setMemo(e.target.value)}/></label>
        </div>
        <div className="fin-lines">
          {lines.map((line,index) => (
            <div className="fin-line" key={index}>
              <select value={line.account_id} onChange={e=>update(index,{account_id:e.target.value})} aria-label={`Akun baris ${index+1}`}>
                <option value="">Pilih akun…</option>
                {setup.accounts.filter(account=>account.active).map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
              </select>
              <AmountField label="Debit" value={line.debit} onChange={value=>update(index,{debit:value,credit:value?0:line.credit})}/>
              <AmountField label="Kredit" value={line.credit} onChange={value=>update(index,{credit:value,debit:value?0:line.debit})}/>
              <button type="button" className="ops-danger" disabled={lines.length<=2} aria-label={`Hapus baris ${index+1}`}
                onClick={()=>setLines(current=>current.filter((_,position)=>position!==index))}><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
        <div className="fin-lines-foot">
          <button type="button" className="ops-secondary" disabled={lines.length>=20} onClick={()=>setLines(current=>[...current,{account_id:"",debit:0,credit:0,memo:""}])}><Plus size={14}/> Tambah baris</button>
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
