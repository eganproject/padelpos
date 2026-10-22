"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, ArrowLeftRight, BadgeCheck, BookOpenText, CalendarDays, ChartPie, ChevronDown, Circle, Contact, CreditCard, DatabaseBackup, FileChartColumn, History, KeyRound, LayoutDashboard, LayoutGrid, Mail, BellRing, MenuSquare, Palette, Printer, Settings, ShieldCheck, ShoppingBag, SlidersHorizontal, Store, TicketPercent, UserRound, UsersRound, Wallet, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, forgetSession } from "@/lib/api";
import { toast } from "sonner";

export type NavigationMenu = { id:string; name:string; path:string; icon:string; group:string; order:number; active:boolean };
type NavigationResponse = { menus:NavigationMenu[]; role:{ name:string; slug:string } };

const icons = { Activity, ArrowLeftRight, BadgeCheck, BookOpenText, CalendarDays, ChartPie, Contact, CreditCard, DatabaseBackup, FileChartColumn, History, KeyRound, LayoutDashboard, LayoutGrid, Mail, BellRing, MenuSquare, Palette, Printer, Settings, ShieldCheck, ShoppingBag, SlidersHorizontal, Store, TicketPercent, UserRound, UsersRound, Wallet, WalletCards };
/** Ikon yang benar-benar dapat tampil di sidebar; formulir menu hanya menawarkan nama-nama ini. */
export const menuIconNames = Object.keys(icons);

export function useAdminNavigation() {
  const [navigation, setNavigation] = useState<NavigationResponse>({ menus: [], role: { name: "", slug: "" } });
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  useEffect(() => {
    const load = () => api<NavigationResponse>("/auth/navigation")
      .then(setNavigation)
      .catch(error => { if(error instanceof ApiError && error.status===401){forgetSession();router.replace("/login");} else toast.error(error.message); })
      .finally(() => setLoading(false));
    void load();
    window.addEventListener("padelix:navigation-changed", load);
    return () => window.removeEventListener("padelix:navigation-changed", load);
  }, [router]);
  return { ...navigation, loading };
}

/** Menu yang sedang dibuka: path sama persis, atau halaman turunannya. */
export const isActiveMenu = (menu:NavigationMenu, pathname:string) => pathname === menu.path || (menu.path !== "/admin" && pathname.startsWith(`${menu.path}/`));
/**
 * Menu yang mewakili halaman ini. Bila beberapa menu cocok (Ringkasan di /admin/keuangan dan
 * Kas & Transaksi di /admin/keuangan/transaksi), path terpanjang yang menang agar hanya satu
 * menu yang tampak aktif.
 */
export const currentMenu = (menus:NavigationMenu[], pathname:string) =>
  menus.filter(menu => isActiveMenu(menu, pathname)).sort((a, b) => b.path.length - a.path.length)[0];
export const menuIcon = (name:string) => icons[name as keyof typeof icons] || Circle;

/** Halaman Pengaturan yang memuat semua menu grup Pengaturan sebagai kartu. */
export const SETTINGS_PATH = "/admin/pengaturan";
/** Grup sidebar yang diringkas menjadi satu menu Pengaturan (nama grup bisa diubah huruf besar-kecilnya). */
export const isSettingsGroup = (group:string) => group.trim().toLowerCase() === "pengaturan";
export const settingsMenus = (menus:NavigationMenu[]) => menus.filter(menu => isSettingsGroup(menu.group));
/** Menu semu "Pengaturan" yang mewakili seluruh grupnya di sidebar, pencarian, dan menu akun. */
export const settingsHubMenu = (menus:NavigationMenu[]): NavigationMenu | null => {
  const items = settingsMenus(menus);
  if (!items.length) return null;
  return { id: "settings-hub", name: "Pengaturan", path: SETTINGS_PATH, icon: "Settings", group: items[0].group, order: Math.min(...items.map(menu => menu.order)), active: true };
};

const GROUPS_KEY = "padelix_nav_closed";

/**
 * Sidebar ruang kerja: tiap grup punya judul yang bisa dilipat, baris menu berikon dengan
 * penanda jelas untuk halaman aktif. Dalam mode ringkas (compact) hanya ikon yang tampil,
 * dan nama menu muncul sebagai tooltip saat disorot atau difokus.
 */
