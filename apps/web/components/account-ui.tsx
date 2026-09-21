"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarCheck, History, Loader2, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { finishRedirect, safeNext, saveProfile, signInWithGoogle, SignInCancelled, useAccount, type Account, type PublicLogin } from "@/lib/account";

/** Logo "G" Google empat warna, sesuai pedoman tombol masuk Google. */
const GoogleMark = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/** Nama dan nomor WhatsApp. Dipakai saat daftar pertama kali dan di halaman profil. */
export function ProfileForm({ account, submitLabel, onSaved }: { account: Account; submitLabel: string; onSaved?: (account: Account) => void }) {
  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const digits = phone.replace(/[^0-9]/g, "");
  const ready = name.trim().length >= 2 && digits.length >= 9;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true); setError("");
    try { onSaved?.(await saveProfile({ name: name.trim(), phone })); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <form className="acct-form" onSubmit={submit}>
      <label>Nama lengkap
        <input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
      </label>
      <label>Nomor WhatsApp
        <input required inputMode="tel" autoComplete="tel" maxLength={20} placeholder="0812 3456 7890" value={phone} onChange={event => setPhone(event.target.value)} />
        <small>Dipakai venue untuk konfirmasi jadwal dan kabar bila ada perubahan.</small>
      </label>
      {error && <p className="shop-note error" role="alert">{error}</p>}
      <button className="shop-btn primary wide" type="submit" disabled={!ready || busy}>
        {busy && <Loader2 size={18} className="spin" aria-hidden="true" />} {submitLabel}
      </button>
    </form>
  );
}

/**
 * Masuk dalam dua langkah di satu kartu: akun Google, lalu nomor WhatsApp untuk pendaftar baru.
 * Setelah selesai pelanggan kembali ke halaman asalnya, mis. keranjang yang sedang diisi.
 */
export function LoginCard({ login, venueName }: { login: PublicLogin; venueName: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("lanjut"));
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);

  // Kembali dari halaman Google (bila jendela login sempat diblokir peramban).
  useEffect(() => {
    if (!login.enabled) return;
    finishRedirect(login.firebase).then(result => { if (result) setFresh(result.created); })
      .catch(problem => { if (!(problem instanceof SignInCancelled)) setError((problem as Error).message); });
  }, [login]);

  // Sudah lengkap: langsung ke tujuan.
  useEffect(() => {
    if (account && !account.needs_profile) router.replace(next);
  }, [account, next, router]);

  async function start() {
    if (!login.enabled) return;
    setBusy(true); setError("");
    try {
      const result = await signInWithGoogle(login.firebase);
      if (result) setFresh(result.created);
    } catch (problem) {
      if (!(problem instanceof SignInCancelled)) setError((problem as Error).message);
    } finally { setBusy(false); }
  }

  if (!login.enabled) {
    return (
      <div className="acct-login">
        <span className="shop-eyebrow">Akun pelanggan</span>
        <h1>Akun pelanggan belum tersedia</h1>
        <p>{venueName} belum membuka login akun. Anda tetap bisa memesan seperti biasa tanpa akun.</p>
        <Link className="shop-btn primary wide" href="/ketersediaan">Lihat jadwal</Link>
      </div>
    );
  }

  if (account?.needs_profile) {
    return (
      <div className="acct-login">
        <span className="acct-step">Langkah 2 dari 2</span>
        <h1>{fresh ? `Selamat datang, ${account.name.split(" ")[0]}!` : "Satu langkah lagi"}</h1>
        <p>Lengkapi nomor WhatsApp Anda supaya venue bisa mengonfirmasi jadwal main.</p>
        <p className="acct-signed">Masuk sebagai <b>{account.email || account.name}</b></p>
        <ProfileForm account={account} submitLabel="Simpan dan lanjutkan" onSaved={() => router.replace(next)} />
      </div>
    );
  }

  return (
    <div className="acct-login">
      <span className="acct-step">Masuk atau daftar</span>
      <h1>Simpan setiap jadwal main Anda</h1>
      <p>Satu akun untuk semua pesanan di {venueName}. Tidak perlu membuat kata sandi baru.</p>
      <ul className="acct-perks">
        <li><CalendarCheck size={20} aria-hidden="true" /><span><b>Jadwal mendatang di satu tempat</b>Lengkap dengan pengingat ke kalender ponsel.</span></li>
        <li><History size={20} aria-hidden="true" /><span><b>Riwayat main tersimpan</b>Lihat lagi lapangan, jam, dan pembayaran kapan saja.</span></li>
        <li><Zap size={20} aria-hidden="true" /><span><b>Pesan lebih cepat</b>Nama dan nomor WhatsApp terisi sendiri di keranjang.</span></li>
      </ul>
      {error && <p className="shop-note error" role="alert">{error}</p>}
      <button type="button" className="acct-google" onClick={() => void start()} disabled={busy || account === undefined}>
        {busy ? <Loader2 size={20} className="spin" aria-hidden="true" /> : <GoogleMark />}
        {busy ? "Menunggu Google…" : "Lanjutkan dengan Google"}
      </button>
      <p className="acct-fine">
        <ShieldCheck size={15} aria-hidden="true" />
        Kami hanya menerima nama, email, dan foto profil Google Anda. Kata sandi Google tidak pernah sampai ke kami.
      </p>
      <Link className="acct-guest" href="/ketersediaan"><Sparkles size={15} aria-hidden="true" /> Pesan tanpa akun</Link>
    </div>
  );
}
