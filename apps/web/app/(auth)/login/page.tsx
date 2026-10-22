"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, AtSign, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { api, ApiError, saveSession, type User } from "@/lib/api";

type LoginReply = { user: User; twoFactor?: undefined } | { twoFactor: true; ticket: string; user?: undefined };

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  /** Tiket langkah kedua setelah password benar, bila akun memakai verifikasi 2 langkah. */
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);

  function enter(user: User, recoveryLeft?: number | null) {
    saveSession(user);
    toast.success(`Selamat datang, ${user.name}`);
    if (typeof recoveryLeft === "number") toast.warning(`Kode cadangan terpakai. Sisa ${recoveryLeft} kode; buat kode baru di Profil Saya bila hampir habis.`, { duration: 8000 });
    router.push("/admin");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true);
    try {
      const data = await api<LoginReply>("/auth/login", { method: "POST", body: JSON.stringify(form) });
      if (data.twoFactor) { setTicket(data.ticket); setCode(""); setRecovery(false); return; }
      enter(data.user);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Gagal masuk"); }
    finally { setLoading(false); }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setLoading(true);
    try {
      const data = await api<{ user: User; recoveryLeft: number | null }>("/auth/login/2fa", { method: "POST", body: JSON.stringify({ ticket, code }) });
      enter(data.user, data.recoveryLeft);
    } catch (error) {
      // Tiket berlaku 5 menit; setelah itu kembali ke email dan password.
      if (error instanceof ApiError && error.status === 401 && /habis/.test(error.message)) setTicket("");
      toast.error(error instanceof Error ? error.message : "Gagal memverifikasi");
    } finally { setLoading(false); }
  }

  if (ticket) return (
    <AuthShell mode="login">
      <h2>Verifikasi 2 langkah</h2>
      <p className="auth-subtitle">{recovery ? "Masukkan salah satu kode cadangan yang Anda simpan saat mengaktifkan verifikasi 2 langkah." : "Buka aplikasi authenticator di ponsel Anda, lalu masukkan 6 angka untuk akun ini."}</p>
      <form onSubmit={verify} className="auth-form">
        <label htmlFor="otp">{recovery ? "Kode cadangan" : "Kode verifikasi"}</label>
        <div className="input-wrap">{recovery ? <KeyRound size={18} /> : <ShieldCheck size={18} />}
          <input id="otp" key={recovery ? "recovery" : "totp"} required autoFocus autoComplete="one-time-code" className={recovery ? "" : "otp-input"}
            inputMode={recovery ? "text" : "numeric"} pattern={recovery ? "[A-Za-z0-9\\- ]{8,12}" : "[0-9 ]{6,7}"} maxLength={recovery ? 12 : 7}
            placeholder={recovery ? "ABCD-EFGH" : "123 456"} value={code} onChange={e => setCode(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/[^0-9 ]/g, ""))} />
        </div>
        <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <>Verifikasi dan masuk <ArrowRight size={19} /></>}</button>
      </form>
      <p className="auth-switch"><button type="button" className="link-button" onClick={() => { setRecovery(!recovery); setCode(""); }}>{recovery ? "Pakai kode dari aplikasi" : "Ponsel tidak ada? Pakai kode cadangan"}</button></p>
      <p className="auth-switch"><button type="button" className="link-button" onClick={() => setTicket("")}><ArrowLeft size={14} /> Kembali</button></p>
    </AuthShell>
  );

  return (
    <AuthShell mode="login">
      <h2>Selamat datang kembali.</h2>
      <p className="auth-subtitle">Masuk untuk melanjutkan ke pusat kendali Anda.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email operator</label>
        <div className="input-wrap"><AtSign size={18} /><input required type="email" autoComplete="username" placeholder="nama@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="label-row"><label>Password</label><Link className="password-hint" href={`/lupa-password${form.email ? `?email=${encodeURIComponent(form.email)}` : ""}`}>Lupa password?</Link></div>
        <PasswordField required autoComplete="current-password" placeholder="Masukkan password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <>Masuk ke dashboard <ArrowRight size={19} /></>}</button>
      </form>
      <div className="divider"><span />atau<span /></div>
      <p className="auth-switch">Penyiapan awal? <Link href="/register">Buat admin pertama</Link></p>
    </AuthShell>
  );
}
