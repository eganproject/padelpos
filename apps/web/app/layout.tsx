import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import "./admin-ui.css";
import "./management.css";
import "./operations.css";
import "./shop.css";

// Variabel ini sudah lama dirujuk seluruh CSS, tetapi fontnya belum pernah dimuat.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap" });

export const metadata: Metadata = {
  title: "Padelix — Booking Lapangan Padel",
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
