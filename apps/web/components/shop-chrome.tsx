"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtSign, CalendarDays, Clock3, Mail, MapPin, MessageCircle, Phone, ShoppingBag } from "lucide-react";
import { useVenueInfo } from "@/lib/use-venue-info";
import { useCart } from "@/lib/cart";
import { formatWhatsapp, hasPolicies, whatsappLink } from "@/lib/venue-info";

/** Navigasi atas. Tautan Lokasi dan FAQ hanya muncul bila admin sudah mengisinya. */
export function ShopNav() {
  const { data } = useVenueInfo();
  const pathname = usePathname();
  const cart = useCart();
  const hasLocation = !!data?.info.address;
  return (
    <nav className="shop-nav" aria-label="Navigasi utama">
      <Link href="/#lapangan" className="link">Lapangan</Link>
      {hasLocation && <Link href="/#lokasi" className="link">Lokasi</Link>}
      {!!data?.faqs.length && <Link href="/faq" className="link" aria-current={pathname === "/faq" ? "page" : undefined}>FAQ</Link>}
      <Link href="/keranjang" className="shop-cart-button" aria-current={pathname === "/keranjang" ? "page" : undefined}
        aria-label={cart.length ? `Keranjang, ${cart.length} sesi` : "Keranjang, masih kosong"}>
        <ShoppingBag size={17} aria-hidden="true" />
        <span className="long">Keranjang</span>
        {cart.length > 0 && <em aria-hidden="true">{cart.length}</em>}
      </Link>
      <Link href="/ketersediaan" className="primary" aria-current={pathname === "/ketersediaan" ? "page" : undefined}>
        <CalendarDays size={16} aria-hidden="true" />
        <span className="long">Cek ketersediaan</span>
        <span className="short">Jadwal</span>
      </Link>
    </nav>
  );
}

export function ShopFooter() {
  const { data } = useVenueInfo();
  const info = data?.info;
  const year = new Date().getFullYear();
  return (
    <footer className="shop-footer">
      <div className="shop-footer-inner">
        <div className="shop-footer-brand">
          <span className="shop-logo-name">{info?.name ? info.name : <>PADEL<span>IX</span></>}</span>
          <p>{info?.tagline || "Booking lapangan padel dengan jadwal yang selalu terbaru."}</p>
          {info && (info.address || info.hours_note) && (
            <ul className="shop-footer-facts">
              {info.address && <li><MapPin size={15} aria-hidden="true" /> {info.address}</li>}
              {info.hours_note && <li><Clock3 size={15} aria-hidden="true" /> {info.hours_note}</li>}
            </ul>
          )}
        </div>
        {info && (info.whatsapp || info.phone || info.email || info.instagram) && (
          <div className="shop-footer-contact">
            <h2>Hubungi kami</h2>
            <ul>
              {info.whatsapp && <li><a href={whatsappLink(info.whatsapp)} target="_blank" rel="noopener"><MessageCircle size={15} aria-hidden="true" /> WhatsApp {formatWhatsapp(info.whatsapp)}</a></li>}
              {info.phone && <li><a href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}><Phone size={15} aria-hidden="true" /> {info.phone}</a></li>}
              {info.email && <li><a href={`mailto:${info.email}`}><Mail size={15} aria-hidden="true" /> {info.email}</a></li>}
              {info.instagram && <li><a href={`https://instagram.com/${info.instagram}`} target="_blank" rel="noopener"><AtSign size={15} aria-hidden="true" /> {info.instagram}</a></li>}
            </ul>
          </div>
        )}
        <nav className="shop-footer-links" aria-label="Tautan tambahan">
          <h2>Informasi</h2>
          <Link href="/ketersediaan">Cek ketersediaan</Link>
          {!!data?.faqs.length && <Link href="/faq">FAQ</Link>}
          {data && hasPolicies(data.policies) && <Link href="/kebijakan">Kebijakan & ketentuan</Link>}
          <Link href="/login">Masuk staf</Link>
        </nav>
        <p className="shop-footer-copy">© {year} {info?.name || "Padelix"}</p>
      </div>
    </footer>
  );
}
