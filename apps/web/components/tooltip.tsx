"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

/*
 * Tooltip seragam untuk seluruh aplikasi (panel staf dan situs pelanggan).
 *
 * - Elemen apa pun yang diberi atribut `data-tip="…"` menampilkan tooltip saat disorot
 *   mouse atau difokus dengan papan ketik. Dipakai menggantikan atribut `title` bawaan
 *   browser yang lambat muncul, tidak bisa diatur tampilannya, dan tidak jalan di layar sentuh.
 * - <InfoTip text="…" /> adalah ikon (i) kecil di samping label isian, judul kolom, atau
 *   kartu ringkasan. Di ponsel cukup diketuk untuk membuka dan menutup penjelasannya.
 *
 * Hanya satu tooltip yang tampil sekaligus, digambar oleh <TooltipLayer /> di root layout.
 */

const BUBBLE_ID = "app-tooltip";
const GAP = 8;
const EDGE = 8;

type Tip = { el: HTMLElement; text: string; pinned: boolean };
type Controller = { show: (el: HTMLElement, pinned?: boolean) => void; hide: () => void; current: () => Tip | null };

let controller: Controller | null = null;

/** Membuka atau menutup tooltip sebuah elemen; dipakai ikon info saat diketuk. */
function toggle(el: HTMLElement) {
  if (!controller) return;
  const current = controller.current();
  if (current?.el === el && current.pinned) controller.hide();
  else controller.show(el, true);
}

export function InfoTip({ text, label = "Info", className }: { text: string; label?: string; className?: string }) {
  const id = useId();
  function click(event: MouseEvent<HTMLButtonElement>) {
    // Ikon sering berada di dalam <label> atau judul kolom yang bisa diklik; jangan ikut memicu keduanya.
    event.preventDefault();
    event.stopPropagation();
    toggle(event.currentTarget);
  }
  return (
    <button type="button" className={`info-tip${className ? ` ${className}` : ""}`} data-tip={text} data-tip-info aria-label={label} aria-describedby={id} onClick={click}>
      <Info aria-hidden="true" strokeWidth={2.25} />
      <span id={id} hidden>{text}</span>
    </button>
  );
}

/** Teks label isian beserta ikon info-nya, mis. <label><LabelTip tip="…">Nominal</LabelTip><input/></label>. */
export function LabelTip({ children, tip }: { children: ReactNode; tip: string }) {
  return <span className="label-tip">{children}<InfoTip text={tip} /></span>;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; arrow: number; below: boolean } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warmUntil = 0;
    const set = (next: Tip | null) => {
      const prev = tipRef.current;
      if (prev) {
        prev.el.removeAttribute("data-tip-open");
        if (prev.el.getAttribute("aria-describedby") === BUBBLE_ID) prev.el.removeAttribute("aria-describedby");
      }
      next?.el.setAttribute("data-tip-open", "");
      // Ikon info sudah punya aria-describedby ke teksnya sendiri; elemen lain diarahkan ke gelembung.
      if (next && !next.el.hasAttribute("aria-describedby")) next.el.setAttribute("aria-describedby", BUBBLE_ID);
      tipRef.current = next;
      setTip(next);
      setPlace(null);
    };
    const show = (el: HTMLElement, pinned = false) => {
      clearTimeout(timer);
      const text = el.dataset.tip?.trim();
      if (!text) return;
      set({ el, text, pinned });
    };
    const hide = () => {
      clearTimeout(timer);
      if (tipRef.current) warmUntil = Date.now() + 400;
      if (tipRef.current) set(null);
    };
    controller = { show, hide, current: () => tipRef.current };

    const find = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;

    function over(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const el = find(event.target);
      if (!el || el === tipRef.current?.el) return;
      clearTimeout(timer);
      // Tooltip berikutnya langsung muncul bila pengguna sedang menyusuri beberapa ikon.
      const warm = tipRef.current || Date.now() < warmUntil;
      const delay = warm ? 0 : el.hasAttribute("data-tip-info") ? 120 : 450;
      timer = setTimeout(() => show(el), delay);
    }
    function out(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const el = find(event.target);
      if (!el) return;
      const to = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (to && el.contains(to)) return;
      clearTimeout(timer);
      if (tipRef.current?.el === el && !tipRef.current.pinned) hide();
    }
    function focusIn(event: FocusEvent) {
      const el = find(event.target);
      if (el && el === event.target && el.matches(":focus-visible")) show(el);
    }
    function focusOut(event: FocusEvent) {
      if (tipRef.current && tipRef.current.el === event.target) hide();
    }
    function down(event: PointerEvent) {
      const current = tipRef.current;
      if (!current) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target && (current.el.contains(target) || bubble.current?.contains(target))) return;
      hide();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && tipRef.current) {
        // Esc cukup menutup tooltip, bukan dialog di belakangnya.
        event.stopImmediatePropagation();
        hide();
      }
    }
    function moved() { if (tipRef.current) hide(); }

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      clearTimeout(timer);
      controller = null;
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, []);

  /* Bila elemen sumber hilang (mis. dialog ditutup), tooltip ikut hilang. */
  useEffect(() => {
    if (!tip) return;
    const check = setInterval(() => { if (!tip.el.isConnected) controller?.hide(); }, 300);
    return () => clearInterval(check);
  }, [tip]);

  useLayoutEffect(() => {
    if (!tip || !bubble.current) return;
    const anchor = tip.el.getBoundingClientRect();
    const box = bubble.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const center = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(center - box.width / 2, EDGE), vw - box.width - EDGE);
    const below = anchor.top - box.height - GAP < EDGE;
    const top = below ? anchor.bottom + GAP : anchor.top - box.height - GAP;
    const arrow = Math.min(Math.max(center - left, 12), box.width - 12);
    setPlace({ top, left, arrow, below });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      id={BUBBLE_ID}
      role="tooltip"
      className={`app-tooltip${tip.el.hasAttribute("data-tip-info") ? " is-info" : ""}${place?.below ? " below" : ""}${place ? " shown" : ""}`}
      style={{ top: place?.top ?? 0, left: place?.left ?? 0, ["--arrow" as string]: `${place?.arrow ?? 0}px` }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
