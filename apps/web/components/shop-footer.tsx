import Link from "next/link";
import { AtSign, Facebook, Globe, Mail, MapPin, MessageCircle, Music2, Phone, Youtube } from "lucide-react";
import { formatWhatsapp, whatsappLink, type VenueInfo } from "@/lib/venue-info";
import { assetUrl, brandName, copyrightLine, defaultTagline, type PublicBrand } from "@/lib/brand";

/** Tampilkan alamat tautan tanpa https:// dan garis miring akhir. */
const shortUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");

/** Kaki halaman digambar di server: isinya tetap dan tidak menunggu permintaan dari browser. */
export function ShopFooter({ info, brand, hasFaq, hasPolicies }: { info: VenueInfo | null; brand: PublicBrand | null; hasFaq: boolean; hasPolicies: boolean }) {
  const name = brandName(info);
  // Latar kaki halaman berwarna gelap: logo versi gelap lebih dulu, logo biasa diberi alas terang.
  const logo = brand?.logo_dark ?? brand?.logo ?? null;
  const contacts = info ? [
    info.whatsapp && { href: whatsappLink(info.whatsapp), icon: MessageCircle, label: formatWhatsapp(info.whatsapp), external: true },
    info.phone && { href: `tel:${info.phone.replace(/[^0-9+]/g, "")}`, icon: Phone, label: info.phone },
    info.email && { href: `mailto:${info.email}`, icon: Mail, label: info.email },
    info.instagram && { href: `https://instagram.com/${info.instagram}`, icon: AtSign, label: `@${info.instagram}`, external: true },
    info.tiktok && { href: `https://www.tiktok.com/@${info.tiktok}`, icon: Music2, label: `TikTok @${info.tiktok}`, external: true },
    info.facebook && { href: info.facebook, icon: Facebook, label: "Facebook", external: true },
    info.youtube && { href: info.youtube, icon: Youtube, label: "YouTube", external: true },
    info.website && { href: info.website, icon: Globe, label: shortUrl(info.website), external: true },
  ].filter(Boolean) as { href: string; icon: typeof Phone; label: string; external?: boolean }[] : [];
  return (
    <footer className="shop-foot">
      <div className="shop-wrap shop-foot-inner">
        <div className="shop-foot-brand">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element -- logo kecil dari API sendiri
            <img className={`shop-foot-logo${brand?.logo_dark ? "" : " on-light"}`} src={assetUrl(logo)} alt={brand?.show_name ? "" : name} />
          )}
          {(!logo || brand?.show_name) && <b>{name}</b>}
          <p>{info?.tagline || defaultTagline}</p>
          {info?.address && <p className="addr"><MapPin size={15} aria-hidden="true" /> {info.address}</p>}
        </div>
        <nav className="shop-foot-links" aria-label="Tautan tambahan">
          <Link href="/ketersediaan">Jadwal & booking</Link>
          <Link href="/keranjang">Keranjang</Link>
          {hasFaq && <Link href="/faq">Pertanyaan umum</Link>}
          {hasPolicies && <Link href="/kebijakan">Kebijakan & ketentuan</Link>}
          <Link href="/login">Masuk staf</Link>
        </nav>
        {contacts.length > 0 && (
          <div className="shop-foot-contact">
            {contacts.map(item => (
              <a key={item.href} href={item.href} {...(item.external ? { target: "_blank", rel: "noopener" } : {})}>
                <item.icon size={16} aria-hidden="true" /> {item.label}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="shop-wrap shop-foot-copy">
        <p>{copyrightLine({ name, copyright: brand?.copyright })}</p>
        {brand?.footer_text && <p className="shop-foot-note">{brand.footer_text}</p>}
      </div>
    </footer>
  );
}
