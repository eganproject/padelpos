import { Mail, MessageCircle, Phone, Plus } from "lucide-react";
import { RichText } from "./rich-text";
import { refundLines, whatsappLink, type Faq, type Policies, type VenueInfo } from "@/lib/venue-info";

/**
 * Potongan kebijakan dan bantuan. Semuanya digambar di server: `details` membuka
 * dan menutup sendiri tanpa JavaScript, jadi tidak ada satu pun baris skrip yang
 * dikirim untuk bagian ini.
 */

/** Tingkat pengembalian dana sebagai baris dengan persentase yang mudah dipindai. */
export function RefundTiers({ policies }: { policies: Policies }) {
  const lines = refundLines(policies);
  if (!lines.length) return null;
  return (
    <ol className="tiers">
      {lines.map(line => (
        <li key={line.when} className={line.percent === 100 ? "full" : line.percent === 0 ? "none" : "part"}>
          <strong>{line.percent}%</strong>
          <div><b>{line.result}</b><span>{line.when}</span></div>
        </li>
      ))}
    </ol>
  );
}

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="faq">
      {items.map(item => (
        <details key={item.id}>
          <summary>{item.question}<Plus size={18} aria-hidden="true" /></summary>
          <RichText text={item.answer} />
        </details>
      ))}
    </div>
  );
}

export function HelpCard({ info }: { info: VenueInfo }) {
  if (!info.whatsapp && !info.phone && !info.email) return null;
  return (
    <aside className="help-card" aria-label="Bantuan">
      <div>
        <h2>Masih ada pertanyaan?</h2>
        <p>Tim {info.name || "venue"} siap membantu sebelum Anda memesan.</p>
      </div>
      <div className="actions">
        {info.whatsapp && (
          <a className="shop-btn primary" href={whatsappLink(info.whatsapp, `Halo${info.name ? ` ${info.name}` : ""}, saya ingin bertanya tentang booking lapangan.`)} target="_blank" rel="noopener">
            <MessageCircle size={18} aria-hidden="true" /> Chat WhatsApp
          </a>
        )}
        {info.phone && <a className="shop-btn outline" href={`tel:${info.phone.replace(/[^0-9+]/g, "")}`}><Phone size={17} aria-hidden="true" /> Telepon</a>}
        {info.email && <a className="shop-btn outline" href={`mailto:${info.email}`}><Mail size={17} aria-hidden="true" /> Email</a>}
      </div>
    </aside>
  );
}
