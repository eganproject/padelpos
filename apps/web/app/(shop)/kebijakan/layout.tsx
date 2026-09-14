import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kebijakan & ketentuan",
  description: "Aturan pembatalan, pengembalian dana, ubah jadwal, serta syarat dan ketentuan bermain.",
};

export default function PolicyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
