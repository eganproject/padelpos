import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status pesanan",
  description: "Status pembayaran dan rincian pesanan lapangan padel Anda.",
  robots: { index: false, follow: false },
};

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
