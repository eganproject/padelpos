import Link from "next/link";
import { ArrowLeft, CalendarDays, Orbit } from "lucide-react";

export const metadata = { title: "Halaman tidak ditemukan" };

export default function NotFound() {
  return (
    <div className="shop-page">
      <header className="shop-header">
        <div className="shop-header-inner">
          <Link href="/" className="shop-logo">
            <span className="shop-logo-mark"><Orbit size={20} strokeWidth={2.4} /></span>
            <span className="shop-logo-name">PADEL<span>IX</span></span>
          </Link>
        </div>
      </header>
      <main className="shop-notfound">
        <span className="shop-eyebrow">KODE 404</span>
        <h1>Halaman ini tidak ada.</h1>
        <p>Tautannya mungkin salah ketik atau halamannya sudah dipindahkan. Jadwal lapangan tetap bisa Anda cek dari sini.</p>
        <div className="shop-notfound-actions">
          <Link className="shop-cta" href="/ketersediaan"><CalendarDays size={18} /> Cek ketersediaan</Link>
          <Link className="shop-ghost" href="/"><ArrowLeft size={18} /> Ke beranda</Link>
        </div>
      </main>
    </div>
  );
}
