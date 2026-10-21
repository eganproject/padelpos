"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Circle, CircleCheck, ExternalLink, HelpCircle, Plus, ScrollText, Sparkles, Store, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  facilityKinds, facilityLabels, formatUpdated, hasCancellationPolicy, mapsEmbed, refundDaysLine, refundLines, rescheduleLine,
  type Faq, type FacilityKind, type Policies, type RefundTier, type VenueInfo,
} from "@/lib/venue-info";
import { FacilityIcon } from "./facility-icon";
import { RichText } from "./rich-text";
import { ErrorBox } from "./operation-ui";
import { Select } from "./form-controls";

type ContentResponse = {
  info: VenueInfo;
  policies: Policies;
  faqs: { items: Faq[]; updated_at: string | null };
  courts: { id: string; name: string; photos: number; description: boolean }[];
};
type Tab = "profil" | "fasilitas" | "kebijakan" | "faq";
const tabs: { id: Tab; label: string; icon: typeof Store }[] = [
  { id: "profil", label: "Profil & lokasi", icon: Store },
  { id: "fasilitas", label: "Fasilitas", icon: Sparkles },
  { id: "kebijakan", label: "Kebijakan", icon: ScrollText },
  { id: "faq", label: "FAQ", icon: HelpCircle },
];

export function VenueInfoPanel() {
  const [data, setData] = useState<ContentResponse | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("profil");
  const [dirty, setDirty] = useState<Record<Tab, boolean>>({ profil: false, fasilitas: false, kebijakan: false, faq: false });

  const load = useCallback(async () => {
    try { setData(await api<ContentResponse>("/operations/content")); setError(""); }
    catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Tautan seperti /admin/info#kebijakan langsung membuka tab yang dituju.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (tabs.some(item => item.id === hash)) setTab(hash as Tab);
  }, []);
  const open = useCallback((next: Tab) => {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  }, []);

  const anyDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const mark = useCallback((key: Tab) => (value: boolean) => setDirty(previous => previous[key] === value ? previous : { ...previous, [key]: value }), []);
  const dirtyProfile = useMemo(() => mark("profil"), [mark]);
  const dirtyFacilities = useMemo(() => mark("fasilitas"), [mark]);
  const dirtyPolicies = useMemo(() => mark("kebijakan"), [mark]);
  const dirtyFaq = useMemo(() => mark("faq"), [mark]);
  const savedInfo = useCallback((info: VenueInfo) => setData(previous => previous && { ...previous, info }), []);

  if (!data) return error ? <ErrorBox message={error} retry={load} /> : <p className="empty-state">Memuat informasi venue…</p>;

  return (
    <div className="cms">
      <Checklist data={data} open={open} />

      <div className="cms-tabs" role="tablist" aria-label="Bagian informasi venue">
        {tabs.map(item => (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} onClick={() => open(item.id)}>
            <item.icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
            {dirty[item.id] && <i className="cms-dot" title="Ada perubahan yang belum disimpan" />}
          </button>
        ))}
        <a className="cms-site-link" href="/" target="_blank" rel="noopener"><ExternalLink size={15} aria-hidden="true" /> Lihat situs</a>
      </div>

      {/* Semua tab tetap terpasang agar isian yang belum disimpan tidak hilang saat berpindah tab. */}
      <div role="tabpanel" id="panel-profil" aria-labelledby="tab-profil" hidden={tab !== "profil"}>
        <ProfileForm info={data.info} saved={savedInfo} onDirty={dirtyProfile} />
      </div>
      <div role="tabpanel" id="panel-fasilitas" aria-labelledby="tab-fasilitas" hidden={tab !== "fasilitas"}>
        <FacilitiesForm info={data.info} saved={savedInfo} onDirty={dirtyFacilities} />
      </div>
      <div role="tabpanel" id="panel-kebijakan" aria-labelledby="tab-kebijakan" hidden={tab !== "kebijakan"}>
        <PoliciesForm policies={data.policies} saved={policies => setData(previous => previous && { ...previous, policies })} onDirty={dirtyPolicies} />
      </div>
      <div role="tabpanel" id="panel-faq" aria-labelledby="tab-faq" hidden={tab !== "faq"}>
        <FaqForm faqs={data.faqs} saved={faqs => setData(previous => previous && { ...previous, faqs })} onDirty={dirtyFaq} />
      </div>
    </div>
  );
}

