"use client";
import { useCallback, useEffect, useState } from "react";
import { BookCheck, Lock, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, money } from "@/lib/finance";
import { ErrorBox } from "./operation-ui";

type Closing = {
  closings:{ year:number; net_income:number; closed_at:string; entry_number:string; closed_by_name:string; stale:boolean; current_net:number; can_undo:boolean }[];
  open:{ year:number; income:number; expense:number; net:number; can_close:boolean; reason:string }[];
  locked_until:string; year:number;
};

/**
 * Tutup buku tahunan: laba rugi setahun dipindahkan ke Laba Ditahan lewat jurnal penutup 31 Desember,
 * lalu pembukuan tahun itu dikunci.
 */
export function ClosingView({ reload }: { reload:()=>void }) {
  const [data,setData] = useState<Closing|null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState<number|null>(null);
  const load = useCallback(async () => { try { setData(await api<Closing>("/operations/finance/closing")); setError("") } catch (e) { setError((e as Error).message) } }, []);
  useEffect(() => { void load() }, [load]);
  async function run(year:number, path:"" | "/undo", question:string, success:string) {
    if (!confirm(question)) return;
    setBusy(year);
    try { setData(await api<Closing>(`/operations/finance/closing${path}`, { method:"POST", body:JSON.stringify({ year }) })); toast.success(success); reload() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  if (error) return <ErrorBox message={error} retry={load}/>;
  if (!data) return <p className="empty-state">Memuat tutup buku…</p>;
  return (
    <div className="fin-report">
      <div className="fin-report-head"><div><h3>Tutup buku tahunan</h3><p>Memindahkan laba atau rugi setahun ke akun Laba Ditahan lewat jurnal penutup tanggal 31 Desember, lalu mengunci pembukuan tahun itu. Laporan laba rugi tahun itu tetap bisa dibuka seperti biasa.</p></div></div>
      <section className="fin-sheet">
        <header><h4>Belum ditutup</h4>{data.locked_until && <span className="fin-locked"><Lock size={13}/> Terkunci s.d. {formatDate(data.locked_until)}</span>}</header>
        {data.open.length ? <table><thead><tr><th>Tahun</th><th className="right">Pendapatan</th><th className="right">Biaya</th><th className="right">Laba bersih</th><th/></tr></thead><tbody>
          {data.open.map(item => (
            <tr key={item.year}>
              <td className="fin-cell-name"><b>{item.year}</b><small>1 Jan – 31 Des {item.year}</small></td>
              <td className="right">{money(item.income)}</td><td className="right">{money(item.expense)}</td>
              <td className={`right${item.net<0?" minus":""}`}><b>{money(item.net)}</b></td>
              <td className="right">{item.can_close
                ? <button type="button" className="ops-primary" disabled={busy!==null} onClick={()=>void run(item.year,"",`Tutup buku ${item.year}? ${item.net>=0?"Laba":"Rugi"} ${money(Math.abs(item.net))} dipindahkan ke Laba Ditahan, penyusutan aset sampai Desember dicatat, dan pembukuan sampai 31 Desember ${item.year} dikunci.`,`Buku ${item.year} ditutup`)}><BookCheck size={14}/> {busy===item.year?"Menutup…":"Tutup buku"}</button>
                : <small className="muted">{item.reason}</small>}</td>
            </tr>
          ))}
        </tbody></table> : <p className="muted">Tidak ada tahun yang perlu ditutup. Tahun {data.year} bisa ditutup mulai 1 Januari {data.year+1}.</p>}
      </section>
      <section className="fin-sheet">
        <header><h4>Riwayat tutup buku</h4></header>
        {data.closings.length ? <table><thead><tr><th>Tahun</th><th className="right">Laba ditutup</th><th>Jurnal</th><th/></tr></thead><tbody>
          {data.closings.map(item => (
            <tr key={item.year}>
              <td className="fin-cell-name"><b>{item.year}</b><small>{new Date(item.closed_at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}{item.closed_by_name?` · ${item.closed_by_name}`:""}</small>
                {item.stale && <small className="fin-stale"><TriangleAlert size={12}/> Ada perubahan setelah ditutup: laba sekarang {money(item.current_net)}.</small>}</td>
              <td className={`right${item.net_income<0?" minus":""}`}>{money(item.net_income)}</td>
              <td>{item.entry_number || "—"}</td>
              <td className="right"><div className="ops-row-buttons fin-closing-actions">
                {item.stale && <button type="button" className="ops-primary" disabled={busy!==null} onClick={()=>void run(item.year,"",`Perbarui jurnal penutup ${item.year} dengan laba terbaru ${money(item.current_net)}?`,`Jurnal penutup ${item.year} diperbarui`)}>Perbarui</button>}
                {item.can_undo && <button type="button" className="ops-secondary" disabled={busy!==null} onClick={()=>void run(item.year,"/undo",`Batalkan tutup buku ${item.year}? Jurnal penutupnya dihapus. Kunci pembukuan tidak berubah; buka sendiri di Kas & penguncian bila perlu koreksi.`,`Tutup buku ${item.year} dibatalkan`)}><RotateCcw size={14}/> Batalkan</button>}
              </div></td>
            </tr>
          ))}
        </tbody></table> : <p className="muted">Belum pernah tutup buku.</p>}
      </section>
      <p className="fin-note">Tahun ditutup berurutan dari yang paling lama. Di neraca, modal menjadi Laba Ditahan (tahun yang sudah ditutup) dan Laba Tahun Berjalan.</p>
    </div>
  );
}
