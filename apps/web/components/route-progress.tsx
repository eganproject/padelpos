"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * Garis tipis di atas layar saat berpindah halaman, di panel staf maupun situs pelanggan.
 * Mulai saat tautan internal diklik (atau tombol kembali/maju browser), lalu selesai
 * begitu alamat halaman berubah. Tanpa pustaka tambahan.
 * Perpindahan lewat kode (`router.push`) memanggil `startRouteProgress()` agar garisnya ikut tampil.
 */
const startEvent = "route-progress:start";
export function startRouteProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(startEvent));
}

function RouteProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [width, setWidth] = useState(0);
  const timers = useRef<number[]>([]);

  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  const loading = useRef(false);

  const finish = () => {
    if (!loading.current) return;
    loading.current = false;
    clear();
    setState("done");
    setWidth(100);
    later(() => { setState("idle"); setWidth(0); }, 320);
  };

  const start = () => {
    clear();
    loading.current = true;
    setState("loading");
    setWidth(0);
    // Tampil hanya bila perpindahan terasa lambat, supaya halaman cepat tidak berkedip.
    later(() => setWidth(28), 120);
    later(() => setWidth(55), 600);
    later(() => setWidth(72), 1500);
    later(() => setWidth(86), 3500);
    // Jaga-jaga bila klik ternyata tidak memindah halaman.
    later(finish, 10000);
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      const next = new URL(a.href, location.href);
      if (next.origin !== location.origin) return;
      if (next.pathname === location.pathname && next.search === location.search) return;
      start();
    };
    const onPop = () => start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    window.addEventListener(startEvent, onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(startEvent, onPop);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { finish(); /* alamat berubah: halaman baru sudah tampil */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  if (state === "idle") return null;
  return (
    <div className="route-progress" aria-hidden="true" data-state={state}>
      <div className="route-progress-bar" style={{ width: `${width}%` }} />
    </div>
  );
}

export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <RouteProgressBar />
    </Suspense>
  );
}
