"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, LogOut, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Brand } from "./brand";
import { api, ApiError, forgetSession, clearSession, type User } from "@/lib/api";
import { AdminNavigation, useAdminNavigation, usePermissionGuard } from "./admin-navigation";

export function AdminSectionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { menus, role, loading } = useAdminNavigation();
  usePermissionGuard(menus, loading);

  useEffect(() => {
    const saved = (localStorage.getItem("padelix_theme") as "dark" | "light") || "dark";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
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

  useEffect(() => setSidebarOpen(false), [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setSidebarOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("nav-open");
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("nav-open");
    };
  }, [sidebarOpen]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("padelix_theme", next);
    document.documentElement.dataset.theme = next;
  };
  const logout = async () => { try { await clearSession(); router.push("/login"); } catch(error) { toast.error((error as Error).message); } };

  return (
    <main className="manage-shell">
      <button className={`manage-sidebar-backdrop${sidebarOpen ? " open" : ""}`} aria-label="Tutup navigasi" onClick={() => setSidebarOpen(false)} />
      <aside className={`manage-sidebar${sidebarOpen ? " open" : ""}`} aria-label="Navigasi admin">
        <div className="manage-brand"><Brand compact /><button type="button" onClick={() => setSidebarOpen(false)} aria-label="Tutup menu"><X /></button></div>
        <AdminNavigation menus={menus} onNavigate={() => setSidebarOpen(false)} />
        <div className="manage-user"><span>{user?.name?.slice(0, 2).toUpperCase() || "AD"}</span><div><b>{user?.name || "Admin"}</b><small>{role.name || user?.email}</small></div></div>
        <button className="manage-logout" onClick={logout}><LogOut /><span>Keluar</span></button>
      </aside>
      <section className="manage-main">
        <header className="manage-top">
          <div className="manage-top-start"><button className="manage-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Buka menu"><Menu /></button><Link href="/admin"><Activity /><span>Control center</span></Link></div>
          <div className="manage-top-actions"><button onClick={toggleTheme} aria-label="Ubah tema">{theme === "dark" ? <Sun /> : <Moon />}</button><span className="manage-avatar">{user?.name?.slice(0, 2).toUpperCase() || "AD"}</span></div>
        </header>
        {children}
      </section>
    </main>
  );
}
