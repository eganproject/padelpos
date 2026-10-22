"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, AtSign, LoaderCircle, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { api } from "@/lib/api";

/** Minta tautan reset password staf lewat email. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState("");
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  useEffect(() => {
    setEmail(new URLSearchParams(window.location.search).get("email") ?? "");
    api<{ email: boolean }>("/auth/recovery").then(data => setEmailReady(data.email)).catch(() => setEmailReady(true));
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true);
    try { setSent((await api<{ message: string }>("/auth/forgot", { method: "POST", body: JSON.stringify({ email }) })).message); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Gagal mengirim tautan"); }
    finally { setLoading(false); }
  }
  return (
    <AuthShell mode="login">
      <h2>Lupa password</h2>
      {sent ? <>
        <div className="auth-done" role="status"><MailCheck aria-hidden="true" /><p>{sent}</p></div>
        <p className="auth-subtitle">Tautan berlaku 30 menit dan hanya bisa dipakai sekali.</p>
      </> : <>
        <p className="auth-subtitle">Masukkan email akun staf Anda. Kami kirim tautan untuk membuat password baru.</p>
        {emailReady === false && <p className="auth-note" role="note">Pengiriman email venue belum diaktifkan, jadi tautan tidak bisa dikirim. Minta Super Admin mengganti password Anda dari menu Pengguna.</p>}
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="email">Email operator</label>
          <div className="input-wrap"><AtSign size={18} /><input id="email" required type="email" autoComplete="username" placeholder="nama@email.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <button className="primary-button" disabled={loading || emailReady === false}>{loading ? <LoaderCircle className="spin" /> : <>Kirim tautan reset <ArrowRight size={19} /></>}</button>
        </form>
      </>}
      <p className="auth-switch"><Link href="/login"><ArrowLeft size={14} /> Kembali ke halaman masuk</Link></p>
    </AuthShell>
  );
}
