"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, ImageUp, LoaderCircle, Orbit, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { brandImage } from "@/lib/image";
import { assetUrl, contrast, copyrightLine, defaultBrandName, isHex, type BrandAssetKind, type PublicBrand } from "@/lib/brand";
import { formatWhatsapp } from "@/lib/venue-info";
import { ErrorBox } from "./operation-ui";
import { Field, SaveBar } from "./venue-info-panel";
import { InfoTip } from "@/components/tooltip";

type Contact = { name: string; tagline: string; whatsapp: string; phone: string; email: string; instagram: string; tiktok: string; facebook: string; youtube: string; website: string };
type BrandResponse = { brand: PublicBrand; contact: Contact };
type Form = Contact & Pick<PublicBrand, "primary_color" | "accent_color" | "show_name" | "footer_text" | "copyright">;

/** Warna bawaan situs pelanggan (shop.css). */
const defaults = { primary: "#0f3326", accent: "#c8ff3d" };
const presets: { name: string; primary: string; accent: string }[] = [
  { name: "Hijau lapangan", primary: "#0f3326", accent: "#c8ff3d" },
  { name: "Biru laut", primary: "#0b2a4a", accent: "#38bdf8" },
  { name: "Ungu malam", primary: "#2a1450", accent: "#f0abfc" },
  { name: "Merah bata", primary: "#5a1a12", accent: "#fdba74" },
  { name: "Arang", primary: "#1c1c1c", accent: "#facc15" },
];

const formFrom = ({ brand, contact }: BrandResponse): Form => ({
  ...contact, whatsapp: contact.whatsapp ? formatWhatsapp(contact.whatsapp) : "",
  primary_color: brand.primary_color, accent_color: brand.accent_color, show_name: brand.show_name,
  footer_text: brand.footer_text, copyright: brand.copyright,
});
/** Sama dengan normalisasi di API, agar status "belum disimpan" tidak salah menyala. */
const normalizeWhatsapp = (value: string) => {
  const digits = value.trim().replace(/[\s().-]/g, "");
  if (digits.startsWith("+62")) return digits.slice(1);
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
};
const comparable = (form: Form) => JSON.stringify({ ...form, whatsapp: normalizeWhatsapp(form.whatsapp), primary_color: form.primary_color.toLowerCase(), accent_color: form.accent_color.toLowerCase() });

export function BrandPanel() {
  const [data, setData] = useState<BrandResponse | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await api<BrandResponse>("/operations/brand")); setError(""); }
    catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <ErrorBox message={error} retry={load} /> : <p className="empty-state">Memuat pengaturan brand…</p>;
  return <BrandForm data={data} setData={setData} />;
}

