"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { DateInput, Select } from "./form-controls";
import { ErrorBox } from "./operation-ui";

type Entry = { id:number; action:string; target_id:string; created_at:string; actor_id:string; actor_name:string; actor_kind:"staff"|"customer"|"system"|"unknown"; detail:Record<string,unknown>|null };
type Filters = { actions:string[]; staff:{id:string;name:string}[]; today:string };
type Response = { entries:Entry[]; next_before:number|null; filters:Filters };

/** Nama aksi yang dipahami kasir dan pemilik. Aksi yang belum terdaftar tampil apa adanya. */
const actionLabels: Record<string,string> = {
  "booking.create":"Booking dibuat", "booking.reschedule":"Jadwal dipindah staf", "booking.reschedule.customer":"Jadwal dipindah pelanggan",
  "booking.cancelled":"Booking dibatalkan", "booking.confirmed":"Booking dikonfirmasi", "booking.completed":"Booking selesai", "booking.pending":"Booking dikembalikan ke menunggu",
  "booking.discount":"Potongan harga", "booking.forfeit":"Denda / hangus", "booking.addons":"Tambahan booking diubah", "booking.addons.return":"Barang sewa dikembalikan",
  "booking.expired":"Booking kedaluwarsa", "booking.account.link":"Booking ditautkan ke akun", "booking.account.unlink":"Tautan akun dilepas",
  payment:"Pembayaran dicatat", refund:"Refund", "payment.link":"Tautan bayar dibuat", "payment.settled":"Pembayaran online diterima", "payment.failed":"Pembayaran online gagal", "payment.expired":"Tautan bayar kedaluwarsa", "payment.cancelled":"Pembayaran online dibatalkan", "payment.settings":"Pengaturan pembayaran",
  "order.checkout":"Checkout online",
  "court.create":"Lapangan ditambah", "court.update":"Lapangan diubah", "court.delete":"Lapangan dihapus", "court.photo.add":"Foto lapangan ditambah", "court.photo.delete":"Foto lapangan dihapus", "court.photo.order":"Urutan foto diubah",
  "price_rule.save":"Tarif khusus disimpan", "price_rule.delete":"Tarif khusus dihapus", "maintenance.create":"Jadwal perawatan dibuat", "maintenance.delete":"Jadwal perawatan dihapus", "layout.update":"Denah diubah",
  "addon.create":"Item tambahan dibuat", "addon.update":"Item tambahan diubah", "addon.delete":"Item tambahan dihapus", "addon.stock":"Stok disesuaikan", "addon.order":"Urutan item diubah", "addon.photo.set":"Foto item diganti", "addon.photo.delete":"Foto item dihapus",
  "journal.create":"Jurnal dibuat", "journal.update":"Jurnal diubah", "journal.delete":"Jurnal dihapus",
  "finance.record.create":"Catatan kas dibuat", "finance.record.update":"Catatan kas diubah", "finance.record.delete":"Catatan kas dihapus", "finance.record.settle":"Tagihan dilunasi", "finance.record.unsettle":"Pelunasan dibatalkan",
  "finance.receipt.set":"Bukti diunggah", "finance.receipt.delete":"Bukti dihapus", "finance.transfer":"Pindah dana", "finance.equity":"Modal pemilik", "finance.settings":"Pengaturan keuangan",
  "finance.account.create":"Akun dibuat", "finance.account.update":"Akun diubah", "finance.account.delete":"Akun dihapus", "finance.partner.create":"Pemasok dibuat", "finance.partner.update":"Pemasok diubah", "finance.partner.delete":"Pemasok dihapus",
  "user.create":"Pengguna dibuat", "user.update":"Pengguna diubah", "user.delete":"Pengguna dihapus", "role.create":"Role dibuat", "role.update":"Role diubah", "role.delete":"Role dihapus",
  "menu.create":"Menu dibuat", "menu.update":"Menu diubah", "menu.delete":"Menu dihapus", "password.change":"Password diganti",
  "customer.signup":"Pelanggan mendaftar", "customer.profile":"Profil pelanggan diubah", "customer.claim":"Booking diklaim pelanggan", "customer.delete":"Akun pelanggan dihapus", "customer_login.settings":"Pengaturan login pelanggan",
  "email.settings":"Pengaturan email", "email.test":"Email uji", "email.retry":"Email dikirim ulang",
  "backup.create":"Backup dibuat", "backup.download":"Backup diunduh", "backup.delete":"Backup dihapus", "backup.settings":"Jadwal backup diubah",
};
const groupLabels: Record<string,string> = { booking:"Booking", payment:"Pembayaran", refund:"Refund", order:"Checkout online", court:"Lapangan", price_rule:"Tarif", maintenance:"Perawatan", layout:"Denah", addon:"Sewa & tambahan", journal:"Jurnal", finance:"Keuangan", user:"Pengguna", role:"Role", menu:"Menu", password:"Password", customer:"Pelanggan", customer_login:"Login pelanggan", email:"Email", backup:"Backup", content:"Info venue" };
const labelFor = (action:string) => actionLabels[action] ?? (action.startsWith("content.") ? "Info venue diubah" : action);
const fieldLabels: Record<string,string> = { before:"Sebelum", after:"Sesudah", amount:"Jumlah", total:"Total", paid:"Dibayar", paid_before:"Dibayar sebelumnya", method:"Metode", note:"Catatan", reason:"Alasan", date:"Tanggal", start_time:"Mulai", end_time:"Selesai", court:"Lapangan", court_id:"Lapangan", customer:"Pelanggan", discount:"Potongan", forfeit:"Denda", number:"Nomor", memo:"Memo", description:"Keterangan", kind:"Jenis", from:"Dari", to:"Ke", direction:"Arah", cash_account:"Akun kas", account:"Akun", settle:"Pelunasan", locked_until:"Dikunci sampai", tax:"Pajak", rows:"Jumlah baris", lines:"Baris jurnal" };
const moneyKeys = new Set(["amount","total","paid","paid_before","discount","forfeit","court_total","addon_total"]);
const rupiah = new Intl.NumberFormat("id-ID", { style:"currency", currency:"IDR", maximumFractionDigits:0 });

