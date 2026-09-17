import Link from "next/link";
import { ArrowLeft, CalendarDays, Orbit } from "lucide-react";

export const metadata = { title: "Halaman tidak ditemukan" };

/** Digambar di luar rangka situs pelanggan, jadi kepala halamannya dibuat sendiri di sini. */
export default function NotFound() {
  return (
    <div className="shop">
      <header className="shop-head solid">
        <div className="shop-head-inner shop-wrap">
          <Link href="/" className="shop-brand" aria-label="Padelix, ke beranda">
            <span className="shop-brand-mark"><Orbit size={20} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="shop-brand-name">PADEL<span>IX</span></span>
          </Link>
        </div>
      </header>
      <main className="shop-body">
        <div className="shop-wrap shop-404">
          <span className="shop-eyebrow">Kode 404</span>
          <h1>Halaman ini tidak ada.</h1>
          <p>Tautannya mungkin salah ketik atau halamannya sudah dipindahkan. Jadwal lapangan tetap bisa Anda cek dari sini.</p>
          <div className="actions">
            <Link className="shop-btn primary" href="/ketersediaan"><CalendarDays size={18} aria-hidden="true" /> Cek ketersediaan</Link>
            <Link className="shop-btn outline" href="/"><ArrowLeft size={18} aria-hidden="true" /> Ke beranda</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
