import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { ShopBrand } from "@/components/shop-header";

export const metadata = { title: "Halaman tidak ditemukan" };

/** Digambar di luar rangka situs pelanggan, jadi kepala halamannya dibuat sendiri di sini. */
export default function NotFound() {
  return (
    <div className="shop">
      <header className="shop-head">
        <div className="shop-head-inner shop-wrap"><ShopBrand name="Padelix" /></div>
      </header>
      <main className="shop-body">
        <div className="shop-wrap empty-state">
          <span className="empty-icon">404</span>
          <h1>Halaman ini tidak ada</h1>
          <p>Tautannya mungkin salah ketik atau halamannya sudah dipindahkan. Jadwal lapangan tetap bisa Anda cek dari sini.</p>
          <div className="btn-row center">
            <Link className="shop-btn primary" href="/ketersediaan"><CalendarDays size={18} aria-hidden="true" /> Lihat jadwal</Link>
            <Link className="shop-btn outline" href="/"><ArrowLeft size={18} aria-hidden="true" /> Ke beranda</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
