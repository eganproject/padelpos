import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, ScrollText } from "lucide-react";
import { RichText } from "@/components/rich-text";
import { HelpCard, RefundTiers } from "@/components/shop-policy";
import { venueInfo } from "@/lib/server-data";
import { formatUpdated, hasCancellationPolicy, hasPolicies, refundDaysLine, rescheduleLine, whatsappLink } from "@/lib/venue-info";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Kebijakan & ketentuan",
  description: "Aturan pembatalan, pengembalian dana, ubah jadwal, serta syarat dan ketentuan bermain.",
};

export default async function PolicyPage() {
  const data = await venueInfo();
  if (!data) {
    return (
      <section className="shop-band">
        <div className="shop-wrap doc">
          <p className="shop-note error" role="alert">Kebijakan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p>
        </div>
      </section>
    );
  }

  const { info, policies } = data;
  const cancellation = hasCancellationPolicy(policies);
  const notes = [rescheduleLine(policies), refundDaysLine(policies)].filter(Boolean) as string[];

  return (
    <section className="shop-band">
      <div className="shop-wrap doc">
        <header className="doc-head">
          <span className="shop-eyebrow"><ScrollText size={14} aria-hidden="true" /> Kebijakan</span>
          <h1>Kebijakan & ketentuan</h1>
          <p>
            {info.name ? `Berlaku untuk semua pemesanan di ${info.name}.` : "Berlaku untuk semua pemesanan lapangan."}
            {policies.updated_at && ` Terakhir diperbarui ${formatUpdated(policies.updated_at)}.`}
          </p>
          {cancellation && policies.terms && (
            <nav className="doc-toc" aria-label="Isi halaman">
              <a href="#pembatalan">Pembatalan & pengembalian dana</a>
              <a href="#ketentuan">Syarat & ketentuan</a>
            </nav>
          )}
        </header>

        {!hasPolicies(policies) ? (
          <div className="doc-card">
            <p>Venue belum menerbitkan kebijakan tertulis. Tanyakan aturan pembatalan langsung ke venue sebelum memesan.</p>
            {info.whatsapp && (
              <a className="shop-btn outline" href={whatsappLink(info.whatsapp, "Halo, saya ingin menanyakan aturan pembatalan booking.")} target="_blank" rel="noopener">
                <MessageCircle size={17} aria-hidden="true" /> Tanyakan lewat WhatsApp
              </a>
            )}
          </div>
        ) : (
          <>
            {cancellation && (
              <article id="pembatalan" className="doc-card">
                <h2>Pembatalan & pengembalian dana</h2>
                <RefundTiers policies={policies} />
                {notes.length > 0 && <ul className="doc-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
                {policies.cancellation_note && <RichText text={policies.cancellation_note} className="doc-text" />}
              </article>
            )}
            {policies.terms && (
              <article id="ketentuan" className="doc-card">
                <h2>Syarat & ketentuan</h2>
                <RichText text={policies.terms} className="doc-text" />
              </article>
            )}
          </>
        )}

        {data.faqs.length > 0 && <p className="doc-more">Punya pertanyaan lain? Lihat <Link href="/faq">pertanyaan yang sering diajukan</Link>.</p>}
        <HelpCard info={info} />
      </div>
    </section>
  );
}
