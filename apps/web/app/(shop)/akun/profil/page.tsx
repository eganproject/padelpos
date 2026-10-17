"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, Loader2, LogOut, Mail, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAccount, saveNotifyPreferences, signOut, useAccount } from "@/lib/account";
import { ProfileForm } from "@/components/account-ui";
import { Avatar } from "@/components/shop-header";

const since = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

export default function ProfilePage() {
  const account = useAccount();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState("");
  if (!account) return null;
  const notify = account.notify ?? { email: true, whatsapp: true };

  async function savePref(next: { email: boolean; whatsapp: boolean }) {
    setBusy("kabar");
    try { await saveNotifyPreferences(next); toast.success("Pilihan notifikasi disimpan"); }
    catch (problem) { toast.error((problem as Error).message); }
    finally { setBusy(""); }
  }

  async function leave() {
    setBusy("keluar");
    await signOut();
    router.replace("/");
  }
  async function remove() {
    setBusy("hapus");
    try { await deleteAccount(); toast.success("Akun dihapus"); router.replace("/"); }
    catch (problem) { toast.error((problem as Error).message); setBusy(""); }
  }

  return (
    <div className="acct-profile">
      <section className="acct-card">
        <h2>Data pemesan</h2>
        <p>Dipakai untuk mengisi keranjang otomatis dan dikirim ke venue saat Anda memesan.</p>
        <ProfileForm key={account.phone + account.name} account={account} submitLabel="Simpan perubahan" onSaved={() => toast.success("Profil disimpan")} />
      </section>

      <section className="acct-card" id="notifikasi">
        <h2>Kabar dari venue</h2>
        <p>Tagihan, bukti pembayaran, pengingat main, dan perubahan jadwal selalu tersimpan di menu Notifikasi. Pilih ke mana salinannya juga dikirim.</p>
        <div className="acct-prefs">
          <label className="acct-pref">
            <MessageCircle size={20} aria-hidden="true" />
            <span><b>WhatsApp</b><small>Ke {account.phone || "nomor di profil"}</small></span>
            <input type="checkbox" role="switch" checked={notify.whatsapp} disabled={busy === "kabar"} onChange={event => void savePref({ ...notify, whatsapp: event.target.checked })} />
          </label>
          <label className="acct-pref">
            <Mail size={20} aria-hidden="true" />
            <span><b>Email</b><small>Ke {account.email || "email akun Google"}</small></span>
            <input type="checkbox" role="switch" checked={notify.email} disabled={busy === "kabar"} onChange={event => void savePref({ ...notify, email: event.target.checked })} />
          </label>
          <p className="acct-pref-note"><Bell size={15} aria-hidden="true" /> Notifikasi di akun ini selalu aktif.</p>
        </div>
      </section>

      <section className="acct-card">
        <h2>Akun Google</h2>
        <div className="acct-google-row">
          <Avatar account={account} size={48} />
          <div>
            <b>{account.email || account.name}</b>
            <span>Anggota sejak {since.format(new Date(account.created_at))}</span>
          </div>
        </div>
        <p>Foto dan email mengikuti akun Google Anda dan diperbarui setiap kali masuk.</p>
        <button type="button" className="shop-btn outline" onClick={() => void leave()} disabled={!!busy}>
          {busy === "keluar" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />} Keluar
        </button>
      </section>

      <section className="acct-card danger">
        <h2>Hapus akun</h2>
        <p>Riwayat di akun ini akan hilang dari tampilan Anda. Booking dan pembayarannya tetap tercatat di venue, jadi jadwal yang sudah dipesan tidak batal.</p>
        {confirming ? (
          <div className="acct-confirm" role="alert">
            <b>Yakin menghapus akun {account.email || account.name}?</b>
            <div>
              <button type="button" className="shop-btn danger" onClick={() => void remove()} disabled={!!busy}>
                {busy === "hapus" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />} Ya, hapus akun
              </button>
              <button type="button" className="shop-btn outline" onClick={() => setConfirming(false)} disabled={!!busy}>Batal</button>
            </div>
          </div>
        ) : (
          <button type="button" className="shop-btn outline danger-text" onClick={() => setConfirming(true)}>
            <Trash2 size={16} aria-hidden="true" /> Hapus akun saya
          </button>
        )}
      </section>
    </div>
  );
}
