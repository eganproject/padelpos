"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Landmark, Lock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  type Overview, type RecordKind, type Setup,
  changeOf, formatDate, formatMonth, money, moneyShort, presetRange, rangeLabel, sourceLabel,
} from "@/lib/finance";
import { ErrorBox } from "./operation-ui";
import { Empty, PeriodPicker, ShareBar, StatCard } from "./finance-ui";
import { EquityForm, RecordForm, RecordsTab, TransferForm } from "./finance-records";
import { ReportsTab } from "./finance-reports";
import { SetupTab } from "./finance-setup";

type Tab = "ringkasan" | "catatan" | "laporan" | "pengaturan";
const tabs: [Tab,string][] = [["ringkasan","Ringkasan"],["catatan","Catatan"],["laporan","Laporan"],["pengaturan","Pengaturan"]];

export function FinancePanel() {
  const [setup,setSetup] = useState<Setup|null>(null);
  const [error,setError] = useState("");
  const [tab,setTab] = useState<Tab>("ringkasan");
  const [range,setRange] = useState({ from:"", to:"" });
  const [stamp,setStamp] = useState(0);

  const loadSetup = useCallback(async () => {
    try {
      const result = await api<Setup>("/operations/finance/setup");
      setSetup(result); setError("");
      setRange(current => current.from ? current : presetRange("bulan-ini", result.date));
    } catch (caught) { setError((caught as Error).message) }
  }, []);
  useEffect(() => { void loadSetup() }, [loadSetup]);

  if (error && !setup) return <ErrorBox message={error} retry={loadSetup}/>;
  if (!setup || !range.from) return <p className="empty-state">Memuat pembukuan…</p>;
  const changed = () => setStamp(value => value+1);
  return (
    <div className="fin">
      <div className="fin-tabs" role="tablist" aria-label="Bagian keuangan">
        {tabs.map(([key,label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}</button>
        ))}
        {setup.settings.locked_until && (
          <span className="fin-locked" title={`Catatan sampai ${formatDate(setup.settings.locked_until)} dibekukan`}>
            <Lock size={13}/> Terkunci s.d. {formatDate(setup.settings.locked_until)}
          </span>
        )}
      </div>
      {tab==="ringkasan" && <OverviewTab setup={setup} range={range} onRange={setRange} stamp={stamp} onChanged={changed}/>}
      {tab==="catatan" && <RecordsTab setup={setup} range={range} today={setup.date} onChanged={changed}/>}
      {tab==="laporan" && <ReportsTab setup={setup} range={range} today={setup.date} onRange={setRange} onChanged={changed}/>}
      {tab==="pengaturan" && <SetupTab setup={setup} reload={()=>{void loadSetup();changed()}}/>}
    </div>
  );
}

