"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseBackup, Download, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Select } from "./form-controls";
import { ErrorBox } from "./operation-ui";

type Settings = { enabled:boolean; hour:number; keep:number; updated_at:string|null };
type BackupFile = { name:string; bytes:number; created_at:string; kind:"manual"|"otomatis" };
type Overview = { settings:Settings; files:BackupFile[]; directory:string; running:boolean; last_error:string; last_error_at:string|null; today:string };
type Form = Omit<Settings,"updated_at">;
const formFrom = (s:Settings):Form => ({ enabled:s.enabled, hour:s.hour, keep:s.keep });
const size = (bytes:number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Cadangan data: jadwal backup harian, backup manual, unduh, dan hapus berkas lama. */
export function BackupsPanel() {
  const [data, setData] = useState<Overview|null>(null), [form, setForm] = useState<Form|null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try { const result = await api<Overview>("/operations/backups"); setData(result); setForm(formFrom(result.settings)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const dirty = useMemo(() => !!data && !!form && JSON.stringify(form) !== JSON.stringify(formFrom(data.settings)), [data, form]);

  async function create() {
    setBusy("buat");
    try { const result = await api<Overview & { created:string }>("/operations/backups", { method:"POST", body:"{}" }); setData(result); toast.success(`Backup ${result.created} tersimpan`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }
  async function save(event:React.FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy("simpan");
    try { const result = await api<Overview>("/operations/backups/settings", { method:"PUT", body:JSON.stringify(form) }); setData(result); setForm(formFrom(result.settings)); toast.success("Jadwal backup disimpan"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }
  async function remove(name:string) {
    if (!confirm(`Hapus berkas ${name}? Berkas yang dihapus tidak bisa dipakai untuk pemulihan.`)) return;
    setBusy(name);
    try { setData(await api<Overview>(`/operations/backups/${encodeURIComponent(name)}`, { method:"DELETE" })); toast.success("Berkas backup dihapus"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  }

  if (error && !data) return <ErrorBox message={error} retry={() => void load()}/>;
  if (!data || !form) return <p className="empty-state">Memuat cadangan data…</p>;
  const latest = data.files[0];
  const healthy = !data.last_error && !!latest;
  return <div className="cms">
    <div className="pay-status">
      <div className={`pay-badge ${healthy ? "on" : "off"}`}>
        {healthy ? <DatabaseBackup size={22} aria-hidden="true"/> : <TriangleAlert size={22} aria-hidden="true"/>}
        <div>
          <b>{data.last_error ? "Backup terakhir gagal" : latest ? "Data tercadang" : "Belum ada backup"}</b>
          <small>{data.last_error ? data.last_error : latest ? `Terakhir ${new Date(latest.created_at).toLocaleString("id-ID", { dateStyle:"medium", timeStyle:"short" })}.` : "Buat backup pertama sekarang, lalu biarkan backup harian berjalan otomatis."}</small>
        </div>
      </div>
      <dl className="pay-meta">
        <div><dt>Jadwal</dt><dd>{data.settings.enabled ? `Setiap hari ${String(data.settings.hour).padStart(2, "0")}.00` : "Mati"}</dd></div>
        <div><dt>Disimpan</dt><dd>{data.files.length} dari {data.settings.keep} berkas</dd></div>
        <div><dt>Folder</dt><dd className="backup-path">{data.directory}</dd></div>
      </dl>
    </div>

    <form className="cms-form" onSubmit={save}>
      <div className="cms-grid">
        <section className="cms-card">
          <header><h2>Backup otomatis</h2><p>Satu berkas per hari berisi seluruh data: booking, pembayaran, keuangan, pelanggan, foto, dan pengaturan. Backup berjalan tanpa menghentikan kasir.</p></header>
          <label className="cms-check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled:e.target.checked })}/> Buat backup setiap hari</label>
          <div className="field-grid">
            <label className="cms-field"><span className="cms-label">Mulai pukul</span><Select value={String(form.hour)} onChange={e => setForm({ ...form, hour:Number(e.target.value) })}>{Array.from({ length:24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}.00</option>)}</Select></label>
            <label className="cms-field"><span className="cms-label">Simpan berkas terakhir</span><input type="number" min={1} max={90} value={form.keep} onChange={e => setForm({ ...form, keep:Number(e.target.value) })}/></label>
          </div>
          <p className="cms-hint">Berkas tertua dihapus otomatis bila jumlahnya melebihi batas ini, termasuk backup manual.</p>
        </section>
        <section className="cms-card">
          <header><h2>Simpan di tempat lain</h2><p>Berkas di folder server ikut hilang bila disk server rusak. Unduh backup secara berkala, atau atur BACKUP_DIR ke folder yang disinkron ke Google Drive atau disk lain.</p></header>
          <p className="cms-hint">Pemulihan dijalankan oleh teknisi dari server: hentikan API, lalu jalankan <code>npm run restore -w apps/api -- nama-berkas.json.gz</code>. Sesi login dan kode OTP tidak ikut dicadangkan, jadi semua orang perlu masuk ulang setelah pemulihan.</p>
        </section>
      </div>
      <div className={`cms-savebar${dirty ? " dirty" : ""}`}>
        <span>{dirty ? "Ada perubahan yang belum disimpan." : data.settings.updated_at ? `Terakhir disimpan ${new Date(data.settings.updated_at).toLocaleString("id-ID", { dateStyle:"medium", timeStyle:"short" })}.` : "Memakai jadwal bawaan."}</span>
        <button className="ops-primary" type="submit" disabled={!dirty || !!busy}>{busy === "simpan" ? "Menyimpan…" : "Simpan jadwal"}</button>
      </div>
    </form>

    <div className="ops-section-title"><div><h2>Berkas backup</h2><p>Berkas terbaru di atas. Isinya data pribadi pelanggan, jadi simpan unduhan di tempat yang aman.</p></div>
      <div className="ops-actions"><button type="button" className="ops-secondary" onClick={() => void load()} disabled={!!busy}><RefreshCw size={14}/> Muat ulang</button>
        <button type="button" className="ops-primary" onClick={() => void create()} disabled={!!busy || data.running}>{busy === "buat" || data.running ? <><Loader2 size={15} className="spin"/> Membuat backup…</> : "Backup sekarang"}</button></div></div>
    <div className="manage-table-card ops-table table-cards"><table>
      <thead><tr><th>Berkas</th><th>Jenis</th><th>Ukuran</th><th>Aksi</th></tr></thead>
      <tbody>{data.files.map(file => <tr key={file.name}>
        <td className="wide" data-label="Berkas"><b>{new Date(file.created_at).toLocaleString("id-ID", { dateStyle:"medium", timeStyle:"short" })}</b><small className="table-description">{file.name}</small></td>
        <td data-label="Jenis"><span className={`status-pill ${file.kind === "manual" ? "wait" : "on"}`}>{file.kind === "manual" ? "Manual" : "Otomatis"}</span></td>
        <td data-label="Ukuran">{size(file.bytes)}</td>
        <td className="actions"><div className="row-actions">
          <a href={`/api/operations/backups/${encodeURIComponent(file.name)}/download`} download aria-label={`Unduh ${file.name}`} title="Unduh"><Download/></a>
          <button className="delete" onClick={() => void remove(file.name)} disabled={!!busy} aria-label={`Hapus ${file.name}`}><Trash2/></button>
        </div></td>
      </tr>)}</tbody>
    </table>{!data.files.length && <p className="empty-state">Belum ada berkas backup.</p>}</div>
  </div>;
}
