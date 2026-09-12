import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import "./admin-ui.css";
import "./management.css";
import "./operations.css";

export const metadata: Metadata = {
  title: "Padelix — Court Management",
  description: "Modern padel court management platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster theme="dark" richColors position="top-right" />
      </body>
    </html>
  );
}