export function AdminNavigation({ menus, onNavigate, compact = false }: { menus:NavigationMenu[]; onNavigate?:()=>void; compact?:boolean }) {
  const pathname = usePathname();
  const active = currentMenu(menus, pathname);
  /* Halaman Pengaturan dan semua halaman di dalamnya menandai menu Pengaturan sebagai aktif. */
  const activeId = pathname === SETTINGS_PATH || (active && isSettingsGroup(active.group)) ? "settings-hub" : active?.id;
  const [closed, setClosed] = useState<string[]>([]);
  const [tip, setTip] = useState<{ label:string; top:number; left:number } | null>(null);
  const groups = useMemo(() => {
    const result = new Map<string, NavigationMenu[]>();
    const hub = settingsHubMenu(menus);
    menus.forEach((menu) => {
      if (isSettingsGroup(menu.group)) { if (hub && !result.has(hub.group)) result.set(hub.group, [hub]); return; }
      result.set(menu.group, [...(result.get(menu.group) || []), menu]);
    });
    return [...result.entries()];
  }, [menus]);

  useEffect(() => {
    try { setClosed(JSON.parse(localStorage.getItem(GROUPS_KEY) || "[]")); } catch { setClosed([]); }
  }, []);
  useEffect(() => { if (!compact) setTip(null); }, [compact]);

  const toggle = (group:string) => setClosed(list => {
    const next = list.includes(group) ? list.filter(item => item !== group) : [...list, group];
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)); } catch { /* penyimpanan lokal tidak tersedia */ }
    return next;
  });
  const showTip = (label:string) => (event:React.MouseEvent<HTMLElement>|React.FocusEvent<HTMLElement>) => {
    if (!compact) return;
    const box = event.currentTarget.getBoundingClientRect();
    setTip({ label, top: box.top + box.height / 2, left: box.right + 10 });
  };

  return (
    <nav className={`desk-nav${compact ? " compact" : ""}`} aria-label="Menu admin" onMouseLeave={() => setTip(null)}>
      {groups.map(([group, items]) => {
        /* Grup yang memuat halaman aktif selalu terbuka agar posisi pengguna tidak hilang. */
        const hasActive = items.some(menu => menu.id === activeId);
        const open = compact || hasActive || !closed.includes(group);
        const id = `nav-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        /* Grup Pengaturan tinggal satu menu, jadi tampil tanpa judul grup yang bisa dilipat. */
        const single = isSettingsGroup(group);
        return (
          <div className={`desk-nav-section${single ? " single" : ""}`} key={group}>
            {single ? (compact ? <span className="desk-nav-divider" aria-hidden="true" /> : null) : compact
              ? <span className="desk-nav-divider" aria-hidden="true" />
              : <button type="button" className="desk-nav-label" aria-expanded={open} aria-controls={id} onClick={() => toggle(group)} disabled={hasActive} title={hasActive ? undefined : open ? `Lipat ${group}` : `Buka ${group}`}>
                  <span>{group}</span><ChevronDown aria-hidden="true" />
                </button>}
            {(open || single) && <div className="desk-nav-items" id={id} role="list">
              {items.map(menu => {
                const Icon = menuIcon(menu.icon);
                const active = menu.id === activeId;
                return (
                  <Link role="listitem" href={menu.path} key={menu.id} onClick={onNavigate}
                    className={`desk-nav-item${active ? " selected" : ""}`} aria-current={active ? "page" : undefined}
                    aria-label={compact ? menu.name : undefined}
                    onMouseEnter={showTip(menu.name)} onFocus={showTip(menu.name)} onBlur={() => setTip(null)}>
                    <Icon aria-hidden="true" /><span>{menu.name}</span>
                  </Link>
                );
              })}
            </div>}
          </div>
        );
      })}
      {compact && tip && <span className="desk-nav-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.label}</span>}
    </nav>
  );
}

export function usePermissionGuard(menus:NavigationMenu[], loading:boolean) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const allowed = menus.some((menu) => isActiveMenu(menu, pathname)) || (pathname === SETTINGS_PATH && settingsMenus(menus).length > 0);
    if (!allowed && menus.length) router.replace(menus[0].path);
  }, [loading, menus, pathname, router]);
}
