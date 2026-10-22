"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { menuIcon, settingsMenus, useAdminNavigation, type NavigationMenu } from "./admin-navigation";

/** Keterangan singkat tiap menu bawaan; menu buatan admin memakai path-nya sebagai keterangan. */
const descriptions: Record<string, string> = {
  brand: "Nama, logo, favicon, warna, kontak, dan media sosial yang tampil di seluruh aplikasi.",
  receipts: "Ukuran kertas nota dan isi yang tercetak untuk booking dan transaksi kasir.",
  payments: "Sambungan Midtrans, biaya admin, cara menagih, dan riwayat pembayaran online.",
  "finance-settings": "Daftar akun, pemasok, akun kas tiap metode bayar, pajak, dan kunci periode.",
  notifications: "Email dan WhatsApp untuk tagihan, kwitansi, pengingat main, dan pemberitahuan staf.",
  "customer-login": "Sambungan Firebase untuk tombol Masuk dengan Google di situs pelanggan.",
  users: "Akun staf yang bisa masuk ke panel admin beserta role-nya.",
  roles: "Menu yang boleh dibuka oleh setiap role.",
  menus: "Nama, ikon, urutan, dan pengelompokan menu di sidebar.",
  audit: "Siapa mengubah apa dan kapan: booking, pembayaran, keuangan, dan pengaturan.",
  backups: "Cadangan harian otomatis, cadangan manual, dan unduhan berkasnya.",
};

/** Kelompok kartu di halaman Pengaturan. Menu yang tidak dikenal masuk ke "Lainnya". */
const sections: { title: string; ids: string[] }[] = [
  { title: "Venue & tampilan", ids: ["brand", "receipts"] },
  { title: "Pembayaran & keuangan", ids: ["payments", "finance-settings"] },
  { title: "Pelanggan & notifikasi", ids: ["notifications", "customer-login"] },
  { title: "Pengguna & akses", ids: ["users", "roles", "menus"] },
  { title: "Data & keamanan", ids: ["audit", "backups"] },
];

/**
 * Halaman Pengaturan: semua menu di grup Pengaturan sebagai kartu. Hanya menu yang boleh
 * dibuka role pengguna yang tampil, karena daftarnya diambil dari navigasi pengguna itu.
 */
export function SettingsHub() {
  const { menus, loading } = useAdminNavigation();
  const groups = useMemo(() => {
    const items = settingsMenus(menus).sort((a, b) => a.order - b.order);
    const known = new Set(sections.flatMap(section => section.ids));
    const result = sections
      .map(section => ({ title: section.title, items: section.ids.map(id => items.find(menu => menu.id === id)).filter((menu): menu is NavigationMenu => !!menu) }))
      .filter(section => section.items.length);
    const others = items.filter(menu => !known.has(menu.id));
    if (others.length) result.push({ title: "Lainnya", items: others });
    return result;
  }, [menus]);

  if (loading && !menus.length) return <div className="settings-hub" aria-busy="true"><div className="settings-hub-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="settings-hub-card skeleton" />)}</div></div>;
  if (!groups.length) return <div className="settings-card"><div className="settings-title"><div><h2>Tidak ada pengaturan</h2><p>Role Anda belum diberi akses ke menu pengaturan mana pun.</p></div></div></div>;

  return (
    <div className="settings-hub">
      {groups.map(group => (
        <section key={group.title} aria-labelledby={`hub-${group.title}`}>
          <h2 className="settings-hub-heading" id={`hub-${group.title}`}>{group.title}</h2>
          <div className="settings-hub-grid">
            {group.items.map(menu => {
              const Icon = menuIcon(menu.icon);
              return (
                <Link key={menu.id} href={menu.path} className="settings-hub-card">
                  <span className="settings-hub-icon" aria-hidden="true"><Icon /></span>
                  <span className="settings-hub-text"><b>{menu.name}</b><small>{descriptions[menu.id] || menu.path}</small></span>
                  <ChevronRight className="settings-hub-arrow" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