function BrandForm({ data, setData }: { data: BrandResponse; setData: (data: BrandResponse) => void }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => formFrom(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = comparable(form) !== comparable(formFrom(data));
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm(previous => ({ ...previous, [key]: value }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Setelah tersimpan, rangka halaman (judul tab, favicon, logo sidebar) digambar ulang dari server. */
  const applied = (result: BrandResponse) => { setData(result); router.refresh(); };

  const save = async () => {
    setBusy(true); setError("");
    try {
      const result = await api<BrandResponse>("/operations/brand", { method: "PUT", body: JSON.stringify(form) });
      setForm(formFrom(result)); applied(result); toast.success("Brand disimpan");
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };

  const primary = isHex(form.primary_color) ? form.primary_color : defaults.primary;
  const accent = isHex(form.accent_color) ? form.accent_color : defaults.accent;
  const lowContrast = contrast(primary, "#ffffff") < 4.5;

  return (
    <form className="cms-form brand-settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="brand-intro">
        <p>Dipakai di situs booking, panel admin, email, WhatsApp, nota, dan kwitansi.</p>
        <a className="cms-site-link" href="/" target="_blank" rel="noopener"><ExternalLink size={15} aria-hidden="true" /> Lihat situs</a>
      </div>
      {error && <ErrorBox message={error} />}

      <div className="cms-grid">
        <section className="cms-card">
          <header><h2>Identitas</h2><p>Nama tampil di kepala halaman, judul tab browser, email, pesan WhatsApp, dan nota.</p></header>
          <Field label="Nama brand" counter={`${form.name.length}/60`}>
            <input required minLength={2} maxLength={60} value={form.name} onChange={event => set("name")(event.target.value)} placeholder={`Mis. ${defaultBrandName} Arena`} />
          </Field>
          <Field label="Tagline" counter={`${form.tagline.length}/120`} hint="Satu kalimat pendek. Dipakai juga sebagai deskripsi di hasil pencarian Google.">
            <input maxLength={120} value={form.tagline} onChange={event => set("tagline")(event.target.value)} placeholder="Mis. Tiga lapangan padel di tengah kota, buka setiap hari." />
          </Field>
          <label className="cms-check"><input type="checkbox" checked={form.show_name} onChange={event => set("show_name")(event.target.checked)} /> Tampilkan nama di samping logo<InfoTip text="Matikan bila logo sudah memuat tulisan nama venue, supaya nama tidak tampil dua kali."/></label>
          <small className="cms-hint">Matikan bila logo sudah berisi tulisan nama brand.</small>
        </section>

        <section className="cms-card">
          <header><h2>Warna<InfoTip text="Dipakai di situs pelanggan. Panel admin tetap memakai tema netral. Kosongkan untuk kembali ke warna bawaan."/></h2><p>Warna utama untuk tombol, kepala halaman, dan kaki halaman situs pelanggan; aksen untuk sorotan.</p></header>
          <div className="cms-row">
            <ColorField label="Warna utama" value={form.primary_color} fallback={defaults.primary} onChange={set("primary_color")} />
            <ColorField label="Warna aksen" value={form.accent_color} fallback={defaults.accent} onChange={set("accent_color")} />
          </div>
          {lowContrast && <small className="cms-hint warn" role="alert"><AlertTriangle size={13} aria-hidden="true" /> Warna utama terlalu terang: teks putih di atasnya sulit dibaca. Pilih warna yang lebih gelap.</small>}
          <div className="brand-presets" role="group" aria-label="Pilihan warna siap pakai">
            {presets.map(preset => (
              <button key={preset.name} type="button" onClick={() => setForm(previous => ({ ...previous, primary_color: preset.primary, accent_color: preset.accent }))}
                aria-pressed={primary === preset.primary && accent === preset.accent} data-tip={preset.name}>
                <i style={{ background: preset.primary }} /><i style={{ background: preset.accent }} /><span>{preset.name}</span>
              </button>
            ))}
          </div>
          <button type="button" className="ops-secondary brand-reset" onClick={() => setForm(previous => ({ ...previous, primary_color: "", accent_color: "" }))} disabled={!form.primary_color && !form.accent_color}>
            <RotateCcw size={14} aria-hidden="true" /> Kembali ke warna bawaan
          </button>
        </section>

        <section className="cms-card wide">
          <header><h2>Logo & ikon</h2><p>Unggah PNG transparan agar rapi di latar mana pun. Gambar diperkecil otomatis dan langsung dipakai setelah diunggah.</p></header>
          <div className="brand-assets">
            <AssetTile kind="logo" title="Logo" hint="Untuk latar terang: kepala situs, panel admin, email, nota, dan kwitansi." brand={data.brand} applied={applied} />
            <AssetTile kind="logo_dark" title="Logo latar gelap" hint="Opsional. Untuk kaki halaman situs dan tema gelap panel admin. Biasanya versi putih." brand={data.brand} applied={applied} dark />
            <AssetTile kind="favicon" title="Favicon & ikon aplikasi" hint="Ikon di tab browser dan saat situs ditambahkan ke layar utama ponsel. Gambar persegi, minimal 512×512." brand={data.brand} applied={applied} square />
          </div>
        </section>

        <section className="cms-card">
          <header><h2>Kontak</h2><p>Tampil di kaki halaman situs, email, dan nota. Tombol chat WhatsApp memakai nomor ini.</p></header>
          <Field label="WhatsApp"><input inputMode="tel" maxLength={24} value={form.whatsapp} onChange={event => set("whatsapp")(event.target.value)} placeholder="0812 3456 7890" /></Field>
          <div className="cms-row">
            <Field label="Telepon"><input inputMode="tel" maxLength={24} value={form.phone} onChange={event => set("phone")(event.target.value)} placeholder="021 1234 5678" /></Field>
            <Field label="Email"><input type="email" maxLength={120} value={form.email} onChange={event => set("email")(event.target.value)} placeholder="halo@venue.id" /></Field>
          </div>
          <small className="cms-hint">Alamat dan peta diatur di Info Venue.</small>
        </section>

        <section className="cms-card">
          <header><h2>Media sosial & situs</h2><p>Hanya yang diisi yang tampil di kaki halaman.</p></header>
          <div className="cms-row">
            <Field label="Instagram"><input maxLength={120} value={form.instagram} onChange={event => set("instagram")(event.target.value)} placeholder="@namavenue" /></Field>
            <Field label="TikTok"><input maxLength={120} value={form.tiktok} onChange={event => set("tiktok")(event.target.value)} placeholder="@namavenue" /></Field>
          </div>
          <Field label="Facebook"><input type="url" maxLength={300} value={form.facebook} onChange={event => set("facebook")(event.target.value)} placeholder="https://facebook.com/namavenue" /></Field>
          <Field label="YouTube"><input type="url" maxLength={300} value={form.youtube} onChange={event => set("youtube")(event.target.value)} placeholder="https://youtube.com/@namavenue" /></Field>
          <Field label="Situs web lain"><input type="url" maxLength={300} value={form.website} onChange={event => set("website")(event.target.value)} placeholder="https://namavenue.id" /></Field>
        </section>

        <section className="cms-card">
          <header><h2>Kaki halaman</h2><p>Teks di bagian paling bawah situs dan email.</p></header>
          <Field label="Teks hak cipta" hint={`Kosongkan untuk otomatis: “${copyrightLine({ name: form.name })}”.`}>
            <input maxLength={120} value={form.copyright} onChange={event => set("copyright")(event.target.value)} placeholder={copyrightLine({ name: form.name })} />
          </Field>
          <Field label="Teks tambahan" counter={`${form.footer_text.length}/300`} hint="Mis. nama badan usaha, NPWP, atau jam layanan pelanggan.">
            <textarea rows={3} maxLength={300} value={form.footer_text} onChange={event => set("footer_text")(event.target.value)} placeholder="PT Nama Usaha · NPWP 00.000.000.0-000.000" />
          </Field>
        </section>

        <section className="cms-card">
          <header><h2>Pratinjau</h2><p>Gambaran kepala dan kaki halaman situs pelanggan dengan isian di atas, sebelum disimpan.</p></header>
          <Preview form={form} brand={data.brand} primary={primary} accent={accent} />
        </section>
      </div>
      <SaveBar dirty={dirty} busy={busy} label="Simpan brand" updated={data.brand.updated_at} />
    </form>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const shown = isHex(value) ? value : fallback;
  return (
    <Field label={label} hint={value ? undefined : "Bawaan"}>
      <span className="brand-color">
        <input type="color" value={shown} onChange={event => onChange(event.target.value)} aria-label={`${label}, pilih warna`} />
        <input value={draft} maxLength={7} placeholder={fallback} spellCheck={false} aria-label={`${label}, kode warna`}
          onChange={event => { const next = event.target.value.trim(); setDraft(next); if (next === "" || isHex(next)) onChange(next.toLowerCase()); }} />
      </span>
    </Field>
  );
}

const assetSizes: Record<BrandAssetKind, { maxWidth: number; maxHeight: number; square?: boolean }> = {
  logo: { maxWidth: 800, maxHeight: 320 },
  logo_dark: { maxWidth: 800, maxHeight: 320 },
  favicon: { maxWidth: 512, maxHeight: 512, square: true },
};

function AssetTile({ kind, title, hint, brand, applied, dark = false, square = false }: {
  kind: BrandAssetKind; title: string; hint: string; brand: PublicBrand; applied: (result: BrandResponse) => void; dark?: boolean; square?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const id = brand[kind];
  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (input.current) input.current.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const blob = await brandImage(file, assetSizes[kind]);
      applied(await api<BrandResponse>(`/operations/brand/assets/${kind}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob }));
      toast.success(`${title} diperbarui`);
    } catch (problem) { toast.error((problem as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { applied(await api<BrandResponse>(`/operations/brand/assets/${kind}`, { method: "DELETE" })); toast.success(`${title} dihapus`); }
    catch (problem) { toast.error((problem as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="brand-asset">
      <div className={`brand-asset-preview${dark ? " dark" : ""}${square ? " square" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau berkas dari API sendiri */}
        {id ? <img src={assetUrl(id)} alt={`${title} saat ini`} /> : <span className="brand-asset-empty"><Orbit size={22} aria-hidden="true" /> {square ? "Ikon bawaan" : "Belum ada"}</span>}
        {busy && <i className="brand-asset-busy"><LoaderCircle size={20} className="spin" aria-hidden="true" /></i>}
      </div>
      <div className="brand-asset-text">
        <b>{title}</b>
        <small className="cms-hint">{hint}</small>
        <div className="brand-asset-actions">
          <button type="button" className="ops-secondary" disabled={busy} onClick={() => input.current?.click()}><ImageUp size={14} aria-hidden="true" /> {id ? "Ganti" : "Unggah"}</button>
          {id && <button type="button" className="ops-danger" disabled={busy} onClick={() => void remove()}><Trash2 size={14} aria-hidden="true" /> Hapus</button>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void upload(event.target.files)} />
    </div>
  );
}

function Preview({ form, brand, primary, accent }: { form: Form; brand: PublicBrand; primary: string; accent: string }) {
  const name = form.name.trim() || defaultBrandName;
  const ink = contrast(accent, "#111111") >= contrast(accent, "#ffffff") ? "#111111" : "#ffffff";
  const footLogo = brand.logo_dark ?? brand.logo;
  return (
    <div className="brand-preview" aria-hidden="true">
      <div className="brand-preview-head">
        {brand.logo
          // eslint-disable-next-line @next/next/no-img-element -- pratinjau berkas dari API sendiri
          ? <img src={assetUrl(brand.logo)} alt="" />
          : <span className="brand-preview-mark" style={{ background: primary, color: accent }}><Orbit size={14} /></span>}
        {(!brand.logo || form.show_name) && <b>{name}</b>}
        <span className="brand-preview-cta" style={{ background: primary }}>Pesan lapangan</span>
      </div>
      <div className="brand-preview-hero" style={{ background: primary }}>
        <b>Booking lapangan padel, <em style={{ color: accent }}>beres dalam semenit.</em></b>
        <small>{form.tagline || "Tagline brand tampil di sini."}</small>
        <span className="brand-preview-chip" style={{ background: accent, color: ink }}>12 slot kosong hari ini</span>
      </div>
      <div className="brand-preview-foot" style={{ background: primary }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau berkas dari API sendiri */}
        {footLogo && <img className={brand.logo_dark ? "" : "on-light"} src={assetUrl(footLogo)} alt="" />}
        {(!footLogo || form.show_name) && <b>{name}</b>}
        <small>{form.copyright || copyrightLine({ name })}{form.footer_text ? ` · ${form.footer_text}` : ""}</small>
      </div>
    </div>
  );
}
