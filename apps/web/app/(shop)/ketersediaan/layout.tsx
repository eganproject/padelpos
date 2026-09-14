import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cek ketersediaan lapangan",
  description: "Lihat slot kosong di setiap lapangan padel, pilih jam dan durasi, lalu lihat total biayanya.",
};

export default function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
