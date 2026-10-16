"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleHelp, Copy, ExternalLink, KeyRound, Loader2, MessageCircle, RefreshCw, Search, ShieldCheck, TriangleAlert, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatShortDay } from "@/lib/shop";
import { ErrorBox } from "./operation-ui";

type Settings = {
  enabled: boolean; api_key: string; auth_domain: string; project_id: string; app_id: string; updated_at: string | null;
  complete: boolean; ready: boolean; site_domain: string;
};
type AccountRow = {
  id: string; name: string; email: string; phone: string; photo_url: string;
  created_at: string; last_login_at: string; bookings: number; last_booking: string | null;
};
type Data = { settings: Settings; accounts: AccountRow[] };
type Form = Pick<Settings, "enabled" | "api_key" | "auth_domain" | "project_id" | "app_id">;
type TestResult = { ok: boolean; checks: { key: string; ok: boolean | null; label: string; detail: string }[] };

const formFrom = (settings: Settings): Form => ({ enabled: settings.enabled, api_key: settings.api_key, auth_domain: settings.auth_domain, project_id: settings.project_id, app_id: settings.app_id });
const dateTime = (value: string) => new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

/**
 * Potongan `const firebaseConfig = {...}` dari Firebase Console, atau JSON-nya, diurai menjadi
 * empat isian. Admin cukup menyalin-tempel; tidak perlu tahu nama setiap kunci.
 */
