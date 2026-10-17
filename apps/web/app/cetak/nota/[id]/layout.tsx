import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cetak nota",
  robots: { index: false, follow: false },
};

export default function ReceiptPrintLayout({ children }: { children: React.ReactNode }) {
  return children;
}
