"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight, Landmark, Lock, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  type Overview, type Setup,
  changeOf, formatDate, formatMonth, money, moneyShort, presetRange, rangeLabel, sourceLabel,
} from "@/lib/finance";
import { ErrorBox } from "./operation-ui";
import { Empty, PeriodPicker, ShareBar, StatCard } from "./finance-ui";
import { RecordsTab, type RecordAction } from "./finance-records";
import { JournalReport, ReportsTab } from "./finance-reports";
import { SetupTab } from "./finance-setup";
import { useAdminNavigation } from "./admin-navigation";

type Range = { from:string; to:string };
const RANGE_KEY = "padelix_fin_range";

/**
 * Data bersama semua halaman Keuangan: daftar akun dan pengaturan, serta periode yang dipilih.
 * Periode disimpan selama tab browser terbuka, jadi pindah dari Ringkasan ke Laporan tetap
 * memakai bulan yang sama.
 */
function useFinance() {
  const [setup,setSetup] = useState<Setup|null>(null);
  const [error,setError] = useState("");
  const [range,setRangeState] = useState<Range>({ from:"", to:"" });
  const load = useCallback(async () => {
    try {
      const result = await api<Setup>("/operations/finance/setup");
      setSetup(result); setError("");
      setRangeState(current => {
        if (current.from) return current;
        try {
          const saved = JSON.parse(sessionStorage.getItem(RANGE_KEY) || "null") as Range|null;
          if (saved?.from && saved.to && saved.from<=saved.to) return saved;
        } catch { /* penyimpanan sesi tidak tersedia */ }
        return presetRange("bulan-ini", result.date);
      });
    } catch (caught) { setError((caught as Error).message) }
  }, []);
  useEffect(() => { void load() }, [load]);
  const setRange = useCallback((next:Range) => {
    setRangeState(next);
    try { sessionStorage.setItem(RANGE_KEY, JSON.stringify(next)) } catch { /* abaikan */ }
  }, []);
  return { setup, error, range, setRange, load };
}

function LockBadge({ setup }: { setup:Setup }) {
  if (!setup.settings.locked_until) return null;
  return (
    <span className="fin-locked" title={`Catatan sampai ${formatDate(setup.settings.locked_until)} dibekukan`}>
      <Lock size={13}/> Terkunci s.d. {formatDate(setup.settings.locked_until)}
    </span>
  );
}

/** Kerangka halaman: memuat data bersama, lalu menampilkan isinya. */
function FinancePage({ children }: { children:(context:ReturnType<typeof useFinance> & { setup:Setup })=>React.ReactNode }) {
  const finance = useFinance();
  if (finance.error && !finance.setup) return <ErrorBox message={finance.error} retry={finance.load}/>;
  if (!finance.setup || !finance.range.from) return <p className="empty-state">Memuat pembukuan…</p>;
  return <div className="fin">{children({ ...finance, setup:finance.setup })}</div>;
}

export function FinanceOverviewPanel() {
  const { menus } = useAdminNavigation();
  const allowed = (id:string) => menus.some(menu => menu.id===id);
  return (
    <FinancePage>{({ setup, range, setRange }) => (
      <OverviewTab setup={setup} range={range} onRange={setRange}
        canRecord={allowed("finance-records")} canJournal={allowed("finance-journal")} canReport={allowed("finance-reports")}/>
    )}</FinancePage>
  );
}

const actions: RecordAction[] = ["pengeluaran","pemasukan","transfer","modal"];
export function FinanceRecordsPanel() {
  /* Tombol pintas di Ringkasan membuka halaman ini dengan ?catat=… agar formnya langsung terbuka. */
  const params = useSearchParams();
  const router = useRouter();
  const asked = params.get("catat") as RecordAction|null;
  const [initial] = useState<RecordAction|null>(() => asked && actions.includes(asked) ? asked : null);
  useEffect(() => { if (asked) router.replace("/admin/keuangan/transaksi", { scroll:false }) }, [asked, router]);
  return (
    <FinancePage>{({ setup, range, setRange }) => (
      <>
        <div className="fin-head">
          <PeriodPicker from={range.from} to={range.to} today={setup.date} onChange={setRange}/>
          <LockBadge setup={setup}/>
        </div>
        <RecordsTab setup={setup} range={range} today={setup.date} initial={initial} onChanged={()=>{}}/>
      </>
    )}</FinancePage>
  );
}

