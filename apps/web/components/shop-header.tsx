"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, CircleUserRound, House, LifeBuoy, Orbit, ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useAccount, useUnread, type Account } from "@/lib/account";

export type ShopNavProps = {
  /** Nama venue: tampil di kepala halaman dan dipakai sebagai label aksesibilitas. */
  name: string;
  hasLocation: boolean;
  hasFaq: boolean;
  hasPolicies: boolean;
  /** Tombol Masuk hanya muncul bila admin sudah menyiapkan login Google. */
  loginEnabled: boolean;
};

/** Foto unggahan pelanggan atau foto Google; tanpa foto, inisial nama. */
export function Avatar({ account, size = 32 }: { account: Pick<Account, "name" | "photo_url">; size?: number }) {
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
  return (
    <span className="shop-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- foto profil kecil (Google atau unggahan sendiri) */}
      {account.photo_url ? <img src={account.photo_url} alt="" referrerPolicy="no-referrer" /> : initials}
    </span>
  );
}

export function ShopBrand({ name }: { name: string }) {
  return (
    <Link href="/" className="shop-brand" aria-label={`${name}, ke beranda`}>
      <span className="shop-brand-mark"><Orbit size={18} strokeWidth={2.4} aria-hidden="true" /></span>
      <span className="shop-brand-name">{name}</span>
    </Link>
  );
}

const loginHref = (pathname: string) => `/masuk?lanjut=${encodeURIComponent(pathname === "/masuk" ? "/akun" : pathname)}`;

/**
 * Kepala halaman. Di layar lebar berisi navigasi lengkap; di ponsel hanya merek,
 * keranjang, dan akun, karena perpindahan halaman utama ada di bilah bawah.
 */
export function ShopHeader({ name, hasLocation, hasFaq, loginEnabled }: ShopNavProps) {
  const pathname = usePathname();
  const cart = useCart();
  const account = useAccount();
  const unread = useUnread();

  const links = [
    { href: "/ketersediaan", label: "Jadwal & booking" },
    { href: "/#lapangan", label: "Lapangan" },
    ...(hasLocation ? [{ href: "/#lokasi", label: "Lokasi" }] : []),
    ...(hasFaq ? [{ href: "/faq", label: "Bantuan" }] : []),
  ];
  const current = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <header className="shop-head">
      <div className="shop-head-inner shop-wrap">
        <ShopBrand name={name} />
        <nav className="shop-nav" aria-label="Navigasi utama">
          {links.map(link => <Link key={link.href} href={link.href} aria-current={current(link.href)}>{link.label}</Link>)}
        </nav>
        <div className="shop-head-actions">
          <Link href="/keranjang" className="shop-icon-btn" aria-current={current("/keranjang")}
            aria-label={cart.length ? `Keranjang, ${cart.length} sesi` : "Keranjang, masih kosong"}>
            <ShoppingBag size={20} aria-hidden="true" />
            {cart.length > 0 && <em className="shop-badge" aria-hidden="true">{cart.length}</em>}
          </Link>
          {account && (
            <Link href="/akun/notifikasi" className="shop-icon-btn" aria-current={current("/akun/notifikasi")}
              aria-label={unread ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}>
              <Bell size={20} aria-hidden="true" />
              {unread > 0 && <em className="shop-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</em>}
            </Link>
          )}
          {account ? (
            <Link href="/akun" className="shop-icon-btn account" aria-current={pathname.startsWith("/akun") ? "page" : undefined} aria-label={`Akun saya, ${account.name}`}>
              <Avatar account={account} size={30} />
            </Link>
          ) : loginEnabled && account === null ? (
            <Link href={loginHref(pathname)} className="shop-btn ghost sm shop-login" aria-current={current("/masuk")}>
              <CircleUserRound size={18} aria-hidden="true" /> Masuk
            </Link>
          ) : null}
          <Link href="/ketersediaan" className="shop-btn primary sm shop-head-cta">
            <CalendarDays size={17} aria-hidden="true" /> Pesan lapangan
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * Bilah navigasi bawah khusus ponsel: empat tujuan utama selalu sejangkau jempol,
 * dengan jumlah sesi di keranjang terlihat dari halaman mana pun.
 */
export function ShopTabBar({ hasFaq, loginEnabled }: Pick<ShopNavProps, "hasFaq" | "loginEnabled">) {
  const pathname = usePathname();
  const cart = useCart();
  const account = useAccount();

  const last = account
    ? { href: "/akun", label: "Akun", icon: CircleUserRound, active: pathname.startsWith("/akun") }
    : loginEnabled
      ? { href: loginHref(pathname), label: "Masuk", icon: CircleUserRound, active: pathname === "/masuk" }
      : { href: hasFaq ? "/faq" : "/kebijakan", label: "Bantuan", icon: LifeBuoy, active: pathname === "/faq" || pathname === "/kebijakan" };
  const tabs = [
    { href: "/", label: "Beranda", icon: House, active: pathname === "/" },
    { href: "/ketersediaan", label: "Booking", icon: CalendarDays, active: pathname === "/ketersediaan" },
    { href: "/keranjang", label: "Keranjang", icon: ShoppingBag, active: pathname === "/keranjang", badge: cart.length },
    last,
  ];

  return (
    <nav className="shop-tabbar" aria-label="Navigasi cepat">
      {tabs.map(tab => (
        <Link key={tab.label} href={tab.href} aria-current={tab.active ? "page" : undefined}>
          <span className="icon">
            <tab.icon size={22} aria-hidden="true" />
            {"badge" in tab && !!tab.badge && <em className="shop-badge" aria-label={`${tab.badge} sesi`}>{tab.badge}</em>}
          </span>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
