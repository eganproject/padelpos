import Link from "next/link";
import { AtSign, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { formatWhatsapp, whatsappLink, type VenueInfo } from "@/lib/venue-info";

/** Kaki halaman digambar di server: isinya tetap dan tidak menunggu permintaan dari browser. */
export function ShopFooter({ info, hasFaq, hasPolicies }: { info: VenueInfo | null; hasFaq: boolean; hasPolicies: boolean }) {
  const year = new Date().getFullYear();
  const name = info?.name?.trim() || "Padelix";
  return (
    <footer className="shop-foot">
      <div className="shop-wrap shop-foot-inner">
        <div className="shop-foot-brand">
          <b>{name}</b>
          <p>{info?.tagline || "Booking lapangan padel dengan jadwal yang selalu terbaru."}</p>
          {info?.address && <p className="addr"><MapPin size={15} aria-hidden="true" /> {info.address}</p>}
        </div>
        <nav className="shop-foot-links" aria-label="Tautan tambahan">
          <Link href="/ketersediaan">Jadwal & booking</Link>
          <Link href="/keranjang">Keranjang</Link>
          {hasFaq && <Link href="/faq">Pertanyaan umum</Link>}
          {hasPolicies && <Link href="/kebijakan">Kebijakan & ketentuan</Link>}
          <Link href="/login">Masuk staf</Link>
        </nav>
        {info && (info.whatsapp || info.phone || info.email || info.instagram) && (
          <div className="shop-foot-contact">
            {info.whatsapp && <a href={whatsappLink(info.whatsapp)} target="_blank" rel="noopener"><MessageCircle size={16} aria-hidden="true" /> {formatWhatsapp(info.whatsapp)}</a>}
            {info.phone && <a href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}><Phone size={16} aria-hidden="true" /> {info.phone}</a>}
            {info.email && <a href={`mailto:${info.email}`}><Mail size={16} aria-hidden="true" /> {info.email}</a>}
            {info.instagram && <a href={`https://instagram.com/${info.instagram}`} target="_blank" rel="noopener"><AtSign size={16} aria-hidden="true" /> {info.instagram}</a>}
          </div>
        )}
      </div>
      <p className="shop-wrap shop-foot-copy">© {year} {name}</p>
    </footer>
  );
}
