"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, ExternalLink, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Brand } from "./brand";
import { api, ApiError, forgetSession, clearSession, type User } from "@/lib/api";
import { AdminNavigation, currentMenu, menuIcon, type NavigationMenu, useAdminNavigation, usePermissionGuard } from "./admin-navigation";

type Theme = "dark" | "light";
const initials = (name?: string) => (name || "Admin").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

/**
 * Kerangka panel staf bergaya desk ERPNext: bilah navigasi atas (logo, jejak halaman, pencarian,
 * menu akun), sidebar ruang kerja di kiri, dan isi halaman di kanan. Di layar sempit sidebar
 * menjadi laci yang dibuka dari tombol menu.
 */
export function AdminSectionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("light");
  const [user, setUser] = useState<User | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [wide, setWide] = useState(true);
  const { menus, role, loading } = useAdminNavigation();
  usePermissionGuard(menus, loading);
  const current = currentMenu(menus, pathname);

  useEffect(() => {
    const saved: Theme = localStorage.getItem("padelix_theme") === "dark" ? "dark" : "light";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
    setCollapsed(localStorage.getItem("padelix_sidebar") === "collapsed");
    const loadUser = () => {
      api<{user:User}>("/auth/me").then(({user})=>{setUser(user);localStorage.setItem("padelix_user",JSON.stringify(user));}).catch(error=>{
        if(error instanceof ApiError && error.status===401){forgetSession();router.replace("/login");}
        else toast.error(error.message);
      });
    };
    loadUser();
    window.addEventListener("padelix:user-changed",loadUser);
    return ()=>window.removeEventListener("padelix:user-changed",loadUser);
  }, [router]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  /* Di atas 991px sidebar menempel di kiri (bisa diringkas jadi ikon); di bawahnya menjadi laci. */
  useEffect(() => {
    const query = window.matchMedia("(min-width: 992px)");
    const update = () => { setWide(query.matches); if (query.matches) setDrawerOpen(false); };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("nav-open");
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("nav-open");
    };
  }, [drawerOpen]);

  /** Di layar lebar tombol menu meringkas sidebar menjadi deretan ikon; di layar sempit membuka laci. */
  const toggleSidebar = () => {
    if (!wide) { setDrawerOpen(open => !open); return; }
    setCollapsed(value => { localStorage.setItem("padelix_sidebar", value ? "open" : "collapsed"); return !value; });
  };
  const compact = wide && collapsed;
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("padelix_theme", next);
    document.documentElement.dataset.theme = next;
  };
  const logout = async () => { try { await clearSession(); router.push("/login"); } catch(error) { toast.error((error as Error).message); } };

  return (
    <div className={`desk${compact ? " sidebar-collapsed" : ""}`}>
      <header className="desk-navbar">
        <div className="desk-navbar-inner">
          <button type="button" className="desk-icon-btn desk-sidebar-toggle" onClick={toggleSidebar}
            aria-label={wide ? (compact ? "Lebarkan menu" : "Ringkas menu") : drawerOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={wide ? !compact : drawerOpen} title={wide ? (compact ? "Lebarkan menu" : "Ringkas menu") : undefined}><Menu /></button>
          <Link href="/admin" className="desk-logo" aria-label="Padelix, ke ringkasan"><Brand /></Link>
          <nav className="desk-breadcrumbs" aria-label="Lokasi halaman">
            {current && <>
              <ChevronRight aria-hidden="true" /><span>{current.group}</span>
              <ChevronRight aria-hidden="true" /><Link href={current.path} aria-current="page">{current.name}</Link>
            </>}
          </nav>
          <div className="desk-navbar-end">
            <DeskSearch menus={menus} />
            <UserMenu user={user} roleName={role.name} theme={theme} toggleTheme={toggleTheme} logout={logout} />
          </div>
        </div>
      </header>
      <div className="desk-body">
        <button type="button" className={`desk-backdrop${drawerOpen ? " open" : ""}`} aria-label="Tutup navigasi" tabIndex={drawerOpen ? 0 : -1} onClick={() => setDrawerOpen(false)} />
        <aside className={`desk-sidebar${drawerOpen ? " open" : ""}`} aria-label="Navigasi admin" inert={!wide && !drawerOpen ? true : undefined}>
          <div className="desk-drawer-head"><Brand /><button type="button" className="desk-icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Tutup menu"><X /></button></div>
          <div className="desk-sidebar-scroll">
            {loading && !menus.length ? <div className="desk-sidebar-skeleton" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div> : <AdminNavigation menus={menus} compact={compact} onNavigate={() => setDrawerOpen(false)} />}
          </div>
          <div className="desk-sidebar-foot">
            <Link href="/admin/profile" className="desk-sidebar-user" title={compact ? user?.name : undefined} onClick={() => setDrawerOpen(false)}>
              <span className="desk-avatar" aria-hidden="true">{initials(user?.name)}</span>
              <span className="desk-sidebar-user-text"><b>{user?.name || "Admin"}</b><small>{role.name || user?.email || "Staf"}</small></span>
            </Link>
            <button type="button" className="desk-icon-btn desk-collapse-btn" onClick={toggleSidebar} aria-label={compact ? "Lebarkan menu" : "Ringkas menu"} title={compact ? "Lebarkan menu" : "Ringkas menu"}>
              {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          </div>
        </aside>
        <main className="desk-main">{children}</main>
      </div>
    </div>
  );
}

/** Kotak pencarian bilah atas (awesomebar): lompat ke menu mana pun. Ctrl+G atau Ctrl+K memfokuskannya. */
function DeskSearch({ menus }: { menus: NavigationMenu[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return menus.filter(menu => !needle || `${menu.name} ${menu.group}`.toLowerCase().includes(needle)).slice(0, 8);
  }, [menus, query]);

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "g" || event.key === "k")) {
        event.preventDefault(); setExpanded(true); requestAnimationFrame(() => input.current?.focus());
      }
    };
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) { setOpen(false); setExpanded(false); } };
    document.addEventListener("keydown", focus);
    document.addEventListener("mousedown", outside);
    return () => { document.removeEventListener("keydown", focus); document.removeEventListener("mousedown", outside); };
  }, []);
  useEffect(() => setCursor(0), [query]);

  const go = (menu?: NavigationMenu) => {
    if (!menu) return;
    setQuery(""); setOpen(false); setExpanded(false); input.current?.blur();
    router.push(menu.path);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setCursor(i => Math.min(results.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setCursor(i => Math.max(0, i - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); go(results[cursor]); }
    else if (event.key === "Escape") { setOpen(false); setExpanded(false); input.current?.blur(); }
  };

  return (
    <div className={`desk-search${expanded ? " expanded" : ""}`} ref={box}>
      <button type="button" className="desk-icon-btn desk-search-open" onClick={() => { setExpanded(true); requestAnimationFrame(() => input.current?.focus()); }} aria-label="Cari menu"><Search /></button>
      <div className="desk-search-field">
        <Search className="desk-search-icon" aria-hidden="true" />
        <input ref={input} value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          placeholder="Cari atau ketik perintah (Ctrl + G)" aria-label="Cari menu" role="combobox" aria-expanded={open} aria-controls="desk-search-results" aria-autocomplete="list" />
        <button type="button" className="desk-icon-btn desk-search-close" onClick={() => { setExpanded(false); setOpen(false); }} aria-label="Tutup pencarian"><X /></button>
      </div>
      {open && <ul className="desk-dropdown desk-search-results" id="desk-search-results" role="listbox">
        {results.length ? results.map((menu, index) => {
          const Icon = menuIcon(menu.icon);
          return <li key={menu.id} role="option" aria-selected={index === cursor}>
            <button type="button" className={index === cursor ? "active" : ""} onMouseEnter={() => setCursor(index)} onClick={() => go(menu)}>
              <Icon aria-hidden="true" /><span>{menu.name}</span><small>{menu.group}</small>
            </button>
          </li>;
        }) : <li className="desk-dropdown-empty">Tidak ada menu “{query}”.</li>}
      </ul>}
    </div>
  );
}

function UserMenu({ user, roleName, theme, toggleTheme, logout }: { user:User|null; roleName:string; theme:Theme; toggleTheme:()=>void; logout:()=>void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="desk-user" ref={box}>
      <button type="button" className="desk-avatar" onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open} aria-label="Menu akun" title={user?.name}>{initials(user?.name)}</button>
      {open && <div className="desk-dropdown desk-user-menu" role="menu">
        <div className="desk-user-head"><span className="desk-avatar large" aria-hidden="true">{initials(user?.name)}</span><div><b>{user?.name || "Admin"}</b><small>{roleName || user?.email}</small></div></div>
        <Link role="menuitem" href="/admin/profile"><UserRound aria-hidden="true" /> Profil saya</Link>
        <Link role="menuitem" href="/" target="_blank" rel="noopener"><ExternalLink aria-hidden="true" /> Situs pelanggan</Link>
        <button role="menuitem" type="button" onClick={toggleTheme}>{theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />} {theme === "dark" ? "Tema terang" : "Tema gelap"}</button>
        <hr />
        <button role="menuitem" type="button" className="danger" onClick={logout}><LogOut aria-hidden="true" /> Keluar</button>
      </div>}
    </div>
  );
}
