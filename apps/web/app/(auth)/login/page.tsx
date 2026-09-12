"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, AtSign, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { api, saveSession, type User } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true);
    try {
      const data = await api<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(form) });
      saveSession(data.user);
      toast.success(`Selamat datang, ${data.user.name}`);
      router.push("/admin");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Gagal masuk"); }
    finally { setLoading(false); }
  }

  return (
    <AuthShell mode="login">
      <h2>Selamat datang kembali.</h2>
      <p className="auth-subtitle">Masuk untuk melanjutkan ke pusat kendali Anda.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email operator</label>
        <div className="input-wrap"><AtSign size={18} /><input required type="email" placeholder="nama@padelix.id" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="label-row"><label>Password</label><span className="password-hint">Reset password melalui admin</span></div>
        <PasswordField required placeholder="Masukkan password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <>Masuk ke dashboard <ArrowRight size={19} /></>}</button>
      </form>
      <div className="divider"><span />atau<span /></div>
      <p className="auth-switch">Penyiapan awal? <Link href="/register">Buat admin pertama</Link></p>
    </AuthShell>
  );
}