export function parseFirebaseConfig(text: string): Partial<Form> {
  const pick = (key: string) => new RegExp(`["']?${key}["']?\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1]?.trim() ?? "";
  const found = { api_key: pick("apiKey"), auth_domain: pick("authDomain"), project_id: pick("projectId"), app_id: pick("appId") };
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value)) as Partial<Form>;
}

export function CustomersPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"akun" | "login">("akun");
  const load = useCallback(async () => {
    try {
      const result = await api<Data>("/operations/customers");
      setData(result); setError("");
      // Belum siap: admin paling butuh panduan penyiapan, jadi tab itu yang dibuka.
      if (!result.settings.ready) setTab(current => (current === "akun" && !result.accounts.length ? "login" : current));
    } catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error && !data) return <ErrorBox message={error} retry={load} />;
  if (!data) return <p className="empty-state">Memuat data pelanggan…</p>;
  return (
    <div className="cms">
      <div className="cms-tabs" role="tablist" aria-label="Bagian pelanggan">
        <button type="button" role="tab" aria-selected={tab === "akun"} onClick={() => setTab("akun")}><UsersRound size={16} aria-hidden="true" /> <span>Akun pelanggan</span></button>
        <button type="button" role="tab" aria-selected={tab === "login"} onClick={() => setTab("login")}>
          <KeyRound size={16} aria-hidden="true" /> <span>Login Google</span>
          {!data.settings.ready && <i className="cms-dot" title="Belum aktif" />}
        </button>
      </div>
      {tab === "akun"
        ? <AccountsTab accounts={data.accounts} ready={data.settings.ready} openSetup={() => setTab("login")} />
        : <LoginTab settings={data.settings} saved={settings => setData(current => current && { ...current, settings })} />}
    </div>
  );
}

function AccountsTab({ accounts, ready, openSetup }: { accounts: AccountRow[]; ready: boolean; openSetup: () => void }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return accounts.filter(row => !needle || row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle) || (digits.length >= 3 && row.phone.replace(/\D/g, "").includes(digits)));
  }, [accounts, query]);
  const wa = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "62")}`;

  if (!accounts.length) {
    return (
      <div className="ops-empty">
        <h2>Belum ada pelanggan yang mendaftar</h2>
        <p>{ready ? "Pelanggan dapat mendaftar dari tombol Masuk di situs. Akun yang dibuat akan tampil di sini." : "Siapkan login Google lebih dulu supaya pelanggan dapat membuat akun."}</p>
        {!ready && <button type="button" className="ops-primary" onClick={openSetup}><KeyRound size={15} aria-hidden="true" /> Siapkan login Google</button>}
      </div>
    );
  }
  return (
    <>
      <div className="manage-toolbar">
        <div><Search aria-hidden="true" /><input placeholder="Cari nama, email, atau nomor WhatsApp…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Cari pelanggan" /></div>
        <span>{shown.length} dari {accounts.length} akun</span>
      </div>
      <div className="manage-table-card table-cards">
        <table>
          <thead><tr><th>Pelanggan</th><th>WhatsApp</th><th>Booking</th><th>Terakhir main</th><th>Terakhir masuk</th></tr></thead>
          <tbody>
            {shown.map(row => (
              <tr key={row.id}>
                <td className="wide" data-label="Pelanggan">
                  <div className="user-cell">
                    {/* eslint-disable-next-line @next/next/no-img-element -- foto profil Google */}
                    {row.photo_url ? <img className="cust-photo" src={row.photo_url} alt="" referrerPolicy="no-referrer" /> : <span>{row.name.slice(0, 2).toUpperCase()}</span>}
                    <div><b>{row.name}</b><small>{row.email || "—"}</small></div>
                  </div>
                </td>
                <td data-label="WhatsApp">
                  {row.phone
                    ? <a className="ops-link" href={wa(row.phone)} target="_blank" rel="noopener"><MessageCircle size={14} aria-hidden="true" /> {row.phone}</a>
                    : <small className="table-description">Belum dilengkapi</small>}
                </td>
                <td data-label="Booking">{row.bookings}<small className="table-description">aktif &amp; selesai</small></td>
                <td data-label="Terakhir main">{row.last_booking ? formatShortDay(row.last_booking) : "—"}</td>
                <td data-label="Terakhir masuk">{dateTime(row.last_login_at)}<small className="table-description">Daftar {new Date(row.created_at).toLocaleDateString("id-ID", { dateStyle: "medium" })}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="empty-state">Tidak ada akun yang cocok dengan “{query}”.</p>}
      </div>
      <p className="cust-note"><CircleHelp size={15} aria-hidden="true" /> Booking yang dibuat kasir dapat dihubungkan ke akun dari rincian booking. Nomor WhatsApp diisi pelanggan sendiri dan tidak diverifikasi SMS, jadi booking tidak pernah dihubungkan otomatis hanya karena nomornya sama.</p>
    </>
  );
}

function LoginTab({ settings, saved }: { settings: Settings; saved: (settings: Settings) => void }) {
  const [form, setForm] = useState<Form>(formFrom(settings));
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(settings));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  const filled = [form.api_key, form.auth_domain, form.project_id, form.app_id].filter(Boolean).length;

  function applyPaste(text: string) {
    setPaste(text);
    const found = parseFirebaseConfig(text);
    const count = Object.keys(found).length;
    if (!count) return;
    setForm(current => ({ ...current, ...found }));
    if (count === 4) toast.success("Keempat isian terisi dari konfigurasi yang ditempel");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("simpan"); setError("");
    try {
      const result = await api<{ settings: Settings }>("/operations/customers/login", { method: "PUT", body: JSON.stringify(form) });
      saved(result.settings); setForm(formFrom(result.settings)); setTest(null); setPaste("");
      toast.success("Pengaturan login disimpan");
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(""); }
  }
  async function runTest() {
    setBusy("uji"); setTest(null);
    try { setTest(await api<TestResult>("/operations/customers/login/test", { method: "POST", body: "{}" })); }
    catch (problem) { setTest({ ok: false, checks: [{ key: "galat", ok: false, label: "Uji koneksi", detail: (problem as Error).message }] }); }
    finally { setBusy(""); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast.success("Disalin"); }
    catch { toast.error("Tidak dapat menyalin otomatis. Salin manual."); }
  }

  const status = settings.ready ? { tone: "on", title: "Login Google aktif", text: "Pelanggan dapat masuk dari tombol Masuk di situs dan melihat riwayat pesanannya." }
    : settings.complete ? { tone: "off", title: "Konfigurasi tersimpan, belum diaktifkan", text: "Centang “Aktifkan login pelanggan” lalu simpan. Jalankan uji koneksi dulu supaya yakin." }
    : { tone: "off", title: "Belum disiapkan", text: "Ikuti lima langkah di bawah. Butuh sekitar 10 menit dan paket gratis Firebase sudah cukup." };

  return (
    <>
      {error && <ErrorBox message={error} />}
      <div className="pay-status">
        <div className={`pay-badge ${status.tone}`}>
          {settings.ready ? <ShieldCheck size={22} aria-hidden="true" /> : <TriangleAlert size={22} aria-hidden="true" />}
          <div><b>{status.title}</b><small>{status.text}</small></div>
        </div>
        <dl className="pay-meta">
          <div><dt>Proyek Firebase</dt><dd>{settings.project_id || "Belum diisi"}</dd></div>
          <div><dt>Domain situs</dt><dd>{settings.site_domain}</dd></div>
        </dl>
        <button type="button" className="ops-secondary" onClick={() => void runTest()} disabled={!settings.api_key || !!busy}>
          {busy === "uji" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Uji koneksi
        </button>
      </div>

      {test && (
        <ul className="cust-checks" role="status" aria-label="Hasil uji koneksi">
          {test.checks.map(item => (
            <li key={item.key} className={item.ok === true ? "ok" : item.ok === false ? "bad" : "unknown"}>
              {item.ok === true ? <Check size={16} aria-hidden="true" /> : item.ok === false ? <X size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
              <div><b>{item.label}</b><span>{item.detail}</span></div>
            </li>
          ))}
        </ul>
      )}

      <form className="cms-form" onSubmit={save}>
        <div className="cms-grid">
          <section className="cms-card">
            <header><h2>Panduan penyiapan</h2><p>Semua langkah dilakukan di Firebase Console dengan akun Google milik venue.</p></header>
            <ol className="cust-steps">
              <li>
                <b>Buat proyek Firebase</b>
                <span>Buka <a className="ops-link" href="https://console.firebase.google.com/" target="_blank" rel="noopener">console.firebase.google.com <ExternalLink size={12} aria-hidden="true" /></a>, pilih <i>Create a project</i>. Google Analytics boleh dimatikan.</span>
              </li>
              <li>
                <b>Nyalakan login Google</b>
                <span>Menu <i>Build → Authentication → Get started → Sign-in method → Google</i>, aktifkan, isi email dukungan, lalu <i>Save</i>.</span>
              </li>
              <li>
                <b>Izinkan domain situs ini</b>
                <span><i>Authentication → Settings → Authorized domains → Add domain</i>, tempel:</span>
                <span className="pay-copy">
                  <input readOnly value={settings.site_domain} onFocus={event => event.target.select()} aria-label="Domain situs" />
                  <button type="button" className="ops-secondary" onClick={() => void copy(settings.site_domain)}><Copy size={14} /> Salin</button>
                </span>
              </li>
              <li>
                <b>Daftarkan aplikasi web</b>
                <span><i>Project settings (ikon roda gigi) → General → Your apps</i>, klik ikon <code>&lt;/&gt;</code>, beri nama bebas, lalu salin seluruh kotak <code>firebaseConfig</code>.</span>
              </li>
              <li>
                <b>Tempel, simpan, dan uji</b>
                <span>Tempel di kotak sebelah, centang aktifkan, simpan, lalu tekan <i>Uji koneksi</i> di atas.</span>
              </li>
            </ol>
          </section>

          <section className="cms-card">
            <header><h2>Konfigurasi Firebase</h2><p>Nilai ini memang dirancang Google untuk dibagikan ke browser, jadi aman disimpan di sini. Tidak perlu file rahasia atau service account.</p></header>
            <label className="cms-field"><span className="cms-label">Tempel konfigurasi dari Firebase</span>
              <textarea rows={6} value={paste} spellCheck={false} className="cust-paste"
                placeholder={"const firebaseConfig = {\n  apiKey: \"AIza…\",\n  authDomain: \"nama-proyek.firebaseapp.com\",\n  projectId: \"nama-proyek\",\n  …\n};"}
                onChange={event => applyPaste(event.target.value)} />
              <small className="cms-hint">{paste ? `${Object.keys(parseFirebaseConfig(paste)).length} dari 4 isian terbaca.` : "Isian di bawah terisi sendiri. Bisa juga diketik manual."}</small>
            </label>
            <label className="cms-field"><span className="cms-label">API key</span>
              <input value={form.api_key} maxLength={80} placeholder="AIza…" spellCheck={false} onChange={event => set("api_key", event.target.value.trim())} />
            </label>
            <label className="cms-field"><span className="cms-label">Auth domain</span>
              <input value={form.auth_domain} maxLength={120} placeholder="nama-proyek.firebaseapp.com" spellCheck={false} onChange={event => set("auth_domain", event.target.value.trim())} />
            </label>
            <label className="cms-field"><span className="cms-label">Project ID</span>
              <input value={form.project_id} maxLength={40} placeholder="nama-proyek" spellCheck={false} onChange={event => set("project_id", event.target.value.trim())} />
            </label>
            <label className="cms-field"><span className="cms-label">App ID</span>
              <input value={form.app_id} maxLength={80} placeholder="1:1234567890:web:abc123" spellCheck={false} onChange={event => set("app_id", event.target.value.trim())} />
            </label>
            <label className="cms-check">
              <input type="checkbox" checked={form.enabled} disabled={filled < 4} onChange={event => set("enabled", event.target.checked)} />
              Aktifkan login pelanggan {filled < 4 && <small className="cms-hint">(lengkapi keempat isian dulu)</small>}
            </label>
          </section>
        </div>
        <div className={`cms-savebar${dirty ? " dirty" : ""}`}>
          <span>{dirty ? "Ada perubahan yang belum disimpan." : settings.updated_at ? `Terakhir disimpan ${dateTime(settings.updated_at)}.` : "Belum pernah disimpan."}</span>
          <button className="ops-primary" type="submit" disabled={!dirty || !!busy}>{busy === "simpan" ? "Menyimpan…" : "Simpan pengaturan"}</button>
        </div>
      </form>
    </>
  );
}
