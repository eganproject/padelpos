import Link from "next/link";
import { Orbit } from "lucide-react";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-page">
      <header className="shop-header">
        <div className="shop-header-inner">
          <Link href="/" className="shop-logo">
            <span className="shop-logo-mark"><Orbit size={20} strokeWidth={2.4} /></span>
            <span className="shop-logo-name">PADEL<span>IX</span></span>
          </Link>
          <nav className="shop-nav">
            <Link href="/ketersediaan">Cek ketersediaan</Link>
            <Link href="/login" className="staff">Masuk staf</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="shop-footer">
        <div className="shop-footer-inner">
          <span>© {new Date().getFullYear()} Padelix · Jakarta</span>
          <span className="spacer" />
          <Link href="/ketersediaan">Cek ketersediaan</Link>
          <Link href="/login">Masuk staf</Link>
        </div>
      </footer>
    </div>
  );
}
