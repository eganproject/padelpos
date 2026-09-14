"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";
import { ArrowRight,AtSign,LoaderCircle,Phone,UserRound } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth-shell";
import { PasswordField } from "@/components/password-field";
import { api,saveSession,type User } from "@/lib/api";
export default function RegisterPage(){
  const router=useRouter();
  const [setup,setSetup]=useState<{available:boolean;requiresToken:boolean}|null>(null),[error,setError]=useState("");
  const [loading,setLoading]=useState(false),[form,setForm]=useState({name:"",email:"",phone:"",password:"",bootstrapToken:""});
  useEffect(()=>{api<{available:boolean;requiresToken:boolean}>("/auth/setup").then(setSetup).catch(e=>setError(e.message))},[]);
  const update=(key:keyof typeof form)=>(e:React.ChangeEvent<HTMLInputElement>)=>setForm({...form,[key]:e.target.value});
  async function submit(event:React.FormEvent){
    event.preventDefault();setLoading(true);
    try{const data=await api<{user:User}>("/auth/register",{method:"POST",body:JSON.stringify(form)});saveSession(data.user);toast.success("Admin pertama berhasil dibuat");router.push("/admin")}catch(e){toast.error((e as Error).message)}finally{setLoading(false)}
  }
  return <AuthShell mode="register"><h2>Siapkan arena Anda.</h2>{error&&<p role="alert">{error}</p>}{!setup?<p>Memeriksa penyiapan…</p>:!setup.available?<><p className="auth-subtitle">Sistem sudah memiliki admin. Untuk akun operator baru atau reset password, hubungi admin Anda.</p><Link className="primary-button" href="/login">Kembali ke login</Link></>:<><p className="auth-subtitle">Buat admin pertama. Akun staf berikutnya dikelola dari menu Pengguna.</p><form onSubmit={submit} className="auth-form compact-form"><label>Nama lengkap</label><div className="input-wrap"><UserRound size={18}/><input required minLength={3} maxLength={60} placeholder="Nama admin" value={form.name} onChange={update("name")}/></div><div className="form-grid"><div><label>Email</label><div className="input-wrap"><AtSign size={18}/><input required type="email" placeholder="nama@email.com" value={form.email} onChange={update("email")}/></div></div><div><label>Nomor telepon</label><div className="input-wrap"><Phone size={18}/><input required minLength={9} maxLength={18} placeholder="08xxxxxxxxxx" value={form.phone} onChange={update("phone")}/></div></div></div><label>Password</label><PasswordField required minLength={8} maxLength={72} value={form.password} onChange={update("password")}/><p className="password-hint">8–72 karakter, minimal 1 huruf kapital dan 1 angka.</p>{setup.requiresToken&&<><label>Token penyiapan</label><div className="input-wrap"><input required type="password" value={form.bootstrapToken} onChange={update("bootstrapToken")} placeholder="Token dari pengelola sistem"/></div></>}<button className="primary-button" disabled={loading}>{loading?<LoaderCircle className="spin"/>:<>Buat admin pertama <ArrowRight size={19}/></>}</button></form></>}<p className="auth-switch">Sudah memiliki akun? <Link href="/login">Masuk di sini</Link></p></AuthShell>;
}

