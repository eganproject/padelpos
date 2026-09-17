import { ShopFooter } from "@/components/shop-footer";
import { ShopHeader } from "@/components/shop-header";
import { venueInfo } from "@/lib/server-data";
import { hasPolicies } from "@/lib/venue-info";

/**
 * Rangka situs pelanggan. Profil venue diambil di server sehingga kepala dan kaki
 * halaman sudah berisi nama, kontak, dan tautan yang benar pada gambar pertama —
 * tidak ada teks yang berganti sendiri setelah halaman tampil.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const data = await venueInfo();
  const info = data?.info ?? null;
  const faqs = data?.faqs.length ?? 0;
  const policies = !!data && hasPolicies(data.policies);

  return (
    <div className="shop">
      <a className="shop-skip" href="#konten">Lewati ke konten</a>
      <ShopHeader name={info?.name || "Padelix"} hasLocation={!!info?.address} hasFaq={faqs > 0} hasPolicies={policies} />
      <main id="konten" className="shop-body">{children}</main>
      <ShopFooter info={info} hasFaq={faqs > 0} hasPolicies={policies} />
    </div>
  );
}
