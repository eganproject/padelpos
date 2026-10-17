import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kwitansi pesanan",
  description: "Kwitansi atau tagihan pesanan lapangan padel, siap dicetak.",
  robots: { index: false, follow: false },
};

export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
  return children;
}
