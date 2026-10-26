"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ErrorBox } from "./operation-ui";
import { staffEventLabels, staffEvents, type StaffEvent } from "./staff-bell";

type RoleRow = { id: string; name: string; slug: string; allowed: StaffEvent[]; events: StaffEvent[]; custom: boolean };
type Data = { roles: RoleRow[]; event_menus: Record<StaffEvent, string[]>; updated_at: string | null };
const menuNames: Record<string, string> = { bookings: "Booking", addons: "Sewa & Tambahan", members: "Member", finance: "Ringkasan Keuangan" };

/**
 * Pengaturan lonceng notifikasi di panel admin: peristiwa apa yang diterima setiap role. Peristiwa yang
 * menunya tidak dimiliki role tidak bisa dicentang, karena tautannya akan membuka halaman yang ditolak.
 */
export function StaffAlertsSettings() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const [draft, setDraft] = useState<Record<string, StaffEvent[]>>({}), [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await api<Data>("/operations/notifications/staff");
      setData(next); setDraft(Object.fromEntries(next.roles.map(role => [role.id, role.events]))); setError("");
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const dirty = useMemo(() => !!data && data.roles.some(role => [...(draft[role.id] ?? [])].sort().join() !== [...role.events].sort().join()), [data, draft]);

  function toggle(role: string, event: StaffEvent, on: boolean) {
    setDraft(current => ({ ...current, [role]: on ? [...(current[role] ?? []), event] : (current[role] ?? []).filter(item => item !== event) }));
  }
  async function save() {
    setSaving(true);
    try {
      const next = await api<Data>("/operations/notifications/staff", { method: "PUT", body: JSON.stringify({ roles: draft }) });
      setData(next); setDraft(Object.fromEntries(next.roles.map(role => [role.id, role.events])));
      toast.success("Pengaturan notifikasi staf disimpan");
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }

  if (error && !data) return <ErrorBox message={error} retry={load} />;
  if (!data) return <p className="empty-state">Memuat pengaturan notifikasi staf…</p>;
  return <div>
    <section className="cms-card wide">
      <header><h2>Lonceng notifikasi di panel admin</h2><p>Staf melihat peristiwa yang dicentang untuk rolenya lewat ikon lonceng di bilah atas, tanpa perlu email atau WhatsApp. Staf yang melakukan aksinya sendiri tidak menerima notifikasinya. Peristiwa yang abu-abu butuh akses menu yang belum dimiliki role itu; tambahkan di Role &amp; Akses.</p></header>
      <div className="manage-table-card ops-table staff-alert-table"><table>
        <thead><tr><th>Peristiwa</th>{data.roles.map(role => <th key={role.id} className="center">{role.name}</th>)}</tr></thead>
        <tbody>{staffEvents.map(event => <tr key={event}>
          <td><b>{staffEventLabels[event][0]}</b><small className="table-description">{staffEventLabels[event][1]}</small></td>
          {data.roles.map(role => {
            const allowed = role.allowed.includes(event);
            const need = data.event_menus[event].map(id => menuNames[id] ?? id).join(" atau ");
            return <td key={role.id} className="center" data-label={role.name}>
              <label className="staff-alert-check" data-tip={allowed ? undefined : `Butuh akses menu ${need}`}>
                <input type="checkbox" disabled={!allowed} checked={allowed && (draft[role.id] ?? []).includes(event)} onChange={e => toggle(role.id, event, e.target.checked)}
                  aria-label={`${staffEventLabels[event][0]} untuk ${role.name}`} />
                {!allowed && <small>Tanpa akses</small>}
              </label>
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </section>
    <div className={`cms-savebar${dirty ? " dirty" : ""}`}>
      <span>{dirty ? "Ada perubahan yang belum disimpan." : data.updated_at ? `Terakhir disimpan ${new Date(data.updated_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}.` : "Belum pernah diatur: setiap role menerima semua peristiwa yang menunya bisa diakses."}</span>
      <button className="ops-primary" type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Menyimpan…" : "Simpan notifikasi staf"}</button>
    </div>
  </div>;
}
