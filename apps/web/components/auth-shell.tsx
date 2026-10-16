import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "./brand";

/** Halaman masuk staf bergaya login Frappe: satu kartu di tengah, logo di atas judul. */
export function AuthShell({ children }: { children: React.ReactNode; mode: "login" | "register" }) {
  return (
    <main className="auth-page">
      <Link href="/" className="auth-back"><ArrowLeft aria-hidden="true" /> Situs pelanggan</Link>
      <div className="auth-card">
        <div className="auth-logo"><Brand /></div>
        {children}
      </div>
      <p className="auth-foot">© {new Date().getFullYear()} Padelix · Area staf</p>
    </main>
  );
}
