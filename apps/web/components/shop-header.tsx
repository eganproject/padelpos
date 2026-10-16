"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronRight, CircleUserRound, Menu, Orbit, ShoppingBag, X } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useAccount, type Account } from "@/lib/account";

export type ShopNavProps = {
  /** Nama venue untuk label aksesibilitas; lambangnya tetap lambang aplikasi. */
  name: string;
  hasLocation: boolean;
  hasFaq: boolean;
  hasPolicies: boolean;
  /** Tombol Masuk hanya muncul bila admin sudah menyiapkan login Google. */
  loginEnabled: boolean;
};

/** Foto Google bila ada; tanpa foto, inisial nama. */
export function Avatar({ account, size = 32 }: { account: Pick<Account, "name" | "photo_url">; size?: number }) {
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
  return (
    <span className="shop-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- foto profil Google, ukurannya kecil */}
      {account.photo_url ? <img src={account.photo_url} alt="" referrerPolicy="no-referrer" /> : initials}
    </span>
  );
}

const Brand = ({ name }: { name: string }) => (
  <Link href="/" className="shop-brand" aria-label={`${name}, ke beranda`}>
    <span className="shop-brand-mark"><Orbit size={20} strokeWidth={2.4} aria-hidden="true" /></span>
    <span className="shop-brand-name">PADEL<span>IX</span></span>
  </Link>
);

export function ShopHeader({ name, hasLocation, hasFaq, hasPolicies, loginEnabled }: ShopNavProps) {
  const pathname = usePathname();
  const cart = useCart();
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // Beranda dibuka dengan hero gelap, jadi kepala halaman melayang di atasnya
  // sampai pembaca menggulir melewati hero.
  const overHero = pathname === "/" && !scrolled;

  useEffect(() => {
    if (pathname !== "/") { setScrolled(true); return; }
    const onScroll = () => setScrolled(window.scrollY > 72);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  // Menu layar sempit menutup sendiri saat berpindah halaman.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); opener.current?.focus(); };
  }, [open]);

  const links = [
    { href: "/#lapangan", label: "Lapangan" },
    ...(hasLocation ? [{ href: "/#lokasi", label: "Lokasi" }] : []),
    ...(hasFaq ? [{ href: "/faq", label: "FAQ" }] : []),
  ];
  const current = (href: string) => (pathname === href ? "page" : undefined);
  const cartLabel = cart.length ? `Keranjang, ${cart.length} sesi` : "Keranjang, masih kosong";

  return (
    <>
      <header className={`shop-head${overHero ? " over" : " solid"}`}>
        <div className="shop-head-inner shop-wrap">
          <Brand name={name} />
          <div className="shop-links">
            {links.map(link => (
              <Link key={link.href} href={link.href} className="shop-link" aria-current={current(link.href)}>{link.label}</Link>
            ))}
            <Link href="/keranjang" className="shop-cart-btn" aria-current={current("/keranjang")} aria-label={cartLabel}>
              <ShoppingBag size={17} aria-hidden="true" />
              <span>Keranjang</span>
              {cart.length > 0 && <em aria-hidden="true">{cart.length}</em>}
            </Link>
            {account ? (
              <Link href="/akun" className="shop-account-btn" aria-current={pathname.startsWith("/akun") ? "page" : undefined} aria-label={`Akun saya, ${account.name}`}>
                <Avatar account={account} />
                <span>{account.name.split(" ")[0]}</span>
              </Link>
            ) : loginEnabled && account === null ? (
              <Link href={`/masuk?lanjut=${encodeURIComponent(pathname === "/masuk" ? "/akun" : pathname)}`} className="shop-link login" aria-current={current("/masuk")}>
                <CircleUserRound size={17} aria-hidden="true" /> Masuk
              </Link>
            ) : null}
            <Link href="/ketersediaan" className="shop-btn primary sm" aria-current={current("/ketersediaan")}>
              <CalendarDays size={16} aria-hidden="true" /> Cek jadwal
            </Link>
            <button ref={opener} type="button" className="shop-menu-btn" aria-expanded={open} onClick={() => setOpen(true)} aria-label="Buka menu">
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="shop-sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="shop-sheet-top">
            <Brand name={name} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Tutup menu" autoFocus><X size={20} aria-hidden="true" /></button>
          </div>
          <nav aria-label="Navigasi utama">
            <Link href="/ketersediaan">Cek ketersediaan <ChevronRight size={20} aria-hidden="true" /></Link>
            {links.map(link => <Link key={link.href} href={link.href}>{link.label} <ChevronRight size={20} aria-hidden="true" /></Link>)}
            <Link href="/keranjang">Keranjang{cart.length > 0 ? ` (${cart.length})` : ""} <ChevronRight size={20} aria-hidden="true" /></Link>
            {account ? <Link href="/akun">Akun saya <ChevronRight size={20} aria-hidden="true" /></Link>
              : loginEnabled && account === null ? <Link href={`/masuk?lanjut=${encodeURIComponent(pathname === "/masuk" ? "/akun" : pathname)}`}>Masuk / daftar <ChevronRight size={20} aria-hidden="true" /></Link> : null}
            {hasPolicies && <Link href="/kebijakan">Kebijakan & ketentuan <ChevronRight size={20} aria-hidden="true" /></Link>}
            <Link className="shop-btn primary wide" href="/ketersediaan"><CalendarDays size={18} aria-hidden="true" /> Pesan jam main</Link>
          </nav>
        </div>
      )}
    </>
  );
}
