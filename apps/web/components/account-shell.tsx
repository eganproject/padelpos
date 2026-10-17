"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Bell, CalendarDays, History, LayoutDashboard, UserRound } from "lucide-react";
import { useAccount, useUnread } from "@/lib/account";
import { Avatar } from "./shop-header";
import { ProfileForm } from "./account-ui";

const tabs = [
  { href: "/akun", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/akun/pesanan", label: "Pesanan", icon: History },
  { href: "/akun/notifikasi", label: "Notifikasi", icon: Bell },
  { href: "/akun/profil", label: "Profil", icon: UserRound },
];

/**
 * Kerangka area akun. Tamu diarahkan ke halaman masuk lalu dikembalikan ke sini;
 * akun yang belum punya nomor WhatsApp diminta melengkapinya dulu sebelum isi halaman.
 */
export function AccountShell({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const unread = useUnread();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (account === null) router.replace(`/masuk?lanjut=${encodeURIComponent(pathname)}`);
  }, [account, pathname, router]);

  if (!account) {
    return (
      <section className="shop-band shop-wrap" aria-busy="true" aria-label="Memuat akun">
        <div className="skeleton" style={{ minHeight: 120, marginBottom: 20 }} />
        <div className="skeleton" style={{ minHeight: 260 }} />
      </section>
    );
  }

  if (account.needs_profile) {
    return (
      <section className="shop-band shop-wrap acct-login-page">
        <div className="acct-login">
          <span className="acct-step">Satu langkah lagi</span>
          <h1>Lengkapi profil Anda</h1>
          <p>Nomor WhatsApp dibutuhkan venue untuk mengonfirmasi jadwal main.</p>
          <ProfileForm account={account} submitLabel="Simpan dan lanjutkan" />
        </div>
      </section>
    );
  }

  const active = (href: string) => (href === "/akun" ? pathname === "/akun" : pathname.startsWith(href));
  return (
    <section className="shop-band shop-wrap acct">
      <header className="acct-head">
        <Avatar account={account} size={56} />
        <div>
          <h1>Halo, {account.name.split(" ")[0]}</h1>
          <p><span className="email">{account.email}</span>{account.phone && <span className="phone">{account.phone}</span>}</p>
        </div>
        <Link className="shop-btn primary sm" href="/ketersediaan"><CalendarDays size={16} aria-hidden="true" /> Pesan jadwal</Link>
      </header>
      <nav className="acct-tabs" aria-label="Menu akun">
        {tabs.map(tab => (
          <Link key={tab.href} href={tab.href} aria-current={active(tab.href) ? "page" : undefined}>
            <tab.icon size={17} aria-hidden="true" /> <span className="label">{tab.label}</span>
            {tab.href === "/akun/notifikasi" && unread > 0 && <em className="acct-tab-count" aria-label={`${unread} belum dibaca`}>{unread > 9 ? "9+" : unread}</em>}
          </Link>
        ))}
      </nav>
      {children}
    </section>
  );
}
