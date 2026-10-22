"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { api } from "@/lib/api";

/** Buat password baru dari tautan email. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [state, setState] = useState<{ email: string; two_factor: boolean } | { error: string } | null>(null);
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(value);
    if (!value) { setState({ error: "Tautan reset tidak lengkap. Buka lagi tautan dari email Anda." }); return; }
    api<{ email: string; two_factor: boolean }>(`/auth/reset?token=${encodeURIComponent(value)}`).then(setState).catch(error => setState({ error: error instanceof Error ? error.message : "Tautan tidak valid." }));
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) return toast.error("Konfirmasi password tidak sama.");
    setLoading(true);
    try {
      const done = await api<{ message: string }>("/auth/reset", { method: "POST", body: JSON.stringify({ token, password: form.password }) });
      toast.success(done.message);
      router.push("/login");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Gagal menyimpan password"); }
    finally { setLoading(false); }
  }
  return (
    <AuthShell mode="login">
      <h2>Buat password baru</h2>
      {!state ? <p className="auth-subtitle"><LoaderCircle className="spin" size={16} /> Memeriksa tautan…</p>
        : "error" in state ? <>
          <div className="auth-done error" role="alert"><TriangleAlert aria-hidden="true" /><p>{state.error}</p></div>
          <p className="auth-switch"><Link href="/lupa-password">Minta tautan baru</Link></p>
        </> : <>
          <p className="auth-subtitle">Untuk akun {state.email}. Semua perangkat yang sedang masuk akan keluar otomatis.{state.two_factor ? " Verifikasi 2 langkah tetap aktif." : ""}</p>
          <form onSubmit={submit} className="auth-form">
            <label>Password baru</label>
            <PasswordField required autoFocus autoComplete="new-password" minLength={8} maxLength={72} placeholder="Minimal 8 karakter" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <p className="password-hint">Minimal 8 karakter, memuat huruf kapital dan angka.</p>
            <label>Ulangi password baru</label>
            <PasswordField required autoComplete="new-password" minLength={8} maxLength={72} placeholder="Ketik ulang" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
            <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <>Simpan password <ArrowRight size={19} /></>}</button>
          </form>
        </>}
      <p className="auth-switch"><Link href="/login"><ArrowLeft size={14} /> Kembali ke halaman masuk</Link></p>
    </AuthShell>
  );
}
