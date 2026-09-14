"use client";

import Link from "next/link";
import { MessageCircle, ScrollText } from "lucide-react";
import { RichText } from "@/components/rich-text";
import { HelpCard, RefundTiers, useScrollToHash } from "@/components/shop-policy";
import { useVenueInfo } from "@/lib/use-venue-info";
import { formatUpdated, hasCancellationPolicy, hasPolicies, refundDaysLine, rescheduleLine, whatsappLink } from "@/lib/venue-info";

export default function PolicyPage() {
  const { data, failed } = useVenueInfo();
  useScrollToHash(!!data);

  if (failed) return <section className="shop-section shop-doc"><p className="shop-note error" role="alert">Kebijakan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p></section>;
  if (!data) return <section className="shop-section shop-doc" aria-busy="true"><div className="shop-doc-card skeleton" /><div className="shop-doc-card skeleton" /></section>;

  const { info, policies } = data;
  const cancellation = hasCancellationPolicy(policies);
  const notes = [rescheduleLine(policies), refundDaysLine(policies)].filter(Boolean) as string[];

  return (
    <section className="shop-section shop-doc">
      <header className="shop-doc-head">
        <span className="shop-eyebrow"><ScrollText size={14} aria-hidden="true" /> KEBIJAKAN</span>
        <h1>Kebijakan & ketentuan</h1>
        <p>
          {info.name ? `Berlaku untuk semua pemesanan di ${info.name}.` : "Berlaku untuk semua pemesanan lapangan."}
          {policies.updated_at && ` Terakhir diperbarui ${formatUpdated(policies.updated_at)}.`}
        </p>
        {cancellation && policies.terms && (
          <nav className="shop-doc-toc" aria-label="Isi halaman">
            <a href="#pembatalan">Pembatalan & pengembalian dana</a>
            <a href="#ketentuan">Syarat & ketentuan</a>
          </nav>
        )}
      </header>

      {!hasPolicies(policies) ? (
        <div className="shop-doc-card">
          <p>Venue belum menerbitkan kebijakan tertulis. Tanyakan aturan pembatalan langsung ke venue sebelum memesan.</p>
          {info.whatsapp && (
            <a className="shop-ghost" href={whatsappLink(info.whatsapp, "Halo, saya ingin menanyakan aturan pembatalan booking.")} target="_blank" rel="noopener">
              <MessageCircle size={17} aria-hidden="true" /> Tanyakan lewat WhatsApp
            </a>
          )}
        </div>
      ) : (
        <>
          {cancellation && (
            <article id="pembatalan" className="shop-doc-card">
              <h2>Pembatalan & pengembalian dana</h2>
              <RefundTiers policies={policies} />
              {notes.length > 0 && <ul className="shop-doc-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
              {policies.cancellation_note && <RichText text={policies.cancellation_note} className="shop-doc-text" />}
            </article>
          )}
          {policies.terms && (
            <article id="ketentuan" className="shop-doc-card">
              <h2>Syarat & ketentuan</h2>
              <RichText text={policies.terms} className="shop-doc-text" />
            </article>
          )}
        </>
      )}

      {data.faqs.length > 0 && <p className="shop-doc-more">Punya pertanyaan lain? Lihat <Link href="/faq">pertanyaan yang sering diajukan</Link>.</p>}
      <HelpCard info={info} />
    </section>
  );
}