export function FinanceJournalPanel() {
  return (
    <FinancePage>{({ setup, range, setRange }) => (
      <>
        <div className="fin-head">
          <PeriodPicker from={range.from} to={range.to} today={setup.date} onChange={setRange}/>
          <LockBadge setup={setup}/>
        </div>
        <JournalReport setup={setup} range={range} today={setup.date} onChanged={()=>{}}/>
      </>
    )}</FinancePage>
  );
}

export function FinanceReportsPanel() {
  return (
    <FinancePage>{({ setup, range, setRange }) => (
      <ReportsTab setup={setup} range={range} today={setup.date} onRange={setRange}/>
    )}</FinancePage>
  );
}

export function FinanceSettingsPanel() {
  return (
    <FinancePage>{({ setup, load }) => <SetupTab setup={setup} reload={()=>void load()}/>}</FinancePage>
  );
}

function OverviewTab({ setup, range, onRange, canRecord, canJournal, canReport }: { setup:Setup; range:Range; onRange:(range:Range)=>void; canRecord:boolean; canJournal:boolean; canReport:boolean }) {
  const [data,setData] = useState<Overview|null>(null);
  const [busy,setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await api<Overview>(`/operations/finance/overview?from=${range.from}&to=${range.to}`)) }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusy(false) }
  }, [range.from, range.to]);
  useEffect(() => { void load() }, [load]);

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
        <div className="fin-head-actions">
          <LockBadge setup={setup}/>
          <button type="button" className="ops-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={14}/> Muat ulang</button>
        </div>
      </div>

      <div className="fin-stats">
        <StatCard label="Uang di kas & bank" value={money(data.cash_total)} tone="cash"
          hint={data.cash.map(account => `${account.name} ${moneyShort(account.balance)}`).join(" · ")}/>
        <StatCard label="Pemasukan" value={money(data.income)} tone="plus" change={chip(incomeChange)} hint={rangeLabel(range.from,range.to)}/>
        <StatCard label="Pengeluaran" value={money(data.expense)} tone="minus" change={chip(expenseChange,true)} hint={rangeLabel(range.from,range.to)}/>
        <StatCard label={data.net>=0?"Laba bersih":"Rugi bersih"} value={money(data.net)} tone={data.net>=0?"plus":"minus"}
          change={chip(netChange)} hint="Pemasukan dikurangi pengeluaran"/>
      </div>

      {canRecord && (
        <div className="fin-quick">
          <Link className="ops-primary" href="/admin/keuangan/transaksi?catat=pengeluaran"><Plus size={14}/> Catat pengeluaran</Link>
          <Link className="ops-secondary" href="/admin/keuangan/transaksi?catat=pemasukan"><Plus size={14}/> Catat pemasukan</Link>
          <Link className="ops-secondary" href="/admin/keuangan/transaksi?catat=transfer"><ArrowLeftRight size={14}/> Pindah dana</Link>
          <Link className="ops-secondary" href="/admin/keuangan/transaksi?catat=modal"><Landmark size={14}/> Modal pemilik</Link>
        </div>
      )}

      <div className="fin-grid">
        <section className="fin-card">
          <header className="fin-card-head"><div><h3>Enam bulan terakhir</h3><p>Batang hijau pemasukan, batang jingga pengeluaran.</p></div>
          {canReport && <Link className="ops-link" href="/admin/keuangan/laporan">Lihat laporan <ArrowRight size={14}/></Link>}</header>
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
            {data.tax_payable!==0 && <li><span>Pajak belum disetor</span><b>{money(data.tax_payable)}</b><small>Setor lewat Catat pengeluaran dengan kategori Utang Pajak.</small></li>}
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
        <header className="fin-card-head"><div><h3>Pencatatan terbaru</h3><p>Termasuk jurnal yang dibuat otomatis dari booking dan pembayaran.</p></div>
          {canJournal && <Link className="ops-link" href="/admin/keuangan/jurnal">Lihat jurnal umum <ArrowRight size={14}/></Link>}</header>
        <div className="manage-table-card ops-table table-cards">
          <table>
            <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Sumber</th><th className="right">Nilai</th></tr></thead>
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
    </div>
  );
}