function OverviewTab({ setup, range, onRange, stamp, onChanged }: { setup:Setup; range:{from:string;to:string}; onRange:(range:{from:string;to:string})=>void; stamp:number; onChanged:()=>void }) {
  const [data,setData] = useState<Overview|null>(null);
  const [busy,setBusy] = useState(false);
  const [form,setForm] = useState<RecordKind|"transfer"|"modal"|null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api<Overview>(`/operations/finance/overview?from=${range.from}&to=${range.to}`)) }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }, [range.from, range.to]);
  useEffect(() => { void load() }, [load, stamp]);

  if (!data) return <p className="empty-state">Menghitung ringkasan…</p>;
  const netChange = changeOf(data.net, data.previous.net);
  const expenseChange = changeOf(data.expense, data.previous.expense);
  const incomeChange = changeOf(data.income, data.previous.income);
  const peak = Math.max(1, ...data.series.flatMap(month => [month.income, month.expense]));
  const expenseMax = Math.max(1, ...data.expense_lines.map(line => line.amount));
  const incomeMax = Math.max(1, ...data.income_lines.map(line => line.amount));
  const chip = (value:number|null, invert=false) => value===null ? null : (
    <em className={(invert ? value<=0 : value>=0) ? "plus" : "minus"}>{value>=0?"▲":"▼"} {Math.abs(value)}%</em>
  );

  return (
    <div className="fin-overview">
      <div className="fin-head">
        <PeriodPicker from={range.from} to={range.to} today={setup.date} onChange={onRange}/>
        <button type="button" className="ops-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={14}/> Muat ulang</button>
      </div>

      <div className="fin-stats">
        <StatCard label="Uang di kas & bank" value={money(data.cash_total)} tone="cash"
          hint={data.cash.map(account => `${account.name} ${moneyShort(account.balance)}`).join(" · ")}/>
        <StatCard label="Pemasukan" value={money(data.income)} tone="plus" change={chip(incomeChange)} hint={rangeLabel(range.from,range.to)}/>
        <StatCard label="Pengeluaran" value={money(data.expense)} tone="minus" change={chip(expenseChange,true)} hint={rangeLabel(range.from,range.to)}/>
        <StatCard label={data.net>=0?"Laba bersih":"Rugi bersih"} value={money(data.net)} tone={data.net>=0?"plus":"minus"}
          change={chip(netChange)} hint="Pemasukan dikurangi pengeluaran"/>
      </div>

      <div className="fin-quick">
        <button type="button" className="ops-primary" onClick={()=>setForm("pengeluaran")}><Plus size={14}/> Catat pengeluaran</button>
        <button type="button" className="ops-secondary" onClick={()=>setForm("pemasukan")}><Plus size={14}/> Catat pemasukan</button>
        <button type="button" className="ops-secondary" onClick={()=>setForm("transfer")}><ArrowLeftRight size={14}/> Pindah dana</button>
        <button type="button" className="ops-secondary" onClick={()=>setForm("modal")}><Landmark size={14}/> Modal pemilik</button>
      </div>

      <div className="fin-grid">
        <section className="fin-card">
          <header><h3>Enam bulan terakhir</h3><p>Batang hijau pemasukan, batang jingga pengeluaran.</p></header>
          <div className="fin-chart">
            {data.series.map(month => {
              const quiet = month.income===0 && month.expense===0;
              const bar = (value:number) => (value>0 ? `${Math.max(4, value/peak*100)}%` : "0");
              return (
                <div className="fin-chart-col" key={month.month}>
                  <div className="fin-bars">
                    <i className="plus" style={{height:bar(month.income)}} title={`Pemasukan ${money(month.income)}`}/>
                    <i className="minus" style={{height:bar(month.expense)}} title={`Pengeluaran ${money(month.expense)}`}/>
                  </div>
                  <span>{formatMonth(month.month)}</span>
                  <small className={quiet?"muted":month.income-month.expense>=0?"plus":"minus"}>{quiet?"—":moneyShort(month.income-month.expense)}</small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="fin-card">
          <header><h3>Perlu perhatian</h3><p>Uang yang masih beredar di luar kas.</p></header>
          <ul className="fin-attention">
            <li><span>Piutang pelanggan</span><b>{money(data.receivable)}</b><small>Sesi yang sudah main tapi belum lunas.</small></li>
            <li><span>Uang muka pelanggan</span><b>{money(data.advances)}</b><small>Sudah dibayar untuk sesi yang belum main.</small></li>
            <li><span>Utang pemasok</span><b>{money(data.payable)}</b><small>Pembelian yang belum dibayar.</small></li>
          </ul>
          {data.due.length>0 && (
            <>
              <h4 className="fin-subhead">Tagihan menunggu</h4>
              <ul className="fin-due">{data.due.map(item => (
                <li key={item.id}>
                  <div><b>{item.partner_name||item.account_name}</b><small>{item.number} · jatuh tempo {formatDate(item.due_date||item.date)}</small></div>
                  <strong className={item.kind==="pengeluaran"?"minus":"plus"}>{money(item.amount)}</strong>
                </li>
              ))}</ul>
            </>
          )}
        </section>

        <section className="fin-card">
          <header><h3>Ke mana uang pergi</h3><p>Biaya terbesar pada periode ini.</p></header>
          {data.expense_lines.length ? (
            <ul className="fin-breakdown">{data.expense_lines.map(line => (
              <li key={line.id}><span title={line.name}>{line.name}</span><ShareBar value={line.amount} max={expenseMax} tone="minus"/><b>{money(line.amount)}</b></li>
            ))}</ul>
          ) : <Empty title="Belum ada pengeluaran" text="Catat pengeluaran pertama lewat tombol di atas."/>}
        </section>

        <section className="fin-card">
          <header><h3>Dari mana uang datang</h3><p>Sumber pendapatan pada periode ini.</p></header>
          {data.income_lines.length ? (
            <ul className="fin-breakdown">{data.income_lines.map(line => (
              <li key={line.id}><span title={line.name}>{line.name}</span><ShareBar value={line.amount} max={incomeMax} tone="plus"/><b>{money(line.amount)}</b></li>
            ))}</ul>
          ) : <Empty title="Belum ada pendapatan" text="Pendapatan booking muncul sendiri pada tanggal sesi bermain."/>}
        </section>
      </div>

      <section className="fin-card">
        <header><h3>Pencatatan terbaru</h3><p>Termasuk jurnal yang dibuat otomatis dari booking dan pembayaran.</p></header>
        <div className="manage-table-card ops-table table-cards">
          <table>
            <thead><tr><th>TANGGAL</th><th>KETERANGAN</th><th>SUMBER</th><th className="right">NILAI</th></tr></thead>
            <tbody>{data.entries.map(entry => (
              <tr key={entry.id}>
                <td data-label="Tanggal">{formatDate(entry.date)}<small className="table-description">{entry.number}</small></td>
                <td className="wide" data-label="Keterangan"><b>{entry.memo}</b>
                  <small className="table-description">{entry.lines.map(line => line.account_name).join(" · ")}</small>
                </td>
                <td data-label="Sumber">{sourceLabel[entry.source]}</td>
                <td className="right" data-label="Nilai">{money(entry.lines.reduce((sum,line)=>sum+line.debit,0))}</td>
              </tr>
            ))}</tbody>
          </table>
          {!data.entries.length && <Empty title="Belum ada pencatatan" text={`Belum ada jurnal antara ${formatDate(range.from)} dan ${formatDate(range.to)}.`}/>}
        </div>
      </section>

      {(form==="pengeluaran"||form==="pemasukan") && (
        <RecordForm setup={setup} today={setup.date} kind={form} close={()=>setForm(null)} saved={()=>{setForm(null);onChanged()}}/>
      )}
      {form==="transfer" && <TransferForm setup={setup} today={setup.date} close={()=>setForm(null)} saved={()=>{setForm(null);onChanged()}}/>}
      {form==="modal" && <EquityForm setup={setup} today={setup.date} close={()=>setForm(null)} saved={()=>{setForm(null);onChanged()}}/>}
    </div>
  );
}
