"use client";
import { useCallback, useEffect, useState } from "react";
import { Banknote, LockKeyhole, Printer, RefreshCw, Scale, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { type Shift, type ShiftOverview, differenceLabel, shiftSources } from "@/lib/shifts";
import { methodName } from "@/lib/counter";
import { ErrorBox } from "./operation-ui";
import { MoneyInput } from "./form-controls";

const printShift = (id: string) => window.open(`/cetak/nota/${id}?jenis=shift&cetak=1`, "_blank", "noopener");
const time = (value: string) => new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

/**
 * Tutup kasir: buka shift dengan modal awal laci, pantau uang yang seharusnya ada, lalu tutup dengan
 * uang yang dihitung. Selisihnya dijurnal otomatis ke akun Selisih Kas.
 */
export function ShiftPanel() {
  const [data, setData] = useState<ShiftOverview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<ShiftOverview>("/operations/shifts")); setError(""); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Rekap berjalan diperbarui tiap menit selama tab terlihat.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible" && data?.current) void load(); }, 60000);
    return () => clearInterval(timer);
  }, [load, data?.current]);

  return <>
    {error && <ErrorBox message={error} retry={load} />}
    <div className="ops-actions"><p>Buka shift saat mulai jaga, lalu hitung uang laci saat selesai. Rekap mencakup pembayaran booking, transaksi kasir, dan iuran member yang Anda catat sendiri. Pembayaran Midtrans tidak ikut karena masuk ke rekening.</p></div>
    {!data ? <p className="empty-state">Memuat shift…</p> : data.current ? <CurrentShift shift={data.current} reload={load} /> : <OpenShift opened={load} />}
    {data && <History data={data} />}
  </>;
}

