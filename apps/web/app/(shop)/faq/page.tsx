"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { FaqList, HelpCard } from "@/components/shop-policy";
import { useVenueInfo } from "@/lib/use-venue-info";
import { hasPolicies } from "@/lib/venue-info";

export default function FaqPage() {
  const { data, failed } = useVenueInfo();

  if (failed) return <section className="shop-section shop-doc"><p className="shop-note error" role="alert">Pertanyaan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p></section>;
  if (!data) return <section className="shop-section shop-doc" aria-busy="true"><div className="shop-doc-card skeleton" /></section>;

  const { info, faqs, policies } = data;
  return (
    <section className="shop-section shop-doc">
      <header className="shop-doc-head">
        <span className="shop-eyebrow"><HelpCircle size={14} aria-hidden="true" /> FAQ</span>
        <h1>Pertanyaan yang sering diajukan</h1>
        <p>Jawaban singkat seputar pemesanan dan fasilitas{info.name ? ` di ${info.name}` : ""}.</p>
      </header>
      {faqs.length > 0
        ? <FaqList items={faqs} />
        : <div className="shop-doc-card"><p>Belum ada pertanyaan yang dipublikasikan.</p></div>}
      {hasPolicies(policies) && <p className="shop-doc-more">Aturan pembatalan dan pengembalian dana lengkap ada di <Link href="/kebijakan">halaman kebijakan</Link>.</p>}
      <HelpCard info={info} />
    </section>
  );
}
