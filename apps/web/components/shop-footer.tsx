import Link from "next/link";
import { AtSign, Clock3, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { formatWhatsapp, whatsappLink, type VenueInfo } from "@/lib/venue-info";

/** Kaki halaman digambar di server: isinya tetap dan tidak menunggu permintaan dari browser. */
export function ShopFooter({ info, hasFaq, hasPolicies }: { info: VenueInfo | null; hasFaq: boolean; hasPolicies: boolean }) {
  const year = new Date().getFullYear();
  const contactable = !!info && !!(info.whatsapp || info.phone || info.email || info.instagram);
  return (
    <footer className="shop-foot">
      <div className="shop-wrap shop-foot-inner">
        <div className="shop-foot-brand">
          <span className="shop-brand-name">{info?.name || <>PADEL<span>IX</span></>}</span>
          <p>{info?.tagline || "Booking lapangan padel dengan jadwal yang selalu terbaru."}</p>
          {info && (info.address || info.hours_note) && (
            <ul className="shop-foot-facts">
              {info.address && <li><MapPin size={15} aria-hidden="true" /> {info.address}</li>}
              {info.hours_note && <li><Clock3 size={15} aria-hidden="true" /> {info.hours_note}</li>}
            </ul>
          )}
        </div>

        {contactable && info && (
          <div>
            <h2>Hubungi kami</h2>
            <ul>
              {info.whatsapp && <li><a href={whatsappLink(info.whatsapp)} target="_blank" rel="noopener"><MessageCircle size={15} aria-hidden="true" /> WhatsApp {formatWhatsapp(info.whatsapp)}</a></li>}
              {info.phone && <li><a href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}><Phone size={15} aria-hidden="true" /> {info.phone}</a></li>}
              {info.email && <li><a href={`mailto:${info.email}`}><Mail size={15} aria-hidden="true" /> {info.email}</a></li>}
              {info.instagram && <li><a href={`https://instagram.com/${info.instagram}`} target="_blank" rel="noopener"><AtSign size={15} aria-hidden="true" /> {info.instagram}</a></li>}
            </ul>
          </div>
        )}

        <div>
          <h2>Informasi</h2>
          <nav aria-label="Tautan tambahan">
            <Link href="/ketersediaan">Cek ketersediaan</Link>
            <Link href="/keranjang">Keranjang</Link>
            {hasFaq && <Link href="/faq">FAQ</Link>}
            {hasPolicies && <Link href="/kebijakan">Kebijakan & ketentuan</Link>}
            <Link href="/login">Masuk staf</Link>
          </nav>
        </div>
      </div>
      <p className="shop-wrap shop-foot-copy">© {year} {info?.name || "Padelix"}</p>
    </footer>
  );
}
