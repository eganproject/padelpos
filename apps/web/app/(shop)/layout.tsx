import Link from "next/link";
import { Orbit } from "lucide-react";
import { ShopFooter, ShopNav } from "@/components/shop-chrome";

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
          <ShopNav />
        </div>
      </header>
      <main id="konten" className="shop-main">{children}</main>
      <ShopFooter />
    </div>
  );
}
