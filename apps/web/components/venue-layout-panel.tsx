"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Copy, Layers, Minus, Plus, Redo2, RotateCcw, RotateCw, Save, Shrink, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { api, money } from "@/lib/api";
import { featureInfo, featureKinds, featureName, type FeatureKind, type Floor, type Venue, type VenueFeature } from "@/lib/venue";
import { ErrorBox, Modal, Submit } from "./operation-ui";
import { Select, DateInput, MoneyInput } from "./form-controls";

/** Satuan kanvas: 1 unit = 0,1 meter. Nilai ditampilkan dalam meter. */
type Court = {
  id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string; active: number;
  layout_x: number; layout_y: number; layout_w: number; layout_h: number; floor_id: string | null;
};
type LayoutResponse = { venue: Venue; floors: Floor[]; courts: Court[]; features: VenueFeature[] };
type Box = { x: number; y: number; w: number; h: number };
type Selection = { type: "court" | "feature"; id: string };
/** Keadaan denah yang disimpan, dibatalkan, dan diulang. Setiap lapangan dan elemen punya lantai. */
type Snapshot = { grid: number; floors: Floor[]; courts: Court[]; features: VenueFeature[] };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Gesture = "move" | "resize" | "venue";

const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minSide = { court: 20, feature: 10 };
const minVenue = 200, maxVenue = 5000, maxFloors = 10;
const zoomLevels = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const toMetre = (units: number) => (units / 10).toFixed(1).replace(/\.0$/, "");
const metre = (units: number) => toMetre(units).replace(".", ",");
const fromMetre = (value: number) => Math.round(value * 10);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const courtBox = (court: Court): Box => ({ x: court.layout_x, y: court.layout_y, w: court.layout_w, h: court.layout_h });
const featureBox = (feature: VenueFeature): Box => ({ x: feature.x, y: feature.y, w: feature.w, h: feature.h });
const fingerprint = (state: Snapshot) => JSON.stringify({
  g: state.grid,
  l: state.floors.map(x => [x.id, x.name, x.width, x.height]),
  c: state.courts.map(x => [x.id, x.floor_id, x.layout_x, x.layout_y, x.layout_w, x.layout_h]),
  f: state.features.map(x => [x.id, x.floor_id, x.kind, x.label, x.x, x.y, x.w, x.h]),
});
/** Tepi kanan dan bawah terjauh dari isi lantai; area lantai tidak boleh lebih kecil dari ini. */
const contentBounds = (courts: Court[], features: VenueFeature[]) => ({
  w: Math.max(0, ...courts.map(c => c.layout_x + c.layout_w), ...features.map(f => f.x + f.w)),
  h: Math.max(0, ...courts.map(c => c.layout_y + c.layout_h), ...features.map(f => f.y + f.h)),
});
/** Baris tanpa lantai dianggap berada di lantai pertama. */
const normalize = (data: LayoutResponse): Snapshot => {
  const first = data.floors[0]?.id ?? null;
  return {
    grid: data.venue.grid,
    floors: data.floors.map(({ id, name, width, height }) => ({ id, name, width, height })),
    courts: data.courts.map(court => ({ ...court, floor_id: court.floor_id ?? first })),
    features: (data.features ?? []).map(feature => ({ ...feature, floor_id: feature.floor_id ?? first })),
  };
};
const payload = (state: Snapshot) => ({
  venue: { grid: state.grid },
  floors: state.floors.map(({ id, name, width, height }) => ({ id, name: name.trim(), width, height })),
  courts: state.courts.map(c => ({ id: c.id, floor_id: c.floor_id ?? state.floors[0].id, x: c.layout_x, y: c.layout_y, w: c.layout_w, h: c.layout_h })),
  features: state.features.map(f => ({ id: f.id, kind: f.kind, label: f.label, floor_id: f.floor_id ?? state.floors[0].id, x: f.x, y: f.y, w: f.w, h: f.h })),
});
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