function Checklist({ data, open }: { data: ContentResponse; open: (tab: Tab) => void }) {
  const courts = data.courts;
  const withPhoto = courts.filter(court => court.photos > 0).length, described = courts.filter(court => court.description).length;
  const items: { label: string; done: boolean; tab?: Tab; href?: string }[] = [
    { label: "Alamat venue", done: data.info.address !== "", tab: "profil" },
    { label: "Nomor WhatsApp", done: data.info.whatsapp !== "", href: "/admin/brand" },
    { label: `Foto lapangan (${withPhoto}/${courts.length})`, done: courts.length > 0 && withPhoto === courts.length, href: "/admin/courts" },
    { label: `Deskripsi lapangan (${described}/${courts.length})`, done: courts.length > 0 && described === courts.length, href: "/admin/courts" },
    { label: "Fasilitas", done: data.info.facilities.length + data.info.extra_facilities.length > 0, tab: "fasilitas" },
    { label: "Kebijakan pembatalan", done: hasCancellationPolicy(data.policies), tab: "kebijakan" },
    { label: "Syarat & ketentuan", done: data.policies.terms !== "", tab: "kebijakan" },
    { label: `Minimal 3 FAQ (${data.faqs.items.length})`, done: data.faqs.items.length >= 3, tab: "faq" },
  ];
  const done = items.filter(item => item.done).length;
  return (
    <section className="cms-checklist" aria-labelledby="kelengkapan">
      <div className="cms-checklist-head">
        <div>
          <h2 id="kelengkapan">Kelengkapan informasi</h2>
          <p>{done === items.length ? "Semua informasi penting sudah tampil untuk pelanggan." : "Informasi yang lengkap membuat pelanggan lebih yakin memesan. Klik yang belum lengkap untuk mengisinya."}</p>
        </div>
        <strong>{done}<small>/{items.length}</small></strong>
      </div>
      <div className="cms-progress" role="progressbar" aria-label="Kelengkapan informasi" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
        <i style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul>
        {items.map(item => (
          <li key={item.label} className={item.done ? "done" : ""}>
            {item.done ? <CircleCheck size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
            {item.href
              ? <Link href={item.href}>{item.label}<span className="sr-only">{item.done ? " (lengkap)" : " (belum lengkap)"}</span></Link>
              : <button type="button" onClick={() => open(item.tab!)}>{item.label}<span className="sr-only">{item.done ? " (lengkap)" : " (belum lengkap)"}</span></button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Field({ label, hint, counter, children, className = "" }: { label: string; hint?: React.ReactNode; counter?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`cms-field ${className}`.trim()}>
      <span className="cms-label">{label}{counter && <small>{counter}</small>}</span>
      {children}
      {hint && <small className="cms-hint">{hint}</small>}
    </label>
  );
}

export function SaveBar({ dirty, busy, label, updated }: { dirty: boolean; busy: boolean; label: string; updated: string | null }) {
  return (
    <div className={`cms-savebar${dirty ? " dirty" : ""}`}>
      <span role="status">{dirty ? "Ada perubahan yang belum disimpan." : updated ? `Tersimpan · ${formatUpdated(updated)}` : "Belum pernah disimpan."}</span>
      <button className="ops-primary" type="submit" disabled={busy || !dirty}>{busy ? "Menyimpan…" : <><Check size={16} aria-hidden="true" /> {label}</>}</button>
    </div>
  );
}

/** Menyimpan dokumen dan menampilkan galat di atas form. */
function useSave<T>(path: string, done: (result: T) => void, message: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (body: unknown) => {
    setBusy(true); setError("");
    try { done(await api<T>(path, { method: "PUT", body: JSON.stringify(body) })); toast.success(message); }
    catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  };
  return { busy, error, save };
}

// Nama, tagline, dan kontak diatur di Pengaturan > Brand; form ini hanya menyimpan kolom berikut.
const profileKeys = ["about", "address", "maps_url", "show_map", "hours_note", "max_booking_hours"] as const;
type ProfileFields = Pick<VenueInfo, typeof profileKeys[number]>;
const pickProfile = (info: VenueInfo) => Object.fromEntries(profileKeys.map(key => [key, info[key]])) as ProfileFields;
const editableProfile = (info: VenueInfo): ProfileFields => pickProfile(info);

function ProfileForm({ info, saved, onDirty }: { info: VenueInfo; saved: (info: VenueInfo) => void; onDirty: (dirty: boolean) => void }) {
  const [form, setForm] = useState(() => editableProfile(info));
  const [mapAddress, setMapAddress] = useState(info.address);
  const dirty = JSON.stringify(form) !== JSON.stringify(pickProfile(info));
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // Pratinjau peta menunggu admin berhenti mengetik agar tidak memuat ulang di setiap huruf.
  useEffect(() => { const timer = window.setTimeout(() => setMapAddress(form.address.trim()), 900); return () => window.clearTimeout(timer); }, [form.address]);
  const { busy, error, save } = useSave<{ info: VenueInfo }>("/operations/content/info", result => { setForm(editableProfile(result.info)); saved(result.info); }, "Profil & lokasi disimpan");
  const set = <K extends keyof ProfileFields>(key: K) => (value: ProfileFields[K]) => setForm(previous => ({ ...previous, [key]: value }));

  return (
    <form className="cms-form" onSubmit={event => { event.preventDefault(); void save({ ...info, ...form }); }}>
      {error && <ErrorBox message={error} />}
      <div className="cms-grid">
        <section className="cms-card">
          <header><h2>Tentang venue</h2><p>Cerita singkat yang tampil di beranda.</p></header>
          <Field label="Tentang venue" counter={`${form.about.length}/1500`} hint="Pisahkan paragraf dengan baris kosong.">
            <textarea rows={6} maxLength={1500} value={form.about} onChange={event => set("about")(event.target.value)} />
          </Field>
          <p className="cms-hint">Nama, tagline, logo, WhatsApp, email, dan media sosial sekarang diatur di <Link href="/admin/brand">Pengaturan › Brand</Link>.</p>
        </section>
        <section className="cms-card">
          <header><h2>Jam buka & booking</h2><p>Keterangan jam buka dan batas lama booking online.</p></header>
          <Field label="Keterangan jam buka"><input maxLength={120} value={form.hours_note} onChange={event => set("hours_note")(event.target.value)} placeholder="Setiap hari, 06.00–23.00" /></Field>
          <Field label="Lama booking online" hint="Batas lama main untuk satu booking dari situs pelanggan. Booking lewat kasir tidak dibatasi.">
            <Select value={form.max_booking_hours ?? 0} onChange={event => set("max_booking_hours")(Number(event.target.value))}>
              <option value={0}>Bebas, sampai jam tutup lapangan</option>
              {[2, 3, 4, 5, 6, 8, 10, 12].map(hours => <option key={hours} value={hours}>Maksimal {hours} jam</option>)}
            </Select>
          </Field>
        </section>
        <section className="cms-card wide">
          <header><h2>Lokasi</h2><p>Alamat, petunjuk arah, dan peta di bagian “Lokasi” pada beranda.</p></header>
          <div className="cms-location">
            <div className="cms-stack">
              <Field label="Alamat lengkap" counter={`${form.address.length}/240`}>
                <textarea rows={3} maxLength={240} value={form.address} onChange={event => set("address")(event.target.value)} placeholder="Jalan, nomor, kelurahan, kecamatan, kota" />
              </Field>
              <Field label="Tautan Google Maps (opsional)" hint="Buka lokasi venue di Google Maps, pilih Bagikan, lalu salin tautannya. Bila kosong, tombol petunjuk arah mencari alamat di atas.">
                <input type="url" maxLength={500} value={form.maps_url} onChange={event => set("maps_url")(event.target.value)} placeholder="https://maps.app.goo.gl/…" />
              </Field>
              <label className="cms-check"><input type="checkbox" checked={form.show_map} onChange={event => set("show_map")(event.target.checked)} /> Tampilkan peta di situs pelanggan</label>
            </div>
            <div className="cms-map-preview">
              {mapAddress && form.show_map
                ? <iframe title="Pratinjau peta lokasi" src={mapsEmbed(mapAddress)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                : <p>{form.show_map ? "Isi alamat untuk melihat pratinjau peta." : "Peta tidak ditampilkan di situs pelanggan."}</p>}
            </div>
          </div>
        </section>
      </div>
      <SaveBar dirty={dirty} busy={busy} label="Simpan profil & lokasi" updated={info.updated_at} />
    </form>
  );
}

function FacilitiesForm({ info, saved, onDirty }: { info: VenueInfo; saved: (info: VenueInfo) => void; onDirty: (dirty: boolean) => void }) {
  const [facilities, setFacilities] = useState<FacilityKind[]>(info.facilities);
  const [extras, setExtras] = useState<string[]>(info.extra_facilities);
  const [draft, setDraft] = useState("");
  const sorted = (list: string[]) => [...list].sort();
  const dirty = JSON.stringify([sorted(facilities), extras]) !== JSON.stringify([sorted(info.facilities), info.extra_facilities]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const { busy, error, save } = useSave<{ info: VenueInfo }>("/operations/content/info", result => {
    setFacilities(result.info.facilities); setExtras(result.info.extra_facilities); saved(result.info);
  }, "Fasilitas disimpan");

  const name = draft.trim();
  const duplicate = extras.some(item => item.toLowerCase() === name.toLowerCase());
  const canAdd = name.length >= 2 && !duplicate && extras.length < 10;
  const add = () => { if (!canAdd) return; setExtras([...extras, name]); setDraft(""); };

  return (
    <form className="cms-form" onSubmit={event => { event.preventDefault(); void save({ ...info, facilities, extra_facilities: extras }); }}>
      {error && <ErrorBox message={error} />}
      <div className="cms-grid">
        <section className="cms-card wide">
          <header><h2>Fasilitas umum</h2><p>Pilih yang tersedia. Tampil sebagai daftar ikon di beranda.</p></header>
          <div className="cms-facilities">
            {facilityKinds.map(kind => {
              const on = facilities.includes(kind);
              return (
                <button key={kind} type="button" aria-pressed={on} onClick={() => setFacilities(on ? facilities.filter(item => item !== kind) : [...facilities, kind])}>
                  <FacilityIcon kind={kind} />
                  <span>{facilityLabels[kind]}</span>
                  <i aria-hidden="true">{on && <Check size={13} />}</i>
                </button>
              );
            })}
          </div>
        </section>
        <section className="cms-card wide">
          <header><h2>Fasilitas lain</h2><p>Tambahkan yang tidak ada di daftar, misalnya “Ruang ganti ber-AC”. Maksimal 10.</p></header>
          <div className="cms-inline">
            <input maxLength={40} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Nama fasilitas"
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} aria-label="Nama fasilitas lain" />
            <button type="button" className="ops-secondary" onClick={add} disabled={!canAdd}><Plus size={15} aria-hidden="true" /> Tambah</button>
          </div>
          {duplicate && name && <small className="cms-hint warn">Fasilitas ini sudah ada di daftar.</small>}
          {extras.length > 0 ? (
            <ul className="cms-chips">
              {extras.map(item => (
                <li key={item}>{item}<button type="button" onClick={() => setExtras(extras.filter(value => value !== item))} aria-label={`Hapus ${item}`}><X size={14} /></button></li>
              ))}
            </ul>
          ) : <p className="cms-empty">Belum ada fasilitas tambahan.</p>}
        </section>
      </div>
      <SaveBar dirty={dirty} busy={busy} label="Simpan fasilitas" updated={info.updated_at} />
    </form>
  );
}

type PolicyFields = Omit<Policies, "updated_at">;
const pickPolicies = ({ updated_at: _, ...fields }: Policies): PolicyFields => fields;

function PoliciesForm({ policies, saved, onDirty }: { policies: Policies; saved: (policies: Policies) => void; onDirty: (dirty: boolean) => void }) {
  const [form, setForm] = useState<PolicyFields>(() => pickPolicies(policies));
  const dirty = JSON.stringify(form) !== JSON.stringify(pickPolicies(policies));
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const { busy, error, save } = useSave<{ policies: Policies }>("/operations/content/policies", result => { setForm(pickPolicies(result.policies)); saved(result.policies); }, "Kebijakan disimpan");
  const set = <K extends keyof PolicyFields>(key: K, value: PolicyFields[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const setTier = (index: number, patch: Partial<RefundTier>) => set("refund_tiers", form.refund_tiers.map((tier, i) => i === index ? { ...tier, ...patch } : tier));
  const addTier = () => {
    const last = [...form.refund_tiers].sort((a, b) => b.hours - a.hours).at(-1);
    set("refund_tiers", [...form.refund_tiers, last ? { hours: Math.floor(last.hours / 4), percent: Math.max(1, Math.floor(last.percent / 2)) } : { hours: 24, percent: 100 }]);
  };

  const ordered = [...form.refund_tiers].sort((a, b) => b.hours - a.hours);
  const problem = ordered.some((tier, i) => i > 0 && tier.hours === ordered[i - 1].hours) ? "Dua tingkat memakai batas jam yang sama."
    : ordered.some((tier, i) => i > 0 && tier.percent > ordered[i - 1].percent) ? "Persentase tidak boleh lebih besar saat pembatalan makin dekat ke jam main."
    : "";
  const preview = [...refundLines(form).map(line => `${line.when}: ${line.result.toLowerCase()}.`), rescheduleLine(form), refundDaysLine(form)].filter(Boolean) as string[];

  return (
    <form className="cms-form" onSubmit={event => { event.preventDefault(); void save(form); }}>
      {error && <ErrorBox message={error} />}
      <div className="cms-grid">
        <section className="cms-card wide">
          <header><h2>Pembatalan & pengembalian dana</h2><p>Aturan ini tampil di halaman Kebijakan dan di ringkasan pesanan pelanggan.</p></header>
          <div className="cms-policy">
            <div className="cms-stack">
              <span className="cms-label">Tingkat pengembalian dana</span>
              {form.refund_tiers.length === 0 && <p className="cms-empty">Belum ada aturan pengembalian dana.</p>}
              {form.refund_tiers.map((tier, index) => (
                <div className="cms-tier" key={index}>
                  <span>Paling lambat</span>
                  <input type="number" min={0} max={720} value={tier.hours} onChange={event => setTier(index, { hours: Number(event.target.value) })} aria-label="Jam sebelum main" />
                  <span>jam sebelum main → kembali</span>
                  <input type="number" min={1} max={100} value={tier.percent} onChange={event => setTier(index, { percent: Number(event.target.value) })} aria-label="Persentase dana kembali" />
                  <span>%</span>
                  <button type="button" className="cms-icon danger" onClick={() => set("refund_tiers", form.refund_tiers.filter((_, i) => i !== index))} aria-label="Hapus tingkat ini"><Trash2 size={15} /></button>
                </div>
              ))}
              {problem && <small className="cms-hint warn" role="alert">{problem}</small>}
              <button type="button" className="ops-secondary cms-add" onClick={addTier} disabled={form.refund_tiers.length >= 4}><Plus size={15} aria-hidden="true" /> Tambah tingkat</button>

              <div className="cms-row">
                <Field label="Ubah jadwal">
                  <Select value={form.reschedule} onChange={event => set("reschedule", event.target.value as PolicyFields["reschedule"])}>
                    <option value="unset">Tidak ditampilkan</option>
                    <option value="yes">Boleh ubah jadwal</option>
                    <option value="no">Tidak boleh ubah jadwal</option>
                  </Select>
                </Field>
                {form.reschedule === "yes" && (
                  <Field label="Batas ubah jadwal (jam)" hint="0 berarti boleh kapan pun sebelum jam main.">
                    <input type="number" min={0} max={720} value={form.reschedule_hours} onChange={event => set("reschedule_hours", Number(event.target.value))} />
                  </Field>
                )}
              </div>
              <Field label="Lama proses pengembalian dana (hari kerja)" hint="Isi 0 bila tidak ingin ditampilkan.">
                <input type="number" min={0} max={60} value={form.refund_days} onChange={event => set("refund_days", Number(event.target.value))} />
              </Field>
              <Field label="Catatan tambahan" counter={`${form.cancellation_note.length}/1500`} hint="Mis. pengecualian saat hujan untuk lapangan outdoor.">
                <textarea rows={3} maxLength={1500} value={form.cancellation_note} onChange={event => set("cancellation_note", event.target.value)} />
              </Field>
            </div>
            <aside className="cms-preview" aria-label="Pratinjau untuk pelanggan">
              <small>Yang dilihat pelanggan</small>
              {preview.length || form.cancellation_note ? (
                <>
                  <ul>{preview.map(line => <li key={line}>{line}</li>)}</ul>
                  {form.cancellation_note && <RichText text={form.cancellation_note} />}
                </>
              ) : <p>Bagian pembatalan belum tampil di situs.</p>}
            </aside>
          </div>
        </section>
        <section className="cms-card wide">
          <header><h2>Syarat & ketentuan</h2><p>Aturan main di venue. Baris kosong memisahkan paragraf; awali baris dengan “- ” untuk daftar poin atau “1. ” untuk daftar bernomor.</p></header>
          <Field label="Isi syarat & ketentuan" counter={`${form.terms.length}/10000`}>
            <textarea className="tall" rows={14} maxLength={10000} value={form.terms} onChange={event => set("terms", event.target.value)}
              placeholder={"Harap datang 10 menit sebelum jam main.\n\n- Wajib memakai sepatu olahraga bersol karet.\n- Maksimal 4 pemain per lapangan."} />
          </Field>
          {form.terms && (
            <details className="cms-details">
              <summary>Pratinjau tampilan</summary>
              <RichText text={form.terms} />
            </details>
          )}
        </section>
      </div>
      <SaveBar dirty={dirty} busy={busy || !!problem} label="Simpan kebijakan" updated={policies.updated_at} />
    </form>
  );
}

const suggestions = [
  "Apakah bisa sewa raket dan bola?",
  "Berapa pemain dalam satu lapangan?",
  "Apakah lapangan indoor tetap bisa dipakai saat hujan?",
  "Apakah tersedia tempat parkir?",
  "Bagaimana cara membatalkan atau mengubah jadwal?",
  "Apakah wajib memakai sepatu khusus?",
  "Apakah tersedia pelatih untuk pemula?",
  "Metode pembayaran apa saja yang diterima?",
];

function FaqForm({ faqs, saved, onDirty }: { faqs: ContentResponse["faqs"]; saved: (faqs: ContentResponse["faqs"]) => void; onDirty: (dirty: boolean) => void }) {
  const [items, setItems] = useState<Faq[]>(faqs.items);
  const [focus, setFocus] = useState<string | null>(null);
  const dirty = JSON.stringify(items) !== JSON.stringify(faqs.items);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => { if (focus) { document.getElementById(focus)?.focus(); setFocus(null); } }, [focus]);
  const { busy, error, save } = useSave<{ faqs: ContentResponse["faqs"] }>("/operations/content/faqs", result => { setItems(result.faqs.items); saved(result.faqs); }, "FAQ disimpan");

  const update = (index: number, patch: Partial<Faq>) => setItems(items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const add = (question = "") => {
    const id = crypto.randomUUID();
    setItems([...items, { id, question, answer: "" }]);
    setFocus(`faq-${id}-${question ? "a" : "q"}`);
  };
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setItems(next);
  };
  const remove = (index: number) => {
    const item = items[index];
    if ((item.question || item.answer) && !confirm(`Hapus pertanyaan “${item.question || "tanpa judul"}”?`)) return;
    setItems(items.filter((_, i) => i !== index));
  };
  const remaining = suggestions.filter(question => !items.some(item => item.question.trim().toLowerCase() === question.toLowerCase()));

  return (
    <form className="cms-form" onSubmit={event => { event.preventDefault(); void save({ items }); }}>
      {error && <ErrorBox message={error} />}
      <section className="cms-card">
        <header><h2>Pertanyaan yang sering diajukan</h2><p>Tiga pertanyaan teratas juga tampil di beranda. Urutkan dari yang paling sering ditanyakan.</p></header>
        {items.length === 0 && <p className="cms-empty">Belum ada pertanyaan. Mulai dari saran di bawah, atau tulis sendiri.</p>}
        <ol className="cms-faqs">
          {items.map((item, index) => (
            <li className="cms-faq" key={item.id}>
              <div className="cms-faq-head">
                <span className="cms-faq-number">{index + 1}</span>
                <div className="cms-faq-actions">
                  <button type="button" className="cms-icon" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Pindah ke atas"><ArrowUp size={15} /></button>
                  <button type="button" className="cms-icon" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Pindah ke bawah"><ArrowDown size={15} /></button>
                  <button type="button" className="cms-icon danger" onClick={() => remove(index)} aria-label="Hapus pertanyaan"><Trash2 size={15} /></button>
                </div>
              </div>
              <Field label="Pertanyaan" counter={`${item.question.length}/160`}>
                <input id={`faq-${item.id}-q`} required minLength={5} maxLength={160} value={item.question} onChange={event => update(index, { question: event.target.value })} />
              </Field>
              <Field label="Jawaban" counter={`${item.answer.length}/1500`}>
                <textarea id={`faq-${item.id}-a`} required minLength={2} maxLength={1500} rows={3} value={item.answer} onChange={event => update(index, { answer: event.target.value })} />
              </Field>
            </li>
          ))}
        </ol>
        <button type="button" className="ops-secondary cms-add" onClick={() => add()} disabled={items.length >= 30}><Plus size={15} aria-hidden="true" /> Tambah pertanyaan</button>
        {remaining.length > 0 && items.length < 30 && (
          <div className="cms-suggest">
            <span className="cms-label">Saran pertanyaan</span>
            <div>{remaining.map(question => <button type="button" key={question} onClick={() => add(question)}><Plus size={13} aria-hidden="true" /> {question}</button>)}</div>
          </div>
        )}
      </section>
      <SaveBar dirty={dirty} busy={busy} label="Simpan FAQ" updated={faqs.updated_at} />
    </form>
  );
}
