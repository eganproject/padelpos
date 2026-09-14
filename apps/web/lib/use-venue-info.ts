"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { PublicInfo } from "./venue-info";

// Header, halaman, dan footer membutuhkan data yang sama; satu permintaan dipakai bersama
// dan disegarkan setelah dua menit agar perubahan dari admin cepat terlihat.
let cache: { at: number; promise: Promise<PublicInfo> } | null = null;

export function loadVenueInfo() {
  if (!cache || Date.now() - cache.at > 120_000) {
    const promise = api<PublicInfo>("/public/info");
    cache = { at: Date.now(), promise };
    promise.catch(() => { if (cache?.promise === promise) cache = null; });
  }
  return cache.promise;
}

export function useVenueInfo() {
  const [data, setData] = useState<PublicInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadVenueInfo().then(value => { if (live) setData(value); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return { data, failed };
}
