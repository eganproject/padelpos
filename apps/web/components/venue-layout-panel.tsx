"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { ErrorBox, Modal, Submit } from "./operation-ui";

/** Satuan kanvas: 1 unit = 0,1 meter. Nilai ditampilkan dalam meter. */
type Venue = { width: number; height: number; grid: number };
type Court = {
  id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string; active: number;
  layout_x: number; layout_y: number; layout_w: number; layout_h: number;
};
type LayoutResponse = { venue: Venue; courts: Court[] };

const toMetre = (units: number) => (units / 10).toFixed(1).replace(/\.0$/, "");
const fromMetre = (metre: number) => Math.round(metre * 10);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const overlaps = (a: Court, b: Court) =>
  a.layout_x < b.layout_x + b.layout_w && a.layout_x + a.layout_w > b.layout_x &&
  a.layout_y < b.layout_y + b.layout_h && a.layout_y + a.layout_h > b.layout_y;

export function VenueLayoutPanel() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [saved, setSaved] = useState<LayoutResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<LayoutResponse>("/operations/layout");
      setVenue(data.venue); setCourts(data.courts); setSaved(data); setError("");
    } catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => saved !== null && venue !== null &&
    JSON.stringify({ venue, courts: courts.map(c => [c.id, c.layout_x, c.layout_y, c.layout_w, c.layout_h]) }) !==
    JSON.stringify({ venue: saved.venue, courts: saved.courts.map(c => [c.id, c.layout_x, c.layout_y, c.layout_w, c.layout_h]) }),
    [venue, courts, saved]);

  const clashing = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < courts.length; i++) for (let j = i + 1; j < courts.length; j++)
      if (overlaps(courts[i], courts[j])) { ids.add(courts[i].id); ids.add(courts[j].id); }
    return ids;
  }, [courts]);

  const outside = useMemo(() => venue
    ? courts.filter(c => c.layout_x + c.layout_w > venue.width || c.layout_y + c.layout_h > venue.height).map(c => c.name)
    : [], [courts, venue]);

  const move = useCallback((id: string, patch: Partial<Court>) =>
    setCourts(previous => previous.map(court => court.id === id ? { ...court, ...patch } : court)), []);

  function startDrag(event: React.PointerEvent, court: Court) {
    if (!venue || !canvas.current) return;
    event.preventDefault();
    setSelected(court.id);
    const box = canvas.current.getBoundingClientRect();
    const perPixelX = venue.width / box.width, perPixelY = venue.height / box.height;
    const fromX = event.clientX, fromY = event.clientY;
    const originX = court.layout_x, originY = court.layout_y;
    const snap = (value: number) => Math.round(value / venue.grid) * venue.grid;
    const onMove = (moveEvent: PointerEvent) => {
      move(court.id, {
        layout_x: clamp(snap(originX + (moveEvent.clientX - fromX) * perPixelX), 0, venue.width - court.layout_w),
        layout_y: clamp(snap(originY + (moveEvent.clientY - fromY) * perPixelY), 0, venue.height - court.layout_h),
      });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function nudge(event: React.KeyboardEvent, court: Court) {
    if (!venue) return;
    const step = event.shiftKey ? venue.grid * 5 : venue.grid;
    const shift: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = shift[event.key];
    if (!delta) return;
    event.preventDefault();
    move(court.id, {
      layout_x: clamp(court.layout_x + delta[0], 0, venue.width - court.layout_w),
      layout_y: clamp(court.layout_y + delta[1], 0, venue.height - court.layout_h),
    });
  }

  async function save() {
    if (!venue) return;
    setSaving(true);
    try {
      const result = await api<LayoutResponse>("/operations/layout", {
        method: "PUT",
        body: JSON.stringify({ venue, courts: courts.map(c => ({ id: c.id, x: c.layout_x, y: c.layout_y, w: c.layout_w, h: c.layout_h })) }),
      });
      setVenue(result.venue); setCourts(result.courts); setSaved(result); setError("");
      toast.success("Denah venue disimpan");
    } catch (problem) { setError((problem as Error).message); }
    finally { setSaving(false); }
  }

  async function remove(court: Court) {
    if (!confirm(`Hapus ${court.name}? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await api(`/operations/courts/${court.id}`, { method: "DELETE" });
      toast.success(`${court.name} dihapus`);
      setSelected(null); await load();
    } catch (problem) { toast.error((problem as Error).message); }
  }

  const current = courts.find(court => court.id === selected) ?? null;

  if (error && !venue) return <ErrorBox message={error} retry={load} />;
  if (!venue) return <p className="empty-state">Memuat denah venue…</p>;

  return (
    <>
      {error && <ErrorBox message={error} />}
      <div className="venue-toolbar">
        <div className="venue-num">
          <label htmlFor="venue-w">Lebar venue (m)</label>
          <input id="venue-w" type="number" min={20} max={500} step={1} value={toMetre(venue.width)}
            onChange={event => setVenue({ ...venue, width: clamp(fromMetre(Number(event.target.value)), 200, 5000) })} />
        </div>
        <div className="venue-num">
          <label htmlFor="venue-h">Panjang venue (m)</label>
          <input id="venue-h" type="number" min={20} max={500} step={1} value={toMetre(venue.height)}
            onChange={event => setVenue({ ...venue, height: clamp(fromMetre(Number(event.target.value)), 200, 5000) })} />
        </div>
        <div className="venue-num">
          <label htmlFor="venue-grid">Kisi bantu</label>
          <select id="venue-grid" value={venue.grid} onChange={event => setVenue({ ...venue, grid: Number(event.target.value) })}>
            <option value={5}>0,5 m</option>
            <option value={10}>1 m</option>
            <option value={25}>2,5 m</option>
          </select>
        </div>
        <div className="grow">
          {dirty && <span className="venue-dirty">Ada perubahan belum disimpan</span>}
          <button className="ops-secondary" onClick={() => setAdding(true)}><Plus size={15} /> Tambah lapangan</button>
          <button className="ops-secondary" disabled={!dirty || saving} onClick={() => { if (saved) { setVenue(saved.venue); setCourts(saved.courts); } }}><Undo2 size={15} /> Batalkan</button>
          <button className="ops-primary" disabled={!dirty || saving} onClick={() => void save()}><Save size={15} /> {saving ? "Menyimpan…" : "Simpan denah"}</button>
        </div>
      </div>

      {outside.length > 0 && <ErrorBox message={`Di luar area venue: ${outside.join(", ")}. Perbesar venue atau geser lapangan.`} />}
      {clashing.size > 0 && <ErrorBox message="Ada lapangan yang saling menimpa. Geser sebelum menyimpan." />}

      <div className="venue-editor">
        <div className="venue-stage">
          <div
            ref={canvas}
            className="venue-canvas"
            style={{ aspectRatio: `${venue.width} / ${venue.height}`, backgroundSize: `${(venue.grid / venue.width) * 100}% ${(venue.grid / venue.height) * 100}%` }}
            onPointerDown={event => { if (event.target === canvas.current) setSelected(null); }}
          >
            {courts.map(court => (
              <button
                key={court.id}
                type="button"
                className={`venue-court${court.id === selected ? " selected" : ""}${court.active ? "" : " inactive"}${clashing.has(court.id) ? " clash" : ""}`}
                style={{
                  left: `${(court.layout_x / venue.width) * 100}%`,
                  top: `${(court.layout_y / venue.height) * 100}%`,
                  width: `${(court.layout_w / venue.width) * 100}%`,
                  height: `${(court.layout_h / venue.height) * 100}%`,
                }}
                onPointerDown={event => startDrag(event, court)}
                onKeyDown={event => nudge(event, court)}
                aria-label={`${court.name}, posisi ${toMetre(court.layout_x)} kali ${toMetre(court.layout_y)} meter. Gunakan tombol panah untuk menggeser.`}
              >
                <span className="net" />
                <b>{court.name}</b>
                <small>{toMetre(court.layout_w)} × {toMetre(court.layout_h)} m</small>
              </button>
            ))}
          </div>
        </div>

        <aside className="venue-side">
          <div className="settings-card">
            <h3>Lapangan</h3>
            <p className="hint">Seret kotak untuk memindahkan, atau pilih lalu gunakan tombol panah. Tahan Shift untuk langkah besar.</p>
            <div className="venue-list">
              {courts.map(court => (
                <button key={court.id} type="button" className={court.id === selected ? "on" : ""} onClick={() => setSelected(court.id)}>
                  <i className={court.active ? "" : "off"} />
                  {court.name}
                  <span>{money(court.hourly_rate)}</span>
                </button>
              ))}
              {!courts.length && <p className="hint">Belum ada lapangan. Tambahkan lapangan pertama.</p>}
            </div>
          </div>

          {current && (
            <div className="settings-card">
              <h3>{current.name}</h3>
              <p className="hint">Buka {current.opens_at}–{current.closes_at} · {current.active ? "aktif" : "nonaktif"}. Nama, tarif, dan jam diubah di menu Courts.</p>
              <div className="venue-grid2">
                <label>Posisi X (m)
                  <input type="number" step={0.5} min={0} value={toMetre(current.layout_x)}
                    onChange={event => move(current.id, { layout_x: clamp(fromMetre(Number(event.target.value)), 0, venue.width - current.layout_w) })} />
                </label>
                <label>Posisi Y (m)
                  <input type="number" step={0.5} min={0} value={toMetre(current.layout_y)}
                    onChange={event => move(current.id, { layout_y: clamp(fromMetre(Number(event.target.value)), 0, venue.height - current.layout_h) })} />
                </label>
                <label>Lebar (m)
                  <input type="number" step={0.5} min={2} value={toMetre(current.layout_w)}
                    onChange={event => move(current.id, { layout_w: clamp(fromMetre(Number(event.target.value)), 20, 2000) })} />
                </label>
                <label>Panjang (m)
                  <input type="number" step={0.5} min={2} value={toMetre(current.layout_h)}
                    onChange={event => move(current.id, { layout_h: clamp(fromMetre(Number(event.target.value)), 20, 2000) })} />
                </label>
              </div>
              <div className="row-buttons">
                <button type="button" onClick={() => move(current.id, { layout_w: current.layout_h, layout_h: current.layout_w })}>
                  <RotateCw size={14} /> Putar
                </button>
                <button type="button" className="danger" onClick={() => void remove(current)}>
                  <Trash2 size={14} /> Hapus
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {adding && <NewCourtForm venue={venue} taken={courts} close={() => setAdding(false)} done={() => { setAdding(false); void load(); }} />}
    </>
  );
}

function NewCourtForm({ venue, taken, close, done }: { venue: Venue; taken: Court[]; close: () => void; done: () => void }) {
  const [form, setForm] = useState({ name: "", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Cari kolom kosong pertama agar lapangan baru tidak lahir menimpa yang lain. */
  function freeSpot() {
    const w = 100, h = 200;
    for (let y = 0; y + h <= venue.height; y += venue.grid * 2)
      for (let x = 0; x + w <= venue.width; x += venue.grid * 2)
        if (!taken.some(c => x < c.layout_x + c.layout_w && x + w > c.layout_x && y < c.layout_y + c.layout_h && y + h > c.layout_y))
          return { x, y, w, h };
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const spot = freeSpot();
      if (!spot) throw new Error("Tidak ada ruang kosong tersisa. Perbesar venue terlebih dahulu.");
      const { court } = await api<{ court: Court }>("/operations/courts", { method: "POST", body: JSON.stringify(form) });
      await api("/operations/layout", {
        method: "PUT",
        body: JSON.stringify({
          venue,
          courts: [...taken.map(c => ({ id: c.id, x: c.layout_x, y: c.layout_y, w: c.layout_w, h: c.layout_h })), { id: court.id, ...spot }],
        }),
      });
      toast.success("Lapangan ditambahkan ke denah");
      done();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Tambah lapangan" close={close}>
      <form onSubmit={submit}>
        <div className="modal-fields">
          {error && <ErrorBox message={error} />}
          <label>Nama lapangan
            <input autoFocus required minLength={2} maxLength={60} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>Tarif per jam (Rp)
            <input type="number" min={1000} max={10000000} required value={form.hourly_rate} onChange={event => setForm({ ...form, hourly_rate: Number(event.target.value) })} />
          </label>
          <div className="field-grid">
            <label>Jam buka
              <input type="time" step={1800} required value={form.opens_at} onChange={event => setForm({ ...form, opens_at: event.target.value })} />
            </label>
            <label>Jam tutup
              <input type="time" step={1800} required value={form.closes_at} onChange={event => setForm({ ...form, closes_at: event.target.value })} />
            </label>
          </div>
          <p className="ops-muted">Lapangan baru diletakkan otomatis di ruang kosong pertama, ukuran standar 10 × 20 m.</p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={close} disabled={busy}>Batal</button>
          <Submit busy={busy}>Tambah</Submit>
        </div>
      </form>
    </Modal>
  );
}
