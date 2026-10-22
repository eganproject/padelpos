"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ErrorBox, Modal } from "./operation-ui";

type Status = { enabled: boolean; enabled_at: string | null; recovery_left: number };
type Setup = { secret: string; otpauth_url: string; issuer: string; account: string };

/**
 * Verifikasi 2 langkah di Profil Saya: aktifkan dengan memindai QR di aplikasi authenticator,
 * simpan kode cadangan, buat ulang kode cadangan, atau matikan.
 */
export function TwoFactorCard({ changed }: { changed?: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"" | "setup" | "disable" | "recovery">("");
  const [codes, setCodes] = useState<string[]>([]);
  const load = useCallback(async () => { try { setStatus(await api<Status>("/profile/2fa")); } catch { setStatus(null); } }, []);
  useEffect(() => { void load(); }, [load]);
  const done = (next: Status, recovery?: string[]) => { setStatus(next); setMode(""); if (recovery) setCodes(recovery); changed?.(next.enabled); };

  return <div className="settings-card two-factor-card">
    <div className="settings-title"><Smartphone aria-hidden="true" /><div><h2>Verifikasi 2 langkah</h2><p>Setelah password, masuk juga butuh kode 6 angka dari aplikasi authenticator di ponsel (Google Authenticator, Microsoft Authenticator, Authy, atau 1Password).</p></div></div>
    {!status ? <p className="field-hint">Memuat…</p> : status.enabled ? <>
      <div className="two-factor-state on"><ShieldCheck aria-hidden="true" /><div><b>Aktif</b><small>Sejak {status.enabled_at ? new Date(status.enabled_at).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-"} · sisa {status.recovery_left} kode cadangan</small></div></div>
      {status.recovery_left <= 2 && <p className="two-factor-warn" role="note">Kode cadangan hampir habis. Buat kode baru agar tetap bisa masuk bila ponsel hilang.</p>}
      <div className="ops-row-buttons"><button type="button" className="ops-secondary" onClick={() => setMode("recovery")}><KeyRound size={14} /> Buat kode cadangan baru</button><button type="button" className="ops-danger" onClick={() => setMode("disable")}><ShieldOff size={14} /> Matikan</button></div>
    </> : <>
      <div className="two-factor-state"><ShieldOff aria-hidden="true" /><div><b>Belum aktif</b><small>Akun hanya dilindungi password.</small></div></div>
      <div><button type="button" className="ops-primary" onClick={() => setMode("setup")}><ShieldCheck size={15} /> Aktifkan verifikasi 2 langkah</button></div>
    </>}
    {mode === "setup" && <SetupModal close={() => setMode("")} done={done} />}
    {mode === "disable" && <ConfirmModal kind="disable" close={() => setMode("")} done={done} />}
    {mode === "recovery" && <ConfirmModal kind="recovery" close={() => setMode("")} done={done} />}
    {codes.length > 0 && <RecoveryCodes codes={codes} close={() => setCodes([])} />}
  </div>;
}

function SetupModal({ close, done }: { close: () => void; done: (status: Status, codes?: string[]) => void }) {
  const [password, setPassword] = useState(""), [setup, setSetup] = useState<Setup | null>(null), [qr, setQr] = useState("");
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function start(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const data = await api<Setup>("/profile/2fa/setup", { method: "POST", body: JSON.stringify({ password }) });
      setSetup(data); setQr(await QRCode.toDataURL(data.otpauth_url, { margin: 1, width: 360, errorCorrectionLevel: "M" }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const data = await api<{ status: Status; recovery_codes: string[] }>("/profile/2fa/enable", { method: "POST", body: JSON.stringify({ code }) });
      toast.success("Verifikasi 2 langkah aktif"); done(data.status, data.recovery_codes);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Aktifkan verifikasi 2 langkah" close={close}>
    {!setup ? <form className="modal-fields" onSubmit={start}>
      {error && <ErrorBox message={error} />}
      <p className="field-hint">Masukkan password Anda untuk memulai.</p>
      <label>Password saat ini<input type="password" required autoFocus autoComplete="current-password" maxLength={72} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <div className="ops-row-buttons"><button className="ops-primary" disabled={busy}>{busy ? "Memeriksa…" : "Lanjut"}</button><button type="button" className="ops-secondary" onClick={close}>Batal</button></div>
    </form> : <form className="modal-fields" onSubmit={confirm}>
      {error && <ErrorBox message={error} />}
      <ol className="two-factor-steps">
        <li>Buka aplikasi authenticator, pilih tambah akun, lalu pindai kode QR ini.</li>
        <li>Masukkan 6 angka yang muncul di aplikasi untuk {setup.issuer}.</li>
      </ol>
      <div className="two-factor-qr">{qr ? <img src={qr} alt={`Kode QR verifikasi 2 langkah untuk ${setup.account}`} width={180} height={180} /> : null}</div>
      <details className="two-factor-manual"><summary>Tidak bisa memindai? Ketik kunci ini</summary>
        <div className="secret-row"><code>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code><button type="button" className="ops-secondary" onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => toast.success("Kunci disalin"))}><Copy size={14} /> Salin</button></div>
      </details>
      <label>Kode 6 angka<input className="otp-field" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123 456" value={code} onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ""))} /></label>
      <div className="ops-row-buttons"><button className="ops-primary" disabled={busy}>{busy ? "Memeriksa…" : "Aktifkan"}</button><button type="button" className="ops-secondary" onClick={close}>Batal</button></div>
    </form>}
  </Modal>;
}

function ConfirmModal({ kind, close, done }: { kind: "disable" | "recovery"; close: () => void; done: (status: Status, codes?: string[]) => void }) {
  const [password, setPassword] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (kind === "disable") { done(await api<Status>("/profile/2fa/disable", { method: "POST", body: JSON.stringify({ password, code }) })); toast.success("Verifikasi 2 langkah dimatikan"); }
      else { const data = await api<{ status: Status; recovery_codes: string[] }>("/profile/2fa/recovery", { method: "POST", body: JSON.stringify({ password }) }); done(data.status, data.recovery_codes); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={kind === "disable" ? "Matikan verifikasi 2 langkah" : "Buat kode cadangan baru"} close={close}>
    <form className="modal-fields" onSubmit={submit}>
      {error && <ErrorBox message={error} />}
      <p className="field-hint">{kind === "disable" ? "Setelah dimatikan, akun hanya dilindungi password." : "Kode cadangan lama langsung tidak berlaku."}</p>
      <label>Password saat ini<input type="password" required autoFocus autoComplete="current-password" maxLength={72} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {kind === "disable" && <label>Kode dari aplikasi atau kode cadangan<input required autoComplete="one-time-code" maxLength={12} placeholder="123456" value={code} onChange={e => setCode(e.target.value)} /></label>}
      <div className="ops-row-buttons"><button className={kind === "disable" ? "ops-danger" : "ops-primary"} disabled={busy}>{busy ? "Memproses…" : kind === "disable" ? "Matikan" : "Buat kode baru"}</button><button type="button" className="ops-secondary" onClick={close}>Batal</button></div>
    </form>
  </Modal>;
}

/** Kode cadangan hanya ditampilkan sekali. */
function RecoveryCodes({ codes, close }: { codes: string[]; close: () => void }) {
  const text = codes.join("\n");
  function download() {
    const url = URL.createObjectURL(new Blob([`Kode cadangan verifikasi 2 langkah\nSetiap kode hanya bisa dipakai sekali.\n\n${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = "kode-cadangan.txt"; link.click(); URL.revokeObjectURL(url);
  }
  return <Modal title="Simpan kode cadangan" close={close}>
    <div className="modal-fields">
      <p className="field-hint">Pakai salah satu kode ini untuk masuk bila ponsel hilang. Setiap kode hanya bisa dipakai sekali, dan kode ini tidak akan ditampilkan lagi.</p>
      <ul className="recovery-codes">{codes.map(item => <li key={item}><code>{item}</code></li>)}</ul>
      <div className="ops-row-buttons"><button type="button" className="ops-secondary" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success("Kode disalin"))}><Copy size={14} /> Salin</button><button type="button" className="ops-secondary" onClick={download}><Download size={14} /> Unduh .txt</button><button type="button" className="ops-primary" onClick={close}>Sudah saya simpan</button></div>
    </div>
  </Modal>;
}
