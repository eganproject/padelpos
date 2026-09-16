import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Keranjang",
  description: "Sesi main yang Anda pilih, siap dibayar sekaligus.",
  robots: { index: false, follow: false },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
