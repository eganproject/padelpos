"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCw, Save, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { featureInfo, featureKinds, featureName, type FeatureKind, type Venue, type VenueFeature } from "@/lib/venue";
import { ErrorBox, Modal, Submit } from "./operation-ui";

/** Satuan kanvas: 1 unit = 0,1 meter. Nilai ditampilkan dalam meter. */
type Court = {
  id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string; active: number;
  layout_x: number; layout_y: number; layout_w: number; layout_h: number;
};
type LayoutResponse = { venue: Venue; courts: Court[]; features: VenueFeature[] };
type Box = { x: number; y: number; w: number; h: number };
type Selection = { type: "court" | "feature"; id: string };

const toMetre = (units: number) => (units / 10).toFixed(1).replace(/\.0$/, "");
const fromMetre = (metre: number) => Math.round(metre * 10);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const courtBox = (court: Court): Box => ({ x: court.layout_x, y: court.layout_y, w: court.layout_w, h: court.layout_h });

export function VenueLayoutPanel() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [features, setFeatures] = useState<VenueFeature[]>([]);
  const [saved, setSaved] = useState<LayoutResponse | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingCourt, setAddingCourt] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<LayoutResponse>("/operations/layout");
      setVenue(data.venue); setCourts(data.courts); setFeatures(data.features ?? []); setSaved(data); setError("");
    } catch (problem) { setError((problem as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const snapshot = useCallback((v: Venue | null, c: Court[], f: VenueFeature[]) => JSON.stringify({
    v,
    c: c.map(x => [x.id, x.layout_x, x.layout_y, x.layout_w, x.layout_h]),
    f: f.map(x => [x.id, x.kind, x.label, x.x, x.y, x.w, x.h]),
  }), []);
  const dirty = saved !== null && snapshot(venue, courts, features) !== snapshot(saved.venue, saved.courts, saved.features ?? []);

  const clashing = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < courts.length; i++) for (let j = i + 1; j < courts.length; j++)
      if (overlaps(courtBox(courts[i]), courtBox(courts[j]))) { ids.add(courts[i].id); ids.add(courts[j].id); }
    return ids;
  }, [courts]);

  const outside = useMemo(() => {
    if (!venue) return [];
    const names = courts.filter(c => c.layout_x + c.layout_w > venue.width || c.layout_y + c.layout_h > venue.height).map(c => c.name);
    const extras = features.filter(f => f.x + f.w > venue.width || f.y + f.h > venue.height).map(featureName);
    return [...names, ...extras];
  }, [courts, features, venue]);

  const moveCourt = useCallback((id: string, patch: Partial<Court>) =>
    setCourts(previous => previous.map(court => court.id === id ? { ...court, ...patch } : court)), []);
  const moveFeature = useCallback((id: string, patch: Partial<VenueFeature>) =>
    setFeatures(previous => previous.map(feature => feature.id === id ? { ...feature, ...patch } : feature)), []);

  /** Satu perilaku seret untuk lapangan maupun elemen informasi. */
  function startDrag(event: React.PointerEvent, target: Selection, box: Box) {
    if (!venue || !canvas.current) return;
    event.preventDefault();
    setSelected(target);
    const rect = canvas.current.getBoundingClientRect();
    const perPixelX = venue.width / rect.width, perPixelY = venue.height / rect.height;
    const fromX = event.clientX, fromY = event.clientY;
    const snap = (value: number) => Math.round(value / venue.grid) * venue.grid;
    const onMove = (moveEvent: PointerEvent) => {
      const x = clamp(snap(box.x + (moveEvent.clientX - fromX) * perPixelX), 0, venue.width - box.w);
      const y = clamp(snap(box.y + (moveEvent.clientY - fromY) * perPixelY), 0, venue.height - box.h);
      if (target.type === "court") moveCourt(target.id, { layout_x: x, layout_y: y });
      else moveFeature(target.id, { x, y });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function nudge(event: React.KeyboardEvent, target: Selection, box: Box) {
    if (!venue) return;
    const step = event.shiftKey ? venue.grid * 5 : venue.grid;
    const shift: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = shift[event.key];
    if (!delta) return;
    event.preventDefault();
    const x = clamp(box.x + delta[0], 0, venue.width - box.w);
    const y = clamp(box.y + delta[1], 0, venue.height - box.h);
    if (target.type === "court") moveCourt(target.id, { layout_x: x, layout_y: y });
    else moveFeature(target.id, { x, y });
  }

  function addFeature(kind: FeatureKind) {
    if (!venue) return;
    const [w, h] = featureInfo[kind].size;
    const width = Math.min(w, venue.width), height = Math.min(h, venue.height);
    const feature: VenueFeature = {
      id: crypto.randomUUID(), kind, label: "",
      x: clamp(Math.round((venue.width - width) / 2 / venue.grid) * venue.grid, 0, venue.width - width),
      y: clamp(venue.height - height - venue.grid * 2, 0, venue.height - height),
      w: width, h: height,
    };
    setFeatures(previous => [...previous, feature]);
    setSelected({ type: "feature", id: feature.id });
  }

  async function save() {
    if (!venue) return;
    setSaving(true);
    try {
      const result = await api<LayoutResponse>("/operations/layout", {
        method: "PUT",
        body: JSON.stringify({
          venue,
          courts: courts.map(c => ({ id: c.id, x: c.layout_x, y: c.layout_y, w: c.layout_w, h: c.layout_h })),
          features: features.map(f => ({ id: f.id, kind: f.kind, label: f.label, x: f.x, y: f.y, w: f.w, h: f.h })),
        }),
      });
      setVenue(result.venue); setCourts(result.courts); setFeatures(result.features ?? []); setSaved(result); setError("");
      toast.success("Denah venue disimpan");
    } catch (problem) { setError((problem as Error).message); }
    finally { setSaving(false); }
  }

  async function removeCourt(court: Court) {
    if (!confirm(`Hapus ${court.name}? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await api(`/operations/courts/${court.id}`, { method: "DELETE" });
      toast.success(`${court.name} dihapus`);
      setSelected(null); await load();
    } catch (problem) { toast.error((problem as Error).message); }
  }

  const court = selected?.type === "court" ? courts.find(item => item.id === selected.id) ?? null : null;
  const feature = selected?.type === "feature" ? features.find(item => item.id === selected.id) ?? null : null;

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
          <button className="ops-secondary" onClick={() => setAddingCourt(true)}><Plus size={15} /> Tambah lapangan</button>
          <button className="ops-secondary" disabled={!dirty || saving}
            onClick={() => { if (saved) { setVenue(saved.venue); setCourts(saved.courts); setFeatures(saved.features ?? []); setSelected(null); } }}>
            <Undo2 size={15} /> Batalkan
          </button>
          <button className="ops-primary" disabled={!dirty || saving} onClick={() => void save()}><Save size={15} /> {saving ? "Menyimpan…" : "Simpan denah"}</button>
        </div>
      </div>

      {outside.length > 0 && <ErrorBox message={`Di luar area venue: ${outside.join(", ")}. Perbesar venue atau geser kembali ke dalam.`} />}
      {clashing.size > 0 && <ErrorBox message="Ada lapangan yang saling menimpa. Geser sebelum menyimpan." />}

      <div className="venue-editor">
        <div className="venue-stage">
          <div
            ref={canvas}
            className="venue-canvas"
            style={{ aspectRatio: `${venue.width} / ${venue.height}`, backgroundSize: `${(venue.grid / venue.width) * 100}% ${(venue.grid / venue.height) * 100}%` }}
            onPointerDown={event => { if (event.target === canvas.current) setSelected(null); }}
          >
            {features.map(item => (
              <button
                key={item.id}
                type="button"
                className={`venue-feature kind-${item.kind}${selected?.type === "feature" && selected.id === item.id ? " selected" : ""}`}
                style={{
                  left: `${(item.x / venue.width) * 100}%`, top: `${(item.y / venue.height) * 100}%`,
                  width: `${(item.w / venue.width) * 100}%`, height: `${(item.h / venue.height) * 100}%`,
                }}
                onPointerDown={event => startDrag(event, { type: "feature", id: item.id }, item)}
                onKeyDown={event => nudge(event, { type: "feature", id: item.id }, item)}
                aria-label={`${featureName(item)}, elemen informasi. Gunakan tombol panah untuk menggeser.`}
              >
                <span>{featureName(item)}</span>
              </button>
            ))}
            {courts.map(item => (
              <button
                key={item.id}
                type="button"
                className={`venue-court${selected?.type === "court" && selected.id === item.id ? " selected" : ""}${item.active ? "" : " inactive"}${clashing.has(item.id) ? " clash" : ""}`}
                style={{
                  left: `${(item.layout_x / venue.width) * 100}%`, top: `${(item.layout_y / venue.height) * 100}%`,
                  width: `${(item.layout_w / venue.width) * 100}%`, height: `${(item.layout_h / venue.height) * 100}%`,
                }}
                onPointerDown={event => startDrag(event, { type: "court", id: item.id }, courtBox(item))}
                onKeyDown={event => nudge(event, { type: "court", id: item.id }, courtBox(item))}
                aria-label={`${item.name}, lapangan. Gunakan tombol panah untuk menggeser.`}
              >
                <span className="net" aria-hidden="true" />
                <b>{item.name}</b>
                <small>{toMetre(item.layout_w)} × {toMetre(item.layout_h)} m</small>
              </button>
            ))}
          </div>
        </div>

        <aside className="venue-side">
          <div className="settings-card">
            <h3>Lapangan</h3>
            <p className="hint">Seret kotak untuk memindahkan, atau pilih lalu gunakan tombol panah. Tahan Shift untuk langkah besar.</p>
            <div className="venue-list">
              {courts.map(item => (
                <button key={item.id} type="button" className={selected?.type === "court" && selected.id === item.id ? "on" : ""}
                  onClick={() => setSelected({ type: "court", id: item.id })}>
                  <i className={item.active ? "" : "off"} />
                  {item.name}
                  <span>{money(item.hourly_rate)}</span>
                </button>
              ))}
              {!courts.length && <p className="hint">Belum ada lapangan. Tambahkan lapangan pertama.</p>}
            </div>
          </div>

          <div className="settings-card">
            <h3>Elemen informasi</h3>
            <p className="hint">Penanda seperti jalan, kantin, atau tempat duduk. Tampil di denah pelanggan sebagai keterangan saja — tidak dapat dipesan.</p>
            <div className="venue-kinds">
              {featureKinds.map(kind => (
                <button key={kind} type="button" onClick={() => addFeature(kind)}>+ {featureInfo[kind].label}</button>
              ))}
            </div>
            {features.length > 0 && (
              <div className="venue-list" style={{ marginTop: 12 }}>
                {features.map(item => (
                  <button key={item.id} type="button" className={selected?.type === "feature" && selected.id === item.id ? "on" : ""}
                    onClick={() => setSelected({ type: "feature", id: item.id })}>
                    <i className={`dot kind-${item.kind}`} />
                    {featureName(item)}
                    <span>{toMetre(item.w)} × {toMetre(item.h)} m</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {court && (
            <div className="settings-card">
              <h3>{court.name}</h3>
              <p className="hint">Buka {court.opens_at}–{court.closes_at} · {court.active ? "aktif" : "nonaktif"}. Nama, tarif, dan jam diubah di menu Courts.</p>
              <BoxFields
                box={courtBox(court)} venue={venue} minSide={20}
                onChange={patch => moveCourt(court.id, { layout_x: patch.x, layout_y: patch.y, layout_w: patch.w, layout_h: patch.h })}
              />
              <div className="row-buttons">
                <button type="button" onClick={() => moveCourt(court.id, { layout_w: court.layout_h, layout_h: court.layout_w })}><RotateCw size={14} /> Putar</button>
                <button type="button" className="danger" onClick={() => void removeCourt(court)}><Trash2 size={14} /> Hapus</button>
              </div>
            </div>
          )}

          {feature && (
            <div className="settings-card">
              <h3>{featureName(feature)}</h3>
              <p className="hint">Elemen informasi. Boleh diletakkan bertumpuk dengan elemen lain, asalkan tetap di dalam area venue.</p>
              <label>Jenis
                <select value={feature.kind} onChange={event => moveFeature(feature.id, { kind: event.target.value as FeatureKind })}>
                  {featureKinds.map(kind => <option key={kind} value={kind}>{featureInfo[kind].label}</option>)}
                </select>
              </label>
              <label style={{ marginTop: 9 }}>Nama tampil (opsional)
                <input maxLength={40} placeholder={featureInfo[feature.kind].label} value={feature.label}
                  onChange={event => moveFeature(feature.id, { label: event.target.value })} />
              </label>
              <div style={{ marginTop: 9 }}>
                <BoxFields box={feature} venue={venue} minSide={10} onChange={patch => moveFeature(feature.id, patch)} />
              </div>
              <div className="row-buttons">
                <button type="button" onClick={() => moveFeature(feature.id, { w: feature.h, h: feature.w })}><RotateCw size={14} /> Putar</button>
                <button type="button" className="danger" onClick={() => { setFeatures(previous => previous.filter(item => item.id !== feature.id)); setSelected(null); }}>
                  <Trash2 size={14} /> Hapus
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {addingCourt && <NewCourtForm venue={venue} taken={courts} features={features} close={() => setAddingCourt(false)} done={() => { setAddingCourt(false); void load(); }} />}
    </>
  );
}

function BoxFields({ box, venue, minSide, onChange }: { box: Box; venue: Venue; minSide: number; onChange: (patch: Box) => void }) {
  const set = (patch: Partial<Box>) => {
    const next = { ...box, ...patch };
    next.w = clamp(next.w, minSide, venue.width);
    next.h = clamp(next.h, minSide, venue.height);
    next.x = clamp(next.x, 0, venue.width - next.w);
    next.y = clamp(next.y, 0, venue.height - next.h);
    onChange(next);
  };
  return (
    <div className="venue-grid2">
      <label>Posisi X (m)<input type="number" step={0.5} min={0} value={toMetre(box.x)} onChange={event => set({ x: fromMetre(Number(event.target.value)) })} /></label>
      <label>Posisi Y (m)<input type="number" step={0.5} min={0} value={toMetre(box.y)} onChange={event => set({ y: fromMetre(Number(event.target.value)) })} /></label>
      <label>Lebar (m)<input type="number" step={0.5} min={minSide / 10} value={toMetre(box.w)} onChange={event => set({ w: fromMetre(Number(event.target.value)) })} /></label>
      <label>Panjang (m)<input type="number" step={0.5} min={minSide / 10} value={toMetre(box.h)} onChange={event => set({ h: fromMetre(Number(event.target.value)) })} /></label>
    </div>
  );
}

function NewCourtForm({ venue, taken, features, close, done }: { venue: Venue; taken: Court[]; features: VenueFeature[]; close: () => void; done: () => void }) {
  const [form, setForm] = useState({ name: "", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Cari ruang kosong pertama agar lapangan baru tidak lahir menimpa lapangan lain. */
  function freeSpot(): Box | null {
    const w = 100, h = 200;
    for (let y = 0; y + h <= venue.height; y += venue.grid * 2)
      for (let x = 0; x + w <= venue.width; x += venue.grid * 2)
        if (!taken.some(c => overlaps({ x, y, w, h }, courtBox(c)))) return { x, y, w, h };
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
          features: features.map(f => ({ id: f.id, kind: f.kind, label: f.label, x: f.x, y: f.y, w: f.w, h: f.h })),
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
            <label>Jam buka<input type="time" step={1800} required value={form.opens_at} onChange={event => setForm({ ...form, opens_at: event.target.value })} /></label>
            <label>Jam tutup<input type="time" step={1800} required value={form.closes_at} onChange={event => setForm({ ...form, closes_at: event.target.value })} /></label>
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