export function VenueLayoutPanel() {
  const [grid, setGrid] = useState(10);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [features, setFeatures] = useState<VenueFeature[]>([]);
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [activeFloor, setActiveFloor] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingCourt, setAddingCourt] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [lockedScale, setLockedScale] = useState<number | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [, setRevision] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const current = useRef<Snapshot | null>(null);
  const lastNudge = useRef(0);
  current.current = saved ? { grid, floors, courts, features } : null;
  const ready = saved !== null;

  const bump = () => setRevision(value => value + 1);
  const clearHistory = () => { history.current = { past: [], future: [] }; bump(); };
  const restore = useCallback((state: Snapshot) => {
    setGrid(state.grid); setFloors(state.floors); setCourts(state.courts); setFeatures(state.features);
  }, []);

  const load = useCallback(async () => {
    try {
      const state = normalize(await api<LayoutResponse>("/operations/layout"));
      restore(state); setSaved(state); setError("");
      setActiveFloor(previous => state.floors.some(floor => floor.id === previous) ? previous : state.floors[0]?.id ?? "");
      history.current = { past: [], future: [] }; setRevision(value => value + 1);
    } catch (problem) { setError((problem as Error).message); }
  }, [restore]);
  useEffect(() => { void load(); }, [load]);

  const dirty = saved !== null && fingerprint({ grid, floors, courts, features }) !== fingerprint(saved);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // --- Riwayat untuk batalkan dan ulangi ------------------------------------
  /** Catat keadaan sebelum perubahan. Mengembalikan true bila benar-benar menambah catatan. */
  const remember = useCallback(() => {
    const now = current.current;
    if (!now) return false;
    const { past } = history.current;
    if (past.length && fingerprint(past[past.length - 1]) === fingerprint(now)) return false;
    past.push(now);
    if (past.length > 100) past.shift();
    history.current.future = [];
    setRevision(value => value + 1);
    return true;
  }, []);
  const undo = useCallback(() => {
    const now = current.current, previous = history.current.past.pop();
    if (!now || !previous) return;
    history.current.future.push(now); restore(previous); setRevision(value => value + 1);
  }, [restore]);
  const redo = useCallback(() => {
    const now = current.current, next = history.current.future.pop();
    if (!now || !next) return;
    history.current.past.push(now); restore(next); setRevision(value => value + 1);
  }, [restore]);

  // --- Ukuran tampilan ----------------------------------------------------
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(value => clamp(Math.round(value * (event.deltaY < 0 ? 1.1 : 1 / 1.1) * 100) / 100, zoomLevels[0], zoomLevels[zoomLevels.length - 1]));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [ready]);

  // --- Lantai aktif dan isinya ---------------------------------------------
  const floor = floors.find(item => item.id === activeFloor) ?? floors[0] ?? null;
  const floorCourts = useMemo(() => (floor ? courts.filter(c => c.floor_id === floor.id) : []), [courts, floor]);
  const floorFeatures = useMemo(() => (floor ? features.filter(f => f.floor_id === floor.id) : []), [features, floor]);
  const court = selected?.type === "court" ? floorCourts.find(item => item.id === selected.id) ?? null : null;
  const feature = selected?.type === "feature" ? floorFeatures.find(item => item.id === selected.id) ?? null : null;
  const selectedBox = court ? courtBox(court) : feature ? featureBox(feature) : null;
  const selectedName = court ? court.name : feature ? featureName(feature) : "";
  const bounds = useMemo(() => contentBounds(floorCourts, floorFeatures), [floorCourts, floorFeatures]);

  /** Lapangan yang saling menimpa dan isi yang keluar area, dihitung per lantai. */
  const problems = useMemo(() => {
    const clash = new Set<string>(), outside: { name: string; floor: string }[] = [];
    for (let i = 0; i < courts.length; i++) for (let j = i + 1; j < courts.length; j++)
      if (courts[i].floor_id === courts[j].floor_id && overlaps(courtBox(courts[i]), courtBox(courts[j]))) { clash.add(courts[i].id); clash.add(courts[j].id); }
    const size = new Map(floors.map(item => [item.id, item]));
    for (const item of courts) {
      const area = size.get(item.floor_id ?? "");
      if (area && (item.layout_x + item.layout_w > area.width || item.layout_y + item.layout_h > area.height)) outside.push({ name: item.name, floor: area.id });
    }
    for (const item of features) {
      const area = size.get(item.floor_id ?? "");
      if (area && (item.x + item.w > area.width || item.y + item.h > area.height)) outside.push({ name: featureName(item), floor: area.id });
    }
    const floorsWithIssue = new Set([...courts.filter(item => clash.has(item.id)).map(item => item.floor_id ?? ""), ...outside.map(item => item.floor)]);
    return { clash, outside, floorsWithIssue };
  }, [courts, features, floors]);

  const setBox = useCallback((target: Selection, box: Box) => {
    if (target.type === "court") setCourts(list => list.map(c => c.id === target.id ? { ...c, layout_x: box.x, layout_y: box.y, layout_w: box.w, layout_h: box.h } : c));
    else setFeatures(list => list.map(f => f.id === target.id ? { ...f, ...box } : f));
  }, []);

  // Hook harus dipanggil sebelum return lebih awal di bawah; isinya diganti setiap render.
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});

  if (error && !saved) return <ErrorBox message={error} retry={load} />;
  if (!saved) return <p className="empty-state">Memuat denah venue…</p>;
  if (!floor) return <ErrorBox message="Data lantai belum tersedia. Jalankan ulang API agar migrasi database berjalan." retry={load} />;

  // Seluruh lantai muat di layar pada zoom 100%. Selama area ditarik, skala dikunci
  // agar tepi yang ditarik tetap berada di bawah kursor.
  const area = floor;
  const multiFloor = floors.length > 1;
  const fit = stageSize.width > 0 && stageSize.height > 0 ? Math.min(stageSize.width / area.width, stageSize.height / area.height) : 0.5;
  const scale = lockedScale ?? fit * zoom;
  const gridPx = grid * scale;
  const gridShown = gridPx < 8 ? gridPx * Math.ceil(8 / gridPx) : gridPx;
  const snapTo = (value: number) => Math.round(value / grid) * grid;
  const place = (box: Box) => ({
    left: `${(box.x / area.width) * 100}%`, top: `${(box.y / area.height) * 100}%`,
    width: `${(box.w / area.width) * 100}%`, height: `${(box.h / area.height) * 100}%`,
  });
  const unitsPerPixel = () => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: area.width / rect.width, y: area.height / rect.height };
  };
  const floorClash = floorCourts.some(item => problems.clash.has(item.id));
  const floorOutside = problems.outside.filter(item => item.floor === area.id);
  const itemCount = (floorId: string) => courts.filter(c => c.floor_id === floorId).length + features.filter(f => f.floor_id === floorId).length;
  const floorIndex = floors.findIndex(item => item.id === area.id);

  /** Satu mekanisme seret untuk memindah, mengubah ukuran, dan mengubah area lantai. */
  function track(event: React.PointerEvent, mode: Gesture, onMove: (dx: number, dy: number, pointer: PointerEvent) => void) {
    event.preventDefault();
    event.stopPropagation();
    const pushed = remember(), startX = event.clientX, startY = event.clientY;
    let moved = false;
    setGesture(mode);
    const move = (pointer: PointerEvent) => {
      const dx = pointer.clientX - startX, dy = pointer.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      onMove(dx, dy, pointer);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGesture(null); setLockedScale(null);
      // Klik tanpa geser tidak perlu masuk riwayat.
      if (!moved && pushed) { history.current.past.pop(); bump(); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startDrag(event: React.PointerEvent, target: Selection, box: Box) {
    if (event.button !== 0) return;
    setSelected(target);
    const per = unitsPerPixel();
    track(event, "move", (dx, dy) => setBox(target, {
      ...box,
      x: clamp(snapTo(box.x + dx * per.x), 0, area.width - box.w),
      y: clamp(snapTo(box.y + dy * per.y), 0, area.height - box.h),
    }));
  }

  function startResize(event: React.PointerEvent, handle: Handle) {
    if (!selected || !selectedBox) return;
    const target = selected, box = selectedBox, per = unitsPerPixel(), min = minSide[target.type];
    track(event, "resize", (dx, dy, pointer) => {
      let { x, y, w, h } = box;
      const ux = dx * per.x, uy = dy * per.y;
      // Yang dijepret ke kisi adalah posisi tepinya, sehingga sisi yang tidak ditarik tetap diam.
      if (handle.includes("e")) w = clamp(snapTo(box.x + box.w + ux) - box.x, min, area.width - box.x);
      if (handle.includes("s")) h = clamp(snapTo(box.y + box.h + uy) - box.y, min, area.height - box.y);
      if (handle.includes("w")) { const right = box.x + box.w; x = clamp(snapTo(box.x + ux), 0, right - min); w = right - x; }
      if (handle.includes("n")) { const bottom = box.y + box.h; y = clamp(snapTo(box.y + uy), 0, bottom - min); h = bottom - y; }
      if (pointer.shiftKey && handle.length === 2) {
        const limit = handle.includes("n") ? box.y + box.h : area.height - box.y;
        h = clamp(Math.round((w * box.h) / box.w), min, limit);
        if (handle.includes("n")) y = box.y + box.h - h;
      }
      setBox(target, { x, y, w, h });
    });
  }

  const resizeFloor = (floorId: string, size: { width: number; height: number }) =>
    setFloors(list => list.map(item => item.id === floorId ? { ...item, ...size } : item));

  function startAreaResize(event: React.PointerEvent, edge: "e" | "s" | "se") {
    const start = area, frozen = scale, content = bounds;
    setLockedScale(frozen);
    track(event, "venue", (dx, dy) => resizeFloor(start.id, {
      width: edge === "s" ? start.width : clamp(snapTo(start.width + dx / frozen), Math.max(minVenue, content.w), maxVenue),
      height: edge === "e" ? start.height : clamp(snapTo(start.height + dy / frozen), Math.max(minVenue, content.h), maxVenue),
    }));
  }

  function resizeAreaByKey(event: React.KeyboardEvent, edge: "e" | "s" | "se") {
    const step = grid * (event.shiftKey ? 5 : 1);
    const dx = edge !== "s" ? ({ ArrowRight: step, ArrowLeft: -step } as Record<string, number>)[event.key] ?? 0 : 0;
    const dy = edge !== "e" ? ({ ArrowDown: step, ArrowUp: -step } as Record<string, number>)[event.key] ?? 0 : 0;
    if (!dx && !dy) return;
    event.preventDefault(); event.stopPropagation();
    remember();
    resizeFloor(area.id, {
      width: clamp(area.width + dx, Math.max(minVenue, bounds.w), maxVenue),
      height: clamp(area.height + dy, Math.max(minVenue, bounds.h), maxVenue),
    });
  }

  function setAreaSide(key: "width" | "height", units: number) {
    resizeFloor(area.id, { width: area.width, height: area.height, [key]: clamp(units, Math.max(minVenue, key === "width" ? bounds.w : bounds.h), maxVenue) });
  }

  /** Ubah ukuran atau posisi kotak terpilih dari panel, tetap di dalam area lantai. */
  function updateSelected(patch: Partial<Box>) {
    if (!selected || !selectedBox) return;
    const min = minSide[selected.type], next = { ...selectedBox, ...patch };
    next.w = clamp(next.w, min, area.width);
    next.h = clamp(next.h, min, area.height);
    next.x = clamp(next.x, 0, area.width - next.w);
    next.y = clamp(next.y, 0, area.height - next.h);
    setBox(selected, next);
  }

  function rotate() {
    if (!selected || !selectedBox) return;
    const box = selectedBox;
    if (box.h > area.width || box.w > area.height) { toast.error("Tidak cukup ruang untuk memutar. Perbesar area lantai terlebih dahulu."); return; }
    remember();
    // Putar di sekitar titik tengah agar kotak tidak melompat jauh.
    const centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
    setBox(selected, {
      x: clamp(snapTo(centerX - box.h / 2), 0, area.width - box.h),
      y: clamp(snapTo(centerY - box.w / 2), 0, area.height - box.w),
      w: box.h, h: box.w,
    });
  }

  function addFeature(kind: FeatureKind) {
    const [w, h] = featureInfo[kind].size;
    const width = Math.min(w, area.width), height = Math.min(h, area.height);
    const item: VenueFeature = {
      id: crypto.randomUUID(), kind, label: "", floor_id: area.id,
      x: clamp(snapTo((area.width - width) / 2), 0, area.width - width),
      y: clamp(area.height - height - grid * 2, 0, area.height - height),
      w: width, h: height,
    };
    remember();
    setFeatures(list => [...list, item]);
    setSelected({ type: "feature", id: item.id });
  }

  function duplicate() {
    if (!feature) return;
    const offset = grid * 2;
    const copy: VenueFeature = { ...feature, id: crypto.randomUUID(), x: clamp(feature.x + offset, 0, area.width - feature.w), y: clamp(feature.y + offset, 0, area.height - feature.h) };
    remember();
    setFeatures(list => [...list, copy]);
    setSelected({ type: "feature", id: copy.id });
  }

  function removeSelected() {
    if (court) { void removeCourt(court); return; }
    if (!feature) return;
    remember();
    setFeatures(list => list.filter(item => item.id !== feature.id));
    setSelected(null);
  }

  async function removeCourt(target: Court) {
    if (!confirm(`Hapus ${target.name}? Lapangan langsung dihapus dari sistem dan tidak dapat dibatalkan.`)) return;
    try {
      await api(`/operations/courts/${target.id}`, { method: "DELETE" });
      // Perubahan denah lain yang belum disimpan tetap dipertahankan.
      setCourts(list => list.filter(item => item.id !== target.id));
      setSaved(previous => previous && { ...previous, courts: previous.courts.filter(item => item.id !== target.id) });
      setSelected(null);
      clearHistory();
      toast.success(`${target.name} dihapus`);
    } catch (problem) { toast.error((problem as Error).message); }
  }

  /** Pindahkan kotak terpilih ke lantai lain; ukurannya disesuaikan bila lantai tujuan lebih kecil. */
  function moveToFloor(floorId: string) {
    const destination = floors.find(item => item.id === floorId);
    if (!destination || !selected || !selectedBox || destination.id === area.id) return;
    remember();
    const w = Math.min(selectedBox.w, destination.width), h = Math.min(selectedBox.h, destination.height);
    const box = { w, h, x: clamp(selectedBox.x, 0, destination.width - w), y: clamp(selectedBox.y, 0, destination.height - h) };
    if (selected.type === "court") setCourts(list => list.map(c => c.id === selected.id ? { ...c, floor_id: floorId, layout_x: box.x, layout_y: box.y, layout_w: box.w, layout_h: box.h } : c));
    else setFeatures(list => list.map(f => f.id === selected.id ? { ...f, ...box, floor_id: floorId } : f));
    setActiveFloor(floorId);
    toast.success(`${selectedName} dipindahkan ke ${destination.name}`);
  }

  function switchFloor(floorId: string) {
    setActiveFloor(floorId);
    setSelected(null);
    setZoom(1);
  }

  function addFloor() {
    if (floors.length >= maxFloors) return;
    let number = floors.length + 1;
    while (floors.some(item => item.name.toLowerCase() === `lantai ${number}`)) number++;
    // Lantai baru mengikuti ukuran lantai yang sedang dibuka, seperti gedung pada umumnya.
    const created: Floor = { id: crypto.randomUUID(), name: `Lantai ${number}`, width: area.width, height: area.height };
    remember();
    setFloors(list => [...list, created]);
    switchFloor(created.id);
  }

  function removeFloor() {
    if (floors.length <= 1 || itemCount(area.id) > 0) return;
    remember();
    const next = floors[floorIndex - 1] ?? floors[floorIndex + 1];
    setFloors(list => list.filter(item => item.id !== area.id));
    switchFloor(next.id);
  }

  function moveFloor(delta: number) {
    const target = floorIndex + delta;
    if (target < 0 || target >= floors.length) return;
    remember();
    setFloors(list => {
      const next = [...list];
      const [item] = next.splice(floorIndex, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  /** Geser isi lantai ke pojok kiri atas dengan jarak tepi dua kisi, lalu rapatkan area lantai. */
  function fitToContent() {
    const boxes = [...floorCourts.map(courtBox), ...floorFeatures.map(featureBox)];
    if (!boxes.length) return;
    const margin = grid * 2;
    const dx = margin - Math.min(...boxes.map(b => b.x)), dy = margin - Math.min(...boxes.map(b => b.y));
    const ceil = (value: number) => Math.ceil(value / grid) * grid;
    remember();
    setCourts(list => list.map(c => c.floor_id === area.id ? { ...c, layout_x: c.layout_x + dx, layout_y: c.layout_y + dy } : c));
    setFeatures(list => list.map(f => f.floor_id === area.id ? { ...f, x: f.x + dx, y: f.y + dy } : f));
    resizeFloor(area.id, {
      width: clamp(ceil(Math.max(...boxes.map(b => b.x + b.w)) + dx + margin), minVenue, maxVenue),
      height: clamp(ceil(Math.max(...boxes.map(b => b.y + b.h)) + dy + margin), minVenue, maxVenue),
    });
    setZoom(1);
  }

  async function save() {
    setSaving(true);
    try {
      const result = normalize(await api<LayoutResponse>("/operations/layout", { method: "PUT", body: JSON.stringify(payload({ grid, floors, courts, features })) }));
      restore(result); setSaved(result); setError("");
      toast.success("Denah venue disimpan");
    } catch (problem) { setError((problem as Error).message); }
    finally { setSaving(false); }
  }

  function select(target: Selection) {
    setSelected(target);
    // Gulir hanya di dalam area denah; scrollIntoView ikut menggulir seluruh halaman.
    const node = document.getElementById(`venue-item-${target.id}`), box = stage.current;
    if (node && box) {
      const item = node.getBoundingClientRect(), view = box.getBoundingClientRect();
      if (item.left < view.left || item.right > view.right || item.top < view.top || item.bottom > view.bottom)
        box.scrollBy({ left: item.left + item.width / 2 - (view.left + view.width / 2), top: item.top + item.height / 2 - (view.top + view.height / 2), behavior: "smooth" });
    }
    // Panel pengaturan ada di paling atas panel samping.
    if (window.matchMedia("(max-width: 1000px)").matches) box?.scrollIntoView({ block: "center", behavior: "smooth" });
    else side.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  keyHandler.current = (event: KeyboardEvent) => {
    if (isTyping(event.target) || addingCourt) return;
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { event.preventDefault(); redo(); return; }
    if (!selected || !selectedBox) return;
    if (key === "escape") { setSelected(null); return; }
    if (key === "delete" || key === "backspace") { event.preventDefault(); removeSelected(); return; }
    if (key === "r" && !mod) { event.preventDefault(); rotate(); return; }
    if (mod && key === "d") { event.preventDefault(); duplicate(); return; }
    const step = event.shiftKey ? grid * 5 : grid;
    const delta = ({ arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] } as Record<string, [number, number]>)[key];
    if (!delta) return;
    event.preventDefault();
    // Tekan panah beruntun dihitung satu langkah riwayat.
    if (Date.now() - lastNudge.current > 800) remember();
    lastNudge.current = Date.now();
    if (event.altKey) updateSelected({ w: selectedBox.w + delta[0], h: selectedBox.h + delta[1] });
    else updateSelected({ x: selectedBox.x + delta[0], y: selectedBox.y + delta[1] });
  };

  return (
    <>
      <KeyboardShortcuts handler={keyHandler} />
      {error && <ErrorBox message={error} />}

      <div className="venue-toolbar">
        <div className="venue-area">
          <MetreField label={multiFloor ? "Lebar lantai" : "Lebar venue"} value={area.width} min={Math.max(minVenue, bounds.w)} max={maxVenue} step={grid * 5} onStart={remember} onChange={units => setAreaSide("width", units)} />
          <span className="venue-times">×</span>
          <MetreField label={multiFloor ? "Panjang lantai" : "Panjang venue"} value={area.height} min={Math.max(minVenue, bounds.h)} max={maxVenue} step={grid * 5} onStart={remember} onChange={units => setAreaSide("height", units)} />
          <button type="button" className="venue-tool" onClick={fitToContent} disabled={!floorCourts.length && !floorFeatures.length} data-tip="Geser isi ke pojok kiri atas dan rapatkan area lantai">
            <Shrink size={15} /> Pas ke isi
          </button>
        </div>
        <label className="venue-gridpick">Kisi
          <Select value={grid} onChange={event => { remember(); setGrid(Number(event.target.value)); }}>
            <option value={5}>0,5 m</option>
            <option value={10}>1 m</option>
            <option value={25}>2,5 m</option>
          </Select>
        </label>
        <div className="venue-history">
          <button type="button" className="venue-tool icon" onClick={undo} disabled={!history.current.past.length} aria-label="Batalkan langkah" data-tip="Batalkan langkah (Ctrl+Z)"><Undo2 size={16} /></button>
          <button type="button" className="venue-tool icon" onClick={redo} disabled={!history.current.future.length} aria-label="Ulangi langkah" data-tip="Ulangi langkah (Ctrl+Y)"><Redo2 size={16} /></button>
        </div>
        <div className="grow">
          {dirty && <span className="venue-dirty">Belum disimpan</span>}
          <button type="button" className="ops-secondary" disabled={!dirty || saving} data-tip="Kembalikan ke denah yang terakhir disimpan (bisa dibatalkan dengan Ctrl+Z)"
            onClick={() => { if (saved) { remember(); restore(saved); setSelected(null); } }}>
            <RotateCcw size={15} /> Buang
          </button>
          <button type="button" className="ops-primary" disabled={!dirty || saving} onClick={() => void save()}><Save size={15} /> {saving ? "Menyimpan…" : "Simpan denah"}</button>
        </div>
      </div>

      <div className="venue-editor">
        <div className="venue-workspace">
          <div className="venue-floors" role="tablist" aria-label="Lantai">
            {floors.map(item => (
              <button key={item.id} type="button" role="tab" aria-selected={item.id === area.id} onClick={() => switchFloor(item.id)}>
                <Layers size={15} aria-hidden="true" />
                <span>{item.name || "Tanpa nama"}</span>
                <small>{courts.filter(c => c.floor_id === item.id).length} lap.</small>
                {problems.floorsWithIssue.has(item.id) && <i className="venue-floor-warn" data-tip="Ada lapangan yang menimpa atau keluar area" />}
              </button>
            ))}
            <button type="button" className="venue-floor-add" onClick={addFloor} disabled={floors.length >= maxFloors} data-tip={floors.length >= maxFloors ? `Maksimal ${maxFloors} lantai` : "Tambah lantai baru"}>
              <Plus size={14} aria-hidden="true" /> Tambah lantai
            </button>
          </div>
          <div className="venue-stagebar">
            <div className="venue-zoom" role="group" aria-label="Perbesaran tampilan denah">
              <button type="button" onClick={() => setZoom(value => [...zoomLevels].reverse().find(level => level < value - 0.001) ?? zoomLevels[0])} disabled={zoom <= zoomLevels[0]} aria-label="Perkecil tampilan" data-tip="Perkecil (Ctrl + gulir)"><ZoomOut size={15} /></button>
              <button type="button" className="pct" onClick={() => setZoom(1)} data-tip="Tampilkan seluruh lantai">{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoom(value => zoomLevels.find(level => level > value + 0.001) ?? zoomLevels[zoomLevels.length - 1])} disabled={zoom >= zoomLevels[zoomLevels.length - 1]} aria-label="Perbesar tampilan" data-tip="Perbesar (Ctrl + gulir)"><ZoomIn size={15} /></button>
            </div>
            <p className="venue-status">
              {selectedBox
                ? <><b>{selectedName}</b> · {metre(selectedBox.w)} × {metre(selectedBox.h)} m · X {metre(selectedBox.x)} · Y {metre(selectedBox.y)} m</>
                : "Klik kotak untuk memilih, lalu tarik titik di tepinya untuk mengubah ukuran."}
            </p>
            {(floorClash || floorOutside.length > 0) && (
              <span className="venue-warn" data-tip={floorClash ? "Geser lapangan yang saling menimpa sebelum menyimpan." : `Di luar area: ${floorOutside.map(item => item.name).join(", ")}`}>
                <AlertTriangle size={14} aria-hidden="true" /> {floorClash ? "Lapangan saling menimpa" : "Ada yang di luar area"}
              </span>
            )}
            {selectedBox && (
              <div className="venue-quick">
                <button type="button" className="venue-tool icon" onClick={rotate} aria-label={`Putar ${selectedName}`} data-tip="Putar 90° (R)"><RotateCw size={15} /></button>
                {feature && <button type="button" className="venue-tool icon" onClick={duplicate} aria-label={`Gandakan ${selectedName}`} data-tip="Gandakan (Ctrl+D)"><Copy size={15} /></button>}
                <button type="button" className="venue-tool icon danger" onClick={removeSelected} aria-label={`Hapus ${selectedName}`} data-tip="Hapus (Delete)"><Trash2 size={15} /></button>
              </div>
            )}
          </div>

          {/* --venue-ratio dipakai di layar sempit agar tinggi area denah mengikuti proporsi lantai. */}
          <div className="venue-stage" ref={stage} style={{ "--venue-ratio": area.height / area.width } as React.CSSProperties}>
            <div
              ref={canvas}
              className={`venue-canvas${gesture ? ` gesture-${gesture}` : ""}`}
              style={{ width: area.width * scale, height: area.height * scale, backgroundSize: `${gridShown}px ${gridShown}px` }}
              onPointerDown={event => { if (event.target === canvas.current) setSelected(null); }}
              aria-label={`Denah ${area.name}`}
            >
              <span className="venue-area-size" aria-hidden="true">{multiFloor ? `${area.name} · ` : ""}{metre(area.width)} × {metre(area.height)} m</span>
              {floorFeatures.map(item => (
                <button
                  key={item.id}
                  id={`venue-item-${item.id}`}
                  type="button"
                  className={`venue-feature kind-${item.kind}${selected?.id === item.id ? " selected" : ""}${item.w * scale < 44 || item.h * scale < 22 ? " tiny" : ""}`}
                  style={place(item)}
                  onPointerDown={event => startDrag(event, { type: "feature", id: item.id }, featureBox(item))}
                  onFocus={() => setSelected({ type: "feature", id: item.id })}
                  aria-label={`${featureName(item)}, elemen informasi ${metre(item.w)} × ${metre(item.h)} meter. Panah untuk menggeser, Alt dan panah untuk mengubah ukuran.`}
                >
                  <span>{featureName(item)}</span>
                </button>
              ))}
              {floorCourts.map(item => (
                <button
                  key={item.id}
                  id={`venue-item-${item.id}`}
                  type="button"
                  className={`venue-court${selected?.id === item.id ? " selected" : ""}${item.active ? "" : " inactive"}${problems.clash.has(item.id) ? " clash" : ""}${item.layout_w * scale < 80 || item.layout_h * scale < 56 ? " tiny" : ""}`}
                  style={place(courtBox(item))}
                  onPointerDown={event => startDrag(event, { type: "court", id: item.id }, courtBox(item))}
                  onFocus={() => setSelected({ type: "court", id: item.id })}
                  aria-label={`${item.name}, lapangan ${metre(item.layout_w)} × ${metre(item.layout_h)} meter. Panah untuk menggeser, Alt dan panah untuk mengubah ukuran.`}
                >
                  <span className="net" aria-hidden="true" />
                  <b>{item.name}</b>
                  <small>{metre(item.layout_w)} × {metre(item.layout_h)} m</small>
                </button>
              ))}
              {selectedBox && (
                <div className={`venue-frame${selectedBox.y * scale < 34 ? " below" : ""}`} style={place(selectedBox)} aria-hidden="true">
                  <span className="venue-frame-size">{metre(selectedBox.w)} × {metre(selectedBox.h)} m</span>
                  {handles
                    // Titik sisi hanya bila kotak cukup besar, agar titik tidak saling menumpuk.
                    .filter(handle => handle.length === 2 || (handle.includes("n") || handle.includes("s") ? selectedBox.w * scale >= 64 : selectedBox.h * scale >= 64))
                    .map(handle => <i key={handle} className={`venue-handle h-${handle}`} onPointerDown={event => startResize(event, handle)} />)}
                </div>
              )}
              {(["e", "s", "se"] as const).map(edge => (
                <button
                  key={edge}
                  type="button"
                  className={`venue-area-handle ${edge}`}
                  onPointerDown={event => startAreaResize(event, edge)}
                  onKeyDown={event => resizeAreaByKey(event, edge)}
                  aria-label={edge === "e" ? `Ubah lebar ${area.name}` : edge === "s" ? `Ubah panjang ${area.name}` : `Ubah lebar dan panjang ${area.name}`}
                  data-tip="Seret untuk mengubah ukuran area"
                ><i /></button>
              ))}
            </div>
          </div>
        </div>

        <aside className="venue-side" ref={side}>
          {selectedBox && selected ? (
            <section className="venue-panel venue-inspector" aria-label={`Pengaturan ${selectedName}`}>
              <header>
                <span className={`venue-swatch ${court ? "court" : `kind-${feature!.kind}`}`} aria-hidden="true" />
                <div>
                  <small>{court ? "Lapangan" : "Elemen informasi"}</small>
                  <h3>{selectedName}</h3>
                </div>
              </header>
              {court && <p className="hint">Buka {court.opens_at}–{court.closes_at} · {court.active ? "aktif" : "nonaktif"}. Nama, tarif, dan jam diubah di menu Lapangan.</p>}
              {feature && (
                <div className="venue-grid2">
                  <label className="venue-field">Jenis
                    <Select className="venue-input" value={feature.kind} onFocus={remember} onChange={event => setFeatures(list => list.map(item => item.id === feature.id ? { ...item, kind: event.target.value as FeatureKind } : item))}>
                      {featureKinds.map(kind => <option key={kind} value={kind}>{featureInfo[kind].label}</option>)}
                    </Select>
                  </label>
                  <label className="venue-field">Nama tampil
                    <input className="venue-input" maxLength={40} placeholder={featureInfo[feature.kind].label} value={feature.label} onFocus={remember}
                      onChange={event => setFeatures(list => list.map(item => item.id === feature.id ? { ...item, label: event.target.value } : item))} />
                  </label>
                </div>
              )}
              {multiFloor && (
                <label className="venue-field">Lantai
                  <Select className="venue-input" value={area.id} onChange={event => moveToFloor(event.target.value)}>
                    {floors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </Select>
                </label>
              )}
              <div className="venue-grid2">
                <MetreField label="Lebar" value={selectedBox.w} min={minSide[selected.type]} max={area.width - selectedBox.x} step={grid} onStart={remember} onChange={units => updateSelected({ w: units })} />
                <MetreField label="Panjang" value={selectedBox.h} min={minSide[selected.type]} max={area.height - selectedBox.y} step={grid} onStart={remember} onChange={units => updateSelected({ h: units })} />
                <MetreField label="Dari kiri" value={selectedBox.x} min={0} max={area.width - selectedBox.w} step={grid} onStart={remember} onChange={units => updateSelected({ x: units })} />
                <MetreField label="Dari atas" value={selectedBox.y} min={0} max={area.height - selectedBox.h} step={grid} onStart={remember} onChange={units => updateSelected({ y: units })} />
              </div>
              {court && (
                <div className="venue-presets">
                  <span>Ukuran standar</span>
                  <button type="button" onClick={() => { remember(); updateSelected({ w: 100, h: 200 }); }}>10 × 20 m</button>
                  <button type="button" onClick={() => { remember(); updateSelected({ w: 200, h: 100 }); }}>20 × 10 m</button>
                </div>
              )}
              <div className="row-buttons">
                <button type="button" onClick={rotate}><RotateCw size={14} /> Putar</button>
                {feature && <button type="button" onClick={duplicate}><Copy size={14} /> Gandakan</button>}
                <button type="button" className="danger" onClick={removeSelected}><Trash2 size={14} /> Hapus</button>
              </div>
            </section>
          ) : (
            <section className="venue-panel venue-tips">
              <h3>Cara menyusun denah</h3>
              <ul>
                <li><b>Seret kotak</b> untuk memindahkannya.</li>
                <li><b>Tarik titik</b> di sudut atau sisi kotak terpilih untuk mengubah ukuran. Tahan <kbd>Shift</kbd> di sudut agar proporsinya tetap.</li>
                <li><b>Tarik tepi kanan atau bawah</b> area untuk mengubah luasnya.</li>
                <li>Venue bertingkat: <b>Tambah lantai</b> di atas denah, lalu pindahkan lapangan lewat pilihan Lantai.</li>
                <li><kbd>←↑→↓</kbd> menggeser, <kbd>Alt</kbd>+panah mengubah ukuran, <kbd>R</kbd> memutar, <kbd>Delete</kbd> menghapus, <kbd>Ctrl</kbd>+<kbd>Z</kbd> membatalkan.</li>
              </ul>
            </section>
          )}

          <section className="venue-panel venue-floor-panel" aria-label="Pengaturan lantai">
            <h3>{multiFloor ? "Lantai ini" : "Lantai"}</h3>
            <label className="venue-field">Nama lantai
              <input className="venue-input" maxLength={30} value={area.name} onFocus={remember}
                onChange={event => setFloors(list => list.map(item => item.id === area.id ? { ...item, name: event.target.value } : item))}
                onBlur={event => { if (!event.target.value.trim()) setFloors(list => list.map(item => item.id === area.id ? { ...item, name: `Lantai ${floorIndex + 1}` } : item)); }} />
            </label>
            <p className="hint">{floorCourts.length} lapangan · {floorFeatures.length} elemen · {metre(area.width)} × {metre(area.height)} m</p>
            {multiFloor && (
              <div className="row-buttons">
                <button type="button" onClick={() => moveFloor(-1)} disabled={floorIndex === 0} data-tip="Pindahkan tab lantai ke kiri"><ArrowLeft size={14} /> Geser</button>
                <button type="button" onClick={() => moveFloor(1)} disabled={floorIndex === floors.length - 1} data-tip="Pindahkan tab lantai ke kanan">Geser <ArrowRight size={14} /></button>
                <button type="button" className="danger" onClick={removeFloor} disabled={itemCount(area.id) > 0} data-tip={itemCount(area.id) > 0 ? "Pindahkan atau hapus isi lantai ini terlebih dahulu" : "Hapus lantai kosong ini"}><Trash2 size={14} /> Hapus</button>
              </div>
            )}
            {multiFloor && itemCount(area.id) > 0 && <p className="hint">Lantai yang masih berisi tidak dapat dihapus.</p>}
          </section>

          <section className="venue-panel">
            <h3>Tambah ke {area.name}</h3>
            <button type="button" className="ops-secondary venue-add-court" onClick={() => setAddingCourt(true)}><Plus size={15} /> Lapangan baru</button>
            <p className="hint">Elemen informasi hanya keterangan untuk pelanggan dan tidak dapat dipesan.</p>
            <div className="venue-kinds">
              {featureKinds.map(kind => (
                <button key={kind} type="button" onClick={() => addFeature(kind)}><i className={`dot kind-${kind}`} aria-hidden="true" /> {featureInfo[kind].label}</button>
              ))}
            </div>
          </section>

          <section className="venue-panel">
            <h3>Isi {area.name}</h3>
            <div className="venue-list">
              <p className="venue-list-title">Lapangan · {floorCourts.length}</p>
              {floorCourts.map(item => (
                <button key={item.id} type="button" className={selected?.id === item.id ? "on" : ""} onClick={() => select({ type: "court", id: item.id })}>
                  <i className={item.active ? "" : "off"} />
                  {item.name}
                  <span>{money(item.hourly_rate)}</span>
                </button>
              ))}
              {!floorCourts.length && <p className="hint">Belum ada lapangan di lantai ini.</p>}
              {floorFeatures.length > 0 && <p className="venue-list-title">Elemen informasi · {floorFeatures.length}</p>}
              {floorFeatures.map(item => (
                <button key={item.id} type="button" className={selected?.id === item.id ? "on" : ""} onClick={() => select({ type: "feature", id: item.id })}>
                  <i className={`dot kind-${item.kind}`} />
                  {featureName(item)}
                  <span>{metre(item.w)} × {metre(item.h)} m</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {addingCourt && (
        <NewCourtForm
          state={{ grid, floors, courts, features }}
          floor={area}
          close={() => setAddingCourt(false)}
          done={() => { setAddingCourt(false); void load(); }}
        />
      )}
    </>
  );
}

/** Pintasan keyboard di seluruh halaman; handler selalu versi terbaru lewat ref. */
function KeyboardShortcuts({ handler }: { handler: React.RefObject<(event: KeyboardEvent) => void> }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handler.current?.(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handler]);
  return null;
}

/** Input meter dengan tombol kurang/tambah. Menerima koma maupun titik sebagai desimal. */
function MetreField({ label, value, min, max, step, onChange, onStart }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (units: number) => void; onStart: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const apply = (units: number) => onChange(clamp(units, min, max));
  return (
    <div className="venue-field">
      <label htmlFor={id}>{label}</label>
      <div className="venue-stepper">
        <button type="button" tabIndex={-1} aria-label={`Kurangi ${label.toLowerCase()}`} data-tip={`Kurangi ${label.toLowerCase()}`} disabled={value <= min} onClick={() => { onStart(); apply(value - step); }}><Minus size={13} /></button>
        <input
          id={id}
          inputMode="decimal"
          value={draft ?? metre(value)}
          onFocus={event => { onStart(); event.target.select(); }}
          onChange={event => {
            setDraft(event.target.value);
            const parsed = Number(event.target.value.replace(",", "."));
            if (event.target.value.trim() && Number.isFinite(parsed)) apply(fromMetre(parsed));
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault(); setDraft(null); onStart();
              apply(value + (event.key === "ArrowUp" ? step : -step));
            }
          }}
        />
        <span className="unit" aria-hidden="true">m</span>
        <button type="button" tabIndex={-1} aria-label={`Tambah ${label.toLowerCase()}`} data-tip={`Tambah ${label.toLowerCase()}`} disabled={value >= max} onClick={() => { onStart(); apply(value + step); }}><Plus size={13} /></button>
      </div>
    </div>
  );
}

function NewCourtForm({ state, floor, close, done }: { state: Snapshot; floor: Floor; close: () => void; done: () => void }) {
  const [form, setForm] = useState({ name: "", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00", active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Cari ruang kosong pertama di lantai ini agar lapangan baru tidak lahir menimpa lapangan lain. */
  function freeSpot(): Box | null {
    const w = 100, h = 200, taken = state.courts.filter(c => c.floor_id === floor.id);
    for (let y = 0; y + h <= floor.height; y += state.grid * 2)
      for (let x = 0; x + w <= floor.width; x += state.grid * 2)
        if (!taken.some(c => overlaps({ x, y, w, h }, courtBox(c)))) return { x, y, w, h };
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const spot = freeSpot();
      if (!spot) throw new Error(`Tidak ada ruang kosong di ${floor.name}. Perbesar area lantai terlebih dahulu.`);
      const { court } = await api<{ court: Court }>("/operations/courts", { method: "POST", body: JSON.stringify(form) });
      const placed: Court = { ...court, floor_id: floor.id, layout_x: spot.x, layout_y: spot.y, layout_w: spot.w, layout_h: spot.h };
      await api("/operations/layout", { method: "PUT", body: JSON.stringify(payload({ ...state, courts: [...state.courts, placed] })) });
      toast.success(`Lapangan ditambahkan ke ${floor.name}`);
      done();
    } catch (problem) { setError((problem as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Tambah lapangan di ${floor.name}`} close={close}>
      <form onSubmit={submit}>
        <div className="modal-fields">
          {error && <ErrorBox message={error} />}
          <label>Nama lapangan
            <input autoFocus required minLength={2} maxLength={60} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>Tarif per jam
            <MoneyInput min={1000} max={10000000} required value={form.hourly_rate} onChange={event => setForm({ ...form, hourly_rate: Number(event.target.value) })} />
          </label>
          <div className="field-grid">
            <label>Jam buka<DateInput type="time" step={1800} required value={form.opens_at} onChange={event => setForm({ ...form, opens_at: event.target.value })} /></label>
            <label>Jam tutup<DateInput type="time" step={1800} required value={form.closes_at} onChange={event => setForm({ ...form, closes_at: event.target.value })} /></label>
          </div>
          <p className="ops-muted">Lapangan baru diletakkan otomatis di ruang kosong pertama {floor.name} dengan ukuran standar 10 × 20 m. Perubahan denah yang belum disimpan ikut tersimpan.</p>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={close} disabled={busy}>Batal</button>
          <Submit busy={busy}>Tambah</Submit>
        </div>
      </form>
    </Modal>
  );
}
