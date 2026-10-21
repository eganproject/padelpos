import type { Metadata } from "next";
import { brandInfo } from "@/lib/server-data";
import { brandName } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const name = brandName(await brandInfo());
  return {
    title: { default: "Panel admin", template: `%s · Admin ${name}` },
    robots: { index: false, follow: false },
  };
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
