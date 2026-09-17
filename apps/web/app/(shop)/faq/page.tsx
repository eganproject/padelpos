import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { FaqList, HelpCard } from "@/components/shop-policy";
import { venueInfo } from "@/lib/server-data";
import { hasPolicies } from "@/lib/venue-info";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "FAQ",
  description: "Jawaban atas pertanyaan yang sering diajukan seputar booking lapangan padel.",
};

export default async function FaqPage() {
  const data = await venueInfo();

  return (
    <section className="shop-band">
      <div className="shop-wrap doc">
        <header className="doc-head">
          <span className="shop-eyebrow"><HelpCircle size={14} aria-hidden="true" /> FAQ</span>
          <h1>Pertanyaan yang sering diajukan</h1>
          <p>Jawaban singkat seputar pemesanan dan fasilitas{data?.info.name ? ` di ${data.info.name}` : ""}.</p>
        </header>

        {!data ? (
          <p className="shop-note error" role="alert">Pertanyaan belum dapat dimuat. Periksa koneksi Anda lalu muat ulang halaman.</p>
        ) : (
          <>
            {data.faqs.length > 0
              ? <FaqList items={data.faqs} />
              : <div className="doc-card"><p>Belum ada pertanyaan yang dipublikasikan.</p></div>}
            {hasPolicies(data.policies) && (
              <p className="doc-more">Aturan pembatalan dan pengembalian dana lengkap ada di <Link href="/kebijakan">halaman kebijakan</Link>.</p>
            )}
            <HelpCard info={data.info} />
          </>
        )}
      </div>
    </section>
  );
}
