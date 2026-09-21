import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginCard } from "@/components/account-ui";
import { venueInfo } from "@/lib/server-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Masuk",
  description: "Masuk dengan akun Google untuk menyimpan jadwal dan riwayat main Anda.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const data = await venueInfo();
  return (
    <section className="shop-band shop-wrap acct-login-page">
      <Suspense>
        <LoginCard login={data?.login ?? { enabled: false, firebase: null }} venueName={data?.info.name || "venue"} />
      </Suspense>
    </section>
  );
}
