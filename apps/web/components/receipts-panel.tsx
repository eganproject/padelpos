"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useVenueInfo } from "@/lib/use-venue-info";
import { defaultReceiptSettings, paperLabel, paperOptions, type ReceiptData, type ReceiptSettings } from "@/lib/receipt";
import { Receipt } from "./receipt";
import { ErrorBox } from "./operation-ui";
import { InfoTip } from "@/components/tooltip";

type Form = Omit<ReceiptSettings, "updated_at">;
const formFrom = (s: ReceiptSettings): Form => ({ paper: s.paper, custom_width: s.custom_width, header_note: s.header_note, footer_note: s.footer_note, show_payments: s.show_payments, show_cashier: s.show_cashier, show_logo: s.show_logo !== false });

/** Contoh booking kasir untuk pratinjau; tidak tersimpan di mana pun. */
function sample(form: Form, venue: ReceiptData["venue"]): ReceiptData {
  const now = new Date().toISOString(), date = now.slice(0, 10);
  return {
    booking: {
      id: "contoh", code: "A1B2C3D4", order_code: null, source: "staff", court_id: "", court_name: "Lapangan 1", customer: "Budi Santoso", phone: "0812 3456 7890",
      date, start_time: "19:00", end_time: "21:00", total: 475000, paid: 475000, status: "confirmed", notes: "", cancel_reason: "",
      court_total: 400000, addon_count: 2, discount: 0, discount_note: "", tax: 0, tax_rate: 0, tax_inclusive: 0, tax_label: "", forfeited: 0, forfeited_at: null,
    },
    addons: [
      { id: "r", addon_id: null, name: "Sewa raket", type: "sewa", pricing: "per_booking", unit_price: 25000, quantity: 2, subtotal: 50000, returned_at: null },
      { id: "b", addon_id: null, name: "Bola padel (3 pcs)", type: "jual", pricing: "per_booking", unit_price: 25000, quantity: 1, subtotal: 25000, returned_at: null },
    ],
    payments: [{ id: "p", amount: 475000, kind: "payment", method: "cash", note: "", created_at: now }],
    venue, settings: { ...form, updated_at: null }, cashier: "Kasir", printed_at: now,
  } as ReceiptData;
}

/** Pengaturan › Nota & Cetak: ukuran kertas bawaan, teks kepala dan kaki nota, dan pratinjau langsung. */
export function ReceiptsPanel() {
  const [saved, setSaved] = useState<ReceiptSettings | null>(null), [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const { data: venue } = useVenueInfo();
  const load = useCallback(async () => {
    try { const { settings } = await api<{ settings: ReceiptSettings }>("/operations/receipt-settings"); setSaved(settings); setForm(formFrom(settings)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const dirty = useMemo(() => !!saved && !!form && JSON.stringify(form) !== JSON.stringify(formFrom(saved)), [saved, form]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!form) return;
    setBusy(true);
    try { const { settings } = await api<{ settings: ReceiptSettings }>("/operations/receipt-settings", { method: "PUT", body: JSON.stringify(form) }); setSaved(settings); setForm(formFrom(settings)); toast.success("Pengaturan nota disimpan"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  if (error && !saved) return <ErrorBox message={error} retry={() => void load()} />;
  if (!saved || !form) return <p className="empty-state">Memuat pengaturan nota…</p>;
  const info = venue?.info;
  const preview = sample(form, { name: info?.name ?? "", address: info?.address ?? "", phone: info?.phone ?? "", whatsapp: info?.whatsapp ?? "", email: info?.email ?? "", instagram: info?.instagram ?? "", logo: venue?.brand?.logo ?? null, show_name: venue?.brand?.show_name ?? true });
  return <form className="cms-form" onSubmit={save}>
    <div className="cms-grid">
      <section className="cms-card">
        <header><h2>Ukuran kertas bawaan</h2><p>Dipakai setiap kali kasir menekan Cetak nota di detail booking. Kasir tetap bisa memilih ukuran lain untuk satu cetakan.</p></header>
        <div className="receipt-paper-choices" role="radiogroup" aria-label="Ukuran kertas">
          {paperOptions.map(option => <label key={option.value} className={`cms-check${form.paper === option.value ? " active" : ""}`}>
            <input type="radio" name="paper" checked={form.paper === option.value} onChange={() => setForm({ ...form, paper: option.value })} />
            <span><b>{option.label}</b><small className="cms-hint">{option.hint}</small></span>
          </label>)}
        </div>
        {form.paper === "custom" && <label className="cms-field"><span className="cms-label">Lebar kertas (mm)<InfoTip text="Lebar gulungan kertas printer thermal, mis. 58 atau 80. Lihat di label kertas atau buku manual printer."/></span><input type="number" min={40} max={216} required value={form.custom_width} onChange={e => setForm({ ...form, custom_width: Number(e.target.value) })} /></label>}
        <p className="cms-hint">Kertas thermal dan lebar lain dicetak sebagai kertas gulung: panjangnya mengikuti isi nota. Di dialog cetak, atur Margin ke None dan Skala 100%.</p>
      </section>
      <section className="cms-card">
        <header><h2>Isi nota</h2><p>Logo, nama, dan kontak diambil dari Pengaturan &gt; Brand; alamat dari Info Venue.</p></header>
        <label className="cms-field"><span className="cms-label">Teks kepala (opsional)<InfoTip text="Tercetak di bawah nama venue, mis. NPWP, nomor izin usaha, atau jam operasional."/></span><input maxLength={160} value={form.header_note} placeholder="Mis. NPWP 01.234.567.8-901.000" onChange={e => setForm({ ...form, header_note: e.target.value })} /></label>
        <label className="cms-field"><span className="cms-label">Teks kaki<InfoTip text="Tercetak di bagian bawah nota, mis. ucapan terima kasih, kebijakan refund, atau akun media sosial."/></span><textarea maxLength={300} rows={3} value={form.footer_note} onChange={e => setForm({ ...form, footer_note: e.target.value })} /></label>
        <label className="cms-check"><input type="checkbox" checked={form.show_payments} onChange={e => setForm({ ...form, show_payments: e.target.checked })} /> Tampilkan rincian setiap pembayaran (DP, pelunasan, metode)</label>
        <label className="cms-check"><input type="checkbox" checked={form.show_cashier} onChange={e => setForm({ ...form, show_cashier: e.target.checked })} /> Tampilkan nama kasir yang mencetak</label>
        <label className="cms-check"><input type="checkbox" checked={form.show_logo} onChange={e => setForm({ ...form, show_logo: e.target.checked })} /> Tampilkan logo brand di kepala nota</label>
        <button type="button" className="ops-secondary" onClick={() => setForm(formFrom({ ...defaultReceiptSettings, updated_at: null }))}>Kembalikan ke bawaan</button>
      </section>
    </div>
    <section className="cms-card">
      <header><h2>Pratinjau · {paperLabel(form.paper, form.custom_width)}</h2><p>Contoh nota booking kasir dengan sewa raket. Ukuran di layar sama dengan hasil cetak.</p></header>
      <div className="receipt-preview"><Receipt data={preview} /></div>
    </section>
    <div className={`cms-savebar${dirty ? " dirty" : ""}`}>
      <span>{dirty ? "Ada perubahan yang belum disimpan." : saved.updated_at ? `Terakhir disimpan ${new Date(saved.updated_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}.` : "Memakai pengaturan bawaan (thermal 80 mm)."}</span>
      <button className="ops-primary" type="submit" disabled={!dirty || busy}>{busy ? "Menyimpan…" : "Simpan pengaturan"}</button>
    </div>
  </form>;
}