function formatValue(key:string, value:unknown):string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" && moneyKeys.has(key)) return rupiah.format(value);
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (typeof value === "object") return Object.entries(value as Record<string,unknown>).map(([k,v]) => `${fieldLabels[k] ?? k}: ${formatValue(k,v)}`).join(", ");
  return String(value);
}
function Detail({ detail }:{ detail:Record<string,unknown> }) {
  return <dl className="audit-detail">{Object.entries(detail).map(([key,value]) => <div key={key}><dt>{fieldLabels[key] ?? key}</dt><dd>{formatValue(key,value)}</dd></div>)}</dl>;
}

/** Log Aktivitas: siapa mengubah apa dan kapan, terutama aksi yang menyangkut uang. */
export function AuditPanel() {
  const [filters, setFilters] = useState<Filters|null>(null);
  const [entries, setEntries] = useState<Entry[]>([]), [next, setNext] = useState<number|null>(null);
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [actor, setActor] = useState(""), [action, setAction] = useState(""), [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [open, setOpen] = useState<number|null>(null);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 350); return () => clearTimeout(timer); }, [query]);
  const params = useMemo(() => { const p = new URLSearchParams({ limit:"50" }); if (from) p.set("from", from); if (to) p.set("to", to); if (actor) p.set("actor", actor); if (action) p.set("action", action); if (search) p.set("q", search); return p; }, [from, to, actor, action, search]);
  const load = useCallback(async (before?:number) => {
    setBusy(true);
    try {
      const p = new URLSearchParams(params); if (before) p.set("before", String(before));
      const result = await api<Response>(`/operations/audit?${p}`);
      setFilters(result.filters); setNext(result.next_before); setError("");
      setEntries(current => before ? [...current, ...result.entries] : result.entries);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [params]);
  useEffect(() => { void load(); }, [load]);
  const groups = useMemo(() => [...new Set((filters?.actions ?? []).map(name => name.split(".")[0]))].sort(), [filters]);

  if (error && !filters) return <ErrorBox message={error} retry={() => void load()}/>;
  return <>
    {error && <ErrorBox message={error}/>}
    <div className="ops-filters">
      <label>Cari<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Kode data atau isi rincian, mis. nomor jurnal"/></label>
      <label>Dari<DateInput value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}/></label>
      <label>Sampai<DateInput value={to} min={from || undefined} onChange={e => setTo(e.target.value)}/></label>
      <label>Pelaku<Select value={actor} onChange={e => setActor(e.target.value)}><option value="">Semua</option>{filters?.staff.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}<option value="sistem">Sistem</option><option value="midtrans">Midtrans</option></Select></label>
      <label>Jenis<Select value={action} onChange={e => setAction(e.target.value)}><option value="">Semua aksi</option>{groups.map(group => <option key={group} value={group}>{groupLabels[group] ?? group}</option>)}</Select></label>
      <button className="ops-secondary" onClick={() => { setFrom(""); setTo(""); setActor(""); setAction(""); setQuery(""); }}>Reset</button>
      <button className="ops-secondary" onClick={() => void load()} disabled={busy} aria-label="Muat ulang"><RefreshCw size={14}/></button>
    </div>
    <div className="manage-table-card ops-table table-cards"><table>
      <thead><tr><th>Waktu</th><th>Pelaku</th><th>Aksi</th><th>Data</th><th>Rincian</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id}>
        <td data-label="Waktu">{new Date(entry.created_at).toLocaleString("id-ID", { dateStyle:"medium", timeStyle:"short" })}</td>
        <td data-label="Pelaku"><b>{entry.actor_name}</b><small className="table-description">{entry.actor_kind === "staff" ? "Staf" : entry.actor_kind === "customer" ? "Pelanggan" : entry.actor_kind === "system" ? "Otomatis" : entry.actor_id.slice(0, 8)}</small></td>
        <td data-label="Aksi">{labelFor(entry.action)}</td>
        <td className="wide" data-label="Data"><code className="audit-target" title={entry.target_id}>{/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(entry.target_id) ? entry.target_id.slice(0, 8).toUpperCase() : entry.target_id}</code></td>
        <td data-label="Rincian">{entry.detail ? <>
          <button className="ops-link-button" onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id}>{open === entry.id ? "Tutup" : "Lihat"} <ChevronDown size={14}/></button>
          {open === entry.id && <Detail detail={entry.detail}/>}
        </> : <span className="ops-muted">—</span>}</td>
      </tr>)}</tbody>
    </table>
      {!filters ? <p className="empty-state">Memuat log…</p> : !entries.length && <div className="ops-empty"><h2>Belum ada aktivitas yang sesuai</h2><p>Ubah saringan atau rentang tanggal.</p></div>}
      {next && <p className="empty-state"><button className="ops-secondary" disabled={busy} onClick={() => void load(next)}>{busy ? "Memuat…" : "Tampilkan lebih banyak"}</button></p>}
    </div>
  </>;
}
