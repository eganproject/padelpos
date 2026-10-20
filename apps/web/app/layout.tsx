import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
/* Panel staf lebih dulu, lalu situs pelanggan. Urutan ini disengaja: aturan
   .shop ditulis terakhir sehingga tema terang/gelap staf tidak pernah merembes
   ke halaman pelanggan lewat elemen yang dipakai bersama. */
import "flatpickr/dist/flatpickr.css";
import "./tokens.css";
import "./globals.css";
import "./management.css";
import "./operations.css";
import "./layout-editor.css";
import "./admin-content.css";
import "./addons.css";
import "./members.css";
import "./payments.css";
import "./finance.css";
import "./form-controls.css";
import "./receipt.css";
import "./shop.css";
import "./shop-home.css";
import "./shop-booking.css";
import "./shop-checkout.css";
import "./shop-account.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Padelix — Booking Lapangan Padel", template: "%s · Padelix" },
  description: "Cek ketersediaan lapangan padel dan pesan jam main Anda secara online.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#090c0e" }, { media: "(prefers-color-scheme: light)", color: "#f2f4f0" }],
};

/**
 * Tema panel staf dipasang sebelum halaman digambar. Tanpa ini, tema terang sempat
 * berkedip gelap lebih dulu dan React melaporkan beda isi antara server dan browser.
 */
const themeBoot = `try{var t=localStorage.getItem("padelix_theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${inter.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBoot }} /></head>
      <body>
        {children}
        <Toaster theme="dark" richColors position="top-right" closeButton />
      </body>
    </html>
  );
}
