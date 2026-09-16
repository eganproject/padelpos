import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import "./admin-ui.css";
import "./management.css";
import "./operations.css";
import "./layout-editor.css";
import "./admin-polish.css";
import "./admin-content.css";
import "./shop.css";
import "./shop-content.css";
import "./addons.css";
import "./payments.css";
import "./cart.css";
import "./finance.css";

// Variabel ini sudah lama dirujuk seluruh CSS, tetapi fontnya belum pernah dimuat.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Padelix — Booking Lapangan Padel", template: "%s · Padelix" },
  description: "Cek ketersediaan lapangan padel dan pesan jam main Anda secara online.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        {children}
        <Toaster theme="dark" richColors position="top-right" />
      </body>
    </html>
  );
}
