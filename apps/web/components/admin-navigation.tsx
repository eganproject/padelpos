"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, CalendarDays, Circle, LayoutDashboard, LayoutGrid, MenuSquare, ShieldCheck, ShoppingBag, Store, UserRound, UsersRound, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, forgetSession } from "@/lib/api";
import { toast } from "sonner";

export type NavigationMenu = { id:string; name:string; path:string; icon:string; group:string; order:number; active:boolean };
type NavigationResponse = { menus:NavigationMenu[]; role:{ name:string; slug:string } };

const icons = { Activity, CalendarDays, LayoutDashboard, LayoutGrid, MenuSquare, ShieldCheck, ShoppingBag, Store, UserRound, UsersRound, WalletCards };

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

export function AdminNavigation({ menus, onNavigate }: { menus:NavigationMenu[]; onNavigate?:()=>void }) {
  const pathname = usePathname();
  const groups = useMemo(() => {
    const result = new Map<string, NavigationMenu[]>();
    menus.forEach((menu) => result.set(menu.group, [...(result.get(menu.group) || []), menu]));
    return [...result.entries()];
  }, [menus]);

  return <>{groups.map(([group, items]) => <div className="admin-nav-group" key={group}><p className="admin-nav-label">{group}</p><nav>{items.map((menu) => {
    const Icon = icons[menu.icon as keyof typeof icons] || Circle;
    const active = pathname === menu.path || (menu.path !== "/admin" && pathname.startsWith(`${menu.path}/`));
    return <Link href={menu.path} className={active ? "active" : ""} onClick={onNavigate} key={menu.id}><Icon/><span className="admin-nav-text">{menu.name}</span></Link>;
  })}</nav></div>)}</>;
}

export function usePermissionGuard(menus:NavigationMenu[], loading:boolean) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const allowed = menus.some((menu) => pathname === menu.path || (menu.path !== "/admin" && pathname.startsWith(`${menu.path}/`)));
    if (!allowed && menus.length) router.replace(menus[0].path);
  }, [loading, menus, pathname, router]);
}