function OpenShift({ opened }: { opened: () => void }) {
  const [cash, setCash] = useState<number | "">(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const shift = await api<Shift>("/operations/shifts", { method: "POST", body: JSON.stringify({ opening_cash: Number(cash || 0), note }) }); toast.success(`Shift ${shift.number} dibuka`); opened(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form className="settings-card shift-open" onSubmit={submit}>
    <div className="settings-title"><Wallet aria-hidden="true" /><div><h2>Belum ada shift yang dibuka</h2><p>Hitung uang tunai di laci sebelum mulai melayani. Angka ini menjadi modal awal shift.</p></div></div>
    {error && <ErrorBox message={error} />}
    <div className="field-grid"><label>Modal awal di laci<MoneyInput autoFocus min={0} max={1000000000} value={cash} onChange={e => setCash(e.target.value === "" ? "" : Number(e.target.value))} /></label><label>Catatan (opsional)<input maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="Mis. shift pagi" /></label></div>
    <div><button className="ops-primary" disabled={busy}>{busy ? "Membuka…" : "Buka shift"}</button></div>
  </form>;
}

function CurrentShift({ shift, reload }: { shift: Shift; reload: () => void }) {
  const [counted, setCounted] = useState<number | "">(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [closed, setClosed] = useState<Shift | null>(null);
  const difference = counted === "" ? null : Number(counted) - shift.expected_cash;
  const nonCash = shift.summary.methods.filter(row => row.method !== "cash").reduce((sum, row) => sum + row.net, 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (difference && !confirm(`Uang ${difference < 0 ? "kurang" : "lebih"} ${money(Math.abs(difference))}. Tutup shift dan catat selisihnya?`)) return;
    setBusy(true); setError("");
    try {
      const result = await api<Shift>(`/operations/shifts/${shift.id}/close`, { method: "POST", body: JSON.stringify({ counted_cash: Number(counted), note }) });
      setClosed(result); toast.success(`Shift ${result.number} ditutup`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (closed) return <div className="settings-card shift-done" role="status">
    <div className="settings-title"><LockKeyhole aria-hidden="true" /><div><h2>Shift {closed.number} sudah ditutup</h2><p>{differenceLabel(closed.difference ?? 0)}. Rekapnya tersimpan di riwayat di bawah.</p></div></div>
    <div className="ops-row-buttons"><button className="ops-primary" type="button" onClick={() => printShift(closed.id)}><Printer size={15} /> Cetak rekap</button><button className="ops-secondary" type="button" onClick={reload}>Selesai</button></div>
  </div>;
  return <>
    <div className="metric-grid metric-grid-3 shift-metrics">
      <article className="metric-card lime"><div className="metric-top"><span><Banknote /></span></div><p>Uang tunai seharusnya</p><h2>{money(shift.expected_cash)}</h2><small>Modal {money(shift.opening_cash)} {shift.summary.cash_net < 0 ? "−" : "+"} tunai bersih {money(Math.abs(shift.summary.cash_net))}</small></article>
      <article className="metric-card violet"><div className="metric-top"><span><Wallet /></span></div><p>Non-tunai</p><h2>{money(nonCash)}</h2><small>Transfer dan QRIS manual yang Anda catat</small></article>
      <article className="metric-card cyan"><div className="metric-top"><span><RefreshCw /></span></div><p>Shift {shift.number}</p><h2 className="shift-since">{new Date(shift.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</h2><small>Dibuka {time(shift.opened_at)}{shift.open_note ? ` · ${shift.open_note}` : ""}</small></article>
    </div>
    <ShiftBreakdown shift={shift} />
    <form className="settings-card shift-close" onSubmit={submit}>
      <div className="settings-title"><Scale aria-hidden="true" /><div><h2>Tutup shift</h2><p>Hitung semua uang tunai di laci, termasuk modal awal, lalu masukkan jumlahnya.</p></div></div>
      {error && <ErrorBox message={error} />}
      <div className="field-grid">
        <label>Uang tunai dihitung<MoneyInput required min={0} max={1000000000} value={counted} onChange={e => setCounted(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        <div className={`shift-diff${difference === null ? "" : difference === 0 ? " ok" : difference < 0 ? " short" : " over"}`} aria-live="polite"><small>Selisih</small><b>{difference === null ? "–" : differenceLabel(difference)}</b></div>
      </div>
      <label>Catatan{difference ? " (wajib, jelaskan selisihnya)" : " (opsional)"}<textarea rows={2} maxLength={300} required={!!difference} minLength={difference ? 3 : undefined} value={note} onChange={e => setNote(e.target.value)} placeholder={difference ? "Mis. kembalian salah ke pelanggan" : "Mis. uang disetor ke pemilik"} /></label>
      <div className="ops-row-buttons"><button className="ops-primary" disabled={busy || counted === ""}>{busy ? "Menutup…" : "Tutup shift"}</button><button className="ops-secondary" type="button" onClick={reload}><RefreshCw size={14} /> Perbarui rekap</button></div>
    </form>
  </>;
}

export function ShiftBreakdown({ shift }: { shift: Shift }) {
  const { summary } = shift;
  const sources = shiftSources(summary).filter(row => row.amount);
  return <div className="shift-breakdown">
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Metode</th><th>Masuk</th><th>Keluar</th><th>Bersih</th><th>Transaksi</th></tr></thead><tbody>
      {summary.methods.map(row => <tr key={row.method}><td className="wide" data-label="Metode"><b>{methodName[row.method] ?? row.method}</b></td><td data-label="Masuk">{money(row.received)}</td><td data-label="Keluar">{row.returned ? `−${money(row.returned)}` : money(0)}</td><td data-label="Bersih"><b>{money(row.net)}</b></td><td data-label="Transaksi">{row.count}</td></tr>)}
    </tbody></table>{!summary.methods.length && <p className="empty-state">Belum ada transaksi yang Anda catat di shift ini.</p>}</div>
    {sources.length > 0 && <ul className="shift-sources">{sources.map(row => <li key={row.label}><span>{row.label}</span><b>{row.sign < 0 ? "−" : ""}{money(row.amount)}</b></li>)}</ul>}
  </div>;
}

function History({ data }: { data: ShiftOverview }) {
  const closed = data.shifts.filter(shift => shift.closed_at);
  return <>
    <div className="ops-section-title"><div><h2>Riwayat shift</h2><p>{data.all_staff ? "Shift semua staf, 30 terakhir." : "Shift Anda, 30 terakhir."}</p></div></div>
    <div className="manage-table-card ops-table table-cards"><table><thead><tr><th>Shift</th><th>Modal</th><th>Seharusnya</th><th>Dihitung</th><th>Selisih</th><th>Aksi</th></tr></thead><tbody>{data.shifts.map(shift => <tr key={shift.id}>
      <td className="wide" data-label="Shift"><b>{shift.number}{data.all_staff ? ` · ${shift.user_name}` : ""}</b><small className="table-description">{time(shift.opened_at)} – {shift.closed_at ? time(shift.closed_at) : "masih buka"}</small>{shift.close_note && <small className="table-description">{shift.close_note}</small>}</td>
      <td data-label="Modal">{money(shift.opening_cash)}</td>
      <td data-label="Seharusnya">{money(shift.expected_cash)}</td>
      <td data-label="Dihitung">{shift.counted_cash === null ? "–" : money(shift.counted_cash)}</td>
      <td data-label="Selisih">{shift.difference === null ? <span className="status-pill wait">Buka</span> : <span className={`shift-diff-pill${shift.difference === 0 ? " ok" : shift.difference < 0 ? " short" : " over"}`}>{shift.difference === 0 ? "Pas" : `${shift.difference < 0 ? "−" : "+"}${money(Math.abs(shift.difference))}`}</span>}</td>
      <td className="actions"><div className="ops-row-buttons">{shift.closed_at && <button className="ops-secondary" onClick={() => printShift(shift.id)}><Printer size={14} /> Cetak</button>}</div></td>
    </tr>)}</tbody></table>{!closed.length && !data.shifts.length && <p className="empty-state">Belum ada shift.</p>}</div>
  </>;
}
