import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Jawaban atas pertanyaan yang sering diajukan seputar booking lapangan padel.",
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return children;
}
