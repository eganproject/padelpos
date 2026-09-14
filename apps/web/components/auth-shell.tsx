import Link from "next/link";
import { ArrowLeft, CalendarDays, LayoutGrid, WalletCards } from "lucide-react";
import { Brand } from "./brand";

export function AuthShell({ children, mode }: { children: React.ReactNode; mode: "login" | "register" }) {
  return (
    <main className="auth-page">
      <div className="grid-overlay" />
      <section className="auth-story">
        <Brand />
        <div className="story-copy">
          <div className="eyebrow"><span /> AREA STAF PADELIX</div>
          <h1>Kelola permainan.<br /><em>Kuasai arena.</em></h1>
          <p>Satu tempat untuk mengatur booking, pembayaran, jadwal perawatan, dan denah venue yang dilihat pelanggan.</p>
          <div className="feature-strip">
            <div><CalendarDays /><span><b>Booking</b> Jadwal dan pembayaran</span></div>
            <div><WalletCards /><span><b>Keuangan</b> Tagihan dan pengembalian</span></div>
            <div><LayoutGrid /><span><b>Denah</b> Tampil ke pelanggan</span></div>
          </div>
        </div>
        <div className="court-art" aria-hidden="true">
          <div className="court-glow" /><div className="court"><i /><b /><span /></div>
          <div className="ball" />
        </div>
        <p className="story-footer">© {new Date().getFullYear()} PADELIX <span>JAKARTA, ID</span></p>
      </section>
      <section className="auth-panel">
        <div className="mobile-brand"><Brand compact /></div>
        <Link href="/" className="auth-back"><ArrowLeft size={16} /> Situs pelanggan</Link>
        <div className="auth-card">
          <div className="step-label">{mode === "login" ? "MASUK STAF" : "PENYIAPAN AWAL"}</div>
          {children}
        </div>
      </section>
    </main>
  );
}
