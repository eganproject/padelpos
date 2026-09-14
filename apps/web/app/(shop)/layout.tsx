import Link from "next/link";
import { CalendarDays, Orbit } from "lucide-react";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-page">
      <a className="shop-skip" href="#konten">Lewati ke konten</a>
      <header className="shop-header">
        <div className="shop-header-inner">
          <Link href="/" className="shop-logo" aria-label="Padelix, ke beranda">
            <span className="shop-logo-mark"><Orbit size={20} strokeWidth={2.4} /></span>
            <span className="shop-logo-name">PADEL<span>IX</span></span>
          </Link>
          <nav className="shop-nav" aria-label="Navigasi utama">
            <Link href="/ketersediaan" className="primary">
              <CalendarDays size={16} aria-hidden="true" />
              <span className="long">Cek ketersediaan</span>
              <span className="short">Jadwal</span>
            </Link>
          </nav>
        </div>
      </header>
      <main id="konten" className="shop-main">{children}</main>
      <footer className="shop-footer">
        <div className="shop-footer-inner">
          <div className="shop-footer-brand">
            <span className="shop-logo-name">PADEL<span>IX</span></span>
            <p>Booking lapangan padel dengan jadwal yang selalu terbaru.</p>
          </div>
          <nav className="shop-footer-links" aria-label="Tautan tambahan">
            <Link href="/ketersediaan">Cek ketersediaan</Link>
            <Link href="/login">Masuk staf</Link>
          </nav>
          <p className="shop-footer-copy">© {new Date().getFullYear()} Padelix · Jakarta</p>
        </div>
      </footer>
    </div>
  );
}
