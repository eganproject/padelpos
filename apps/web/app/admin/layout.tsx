import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Panel admin", template: "%s · Admin Padelix" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
