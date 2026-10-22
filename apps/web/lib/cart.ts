"use client";

import { useSyncExternalStore } from "react";
import type { AddonOption, AddonPricing } from "./addons";
import { lineTotal } from "./addons";
import { venueNow } from "./shop";

/**
 * Keranjang pelanggan. Disimpan di browser saja: server baru tahu isinya saat checkout,
 * sehingga tidak ada slot yang terkunci sebelum pelanggan benar-benar membayar.
 * Sesi yang jam mainnya sudah lewat dibuang otomatis setiap kali keranjang dibaca.
 */
export type CartAddon = { addon_id: string; name: string; quantity: number; unit_price: number; pricing: AddonPricing };
export type CartItem = {
  /** Id lokal, hanya untuk membedakan baris di halaman keranjang. */
  key: string;
  court_id: string; court_name: string; floor: string;
  date: string; start_time: string; end_time: string; duration: number;
  /** Perkiraan saat ditambahkan; harga resmi selalu datang dari server saat keranjang diperiksa. */
  court_total: number;
  addons: CartAddon[];
  added_at: number;
};
export const maxCartItems = 6;
const storageKey = "padelix_cart_v1";
const empty: CartItem[] = [];

function parse(raw: string | null): CartItem[] {
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(value)) return empty;
    const now = venueNow();
    return value.filter(item =>
      item && typeof item.key === "string" && typeof item.court_id === "string"
      && (item.date > now.date || (item.date === now.date && item.start_time >= now.time)))
      .slice(0, maxCartItems);
  } catch { return empty; }
}
function read(): CartItem[] {
  if (typeof window === "undefined") return empty;
  try { return parse(window.localStorage.getItem(storageKey)); } catch { return empty; }
}

const listeners = new Set<() => void>();
let cache: CartItem[] | null = null;
function emit() { cache = null; for (const listener of listeners) listener(); }
function write(items: CartItem[]) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* mode privat: keranjang hanya bertahan di halaman ini */ }
  cache = items;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) emit(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
function snapshot() { if (!cache) cache = read(); return cache; }

/** Isi keranjang, ikut berubah di semua tab. */
export function useCart() {
  return useSyncExternalStore(subscribe, snapshot, () => empty);
}
const noSubscribe = () => () => { };
/**
 * False saat HTML dari server dan hidrasi pertama: isi keranjang di browser belum terbaca,
 * jadi jangan tampilkan "keranjang kosong" dulu.
 */
export function useCartReady() {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export const sameSlot = (a: Pick<CartItem, "court_id" | "date" | "start_time">, b: Pick<CartItem, "court_id" | "date" | "start_time">) =>
  a.court_id === b.court_id && a.date === b.date && a.start_time === b.start_time;
export const overlaps = (a: Pick<CartItem, "court_id" | "date" | "start_time" | "end_time">, b: Pick<CartItem, "court_id" | "date" | "start_time" | "end_time">) =>
  a.court_id === b.court_id && a.date === b.date && a.start_time < b.end_time && a.end_time > b.start_time;

export type AddResult = "ok" | "duplicate" | "overlap" | "full";
export function addToCart(item: Omit<CartItem, "key" | "added_at">): AddResult {
  const items = snapshot();
  if (items.some(entry => sameSlot(entry, item))) return "duplicate";
  if (items.some(entry => overlaps(entry, item))) return "overlap";
  if (items.length >= maxCartItems) return "full";
  write([...items, { ...item, key: crypto.randomUUID(), added_at: Date.now() }]);
  return "ok";
}
export function removeFromCart(key: string) { write(snapshot().filter(item => item.key !== key)); }
export function clearCart() { write([]); }
/** Ubah jumlah satu tambahan pada satu sesi; nol berarti dihapus. */
export function setCartAddon(key: string, option: Pick<AddonOption, "id" | "name" | "price" | "pricing">, quantity: number) {
  write(snapshot().map(item => {
    if (item.key !== key) return item;
    const others = item.addons.filter(line => line.addon_id !== option.id);
    return {
      ...item,
      addons: quantity > 0
        ? [...others, { addon_id: option.id, name: option.name, quantity, unit_price: option.price, pricing: option.pricing }]
        : others,
    };
  }));
}

export const addonsTotal = (item: CartItem) =>
  item.addons.reduce((sum, line) => sum + lineTotal(line.unit_price, line.quantity, line.pricing, item.duration), 0);
export const itemTotal = (item: CartItem) => item.court_total + addonsTotal(item);
export const cartTotal = (items: CartItem[]) => items.reduce((sum, item) => sum + itemTotal(item), 0);
export const cartAddonCount = (items: CartItem[]) => items.reduce((sum, item) => sum + item.addons.reduce((n, line) => n + line.quantity, 0), 0);
/** Bentuk yang dikirim ke API: server menghitung ulang seluruh harganya sendiri. */
export const cartPayload = (items: CartItem[]) => items.map(item => ({
  court_id: item.court_id, date: item.date, start_time: item.start_time, end_time: item.end_time,
  addons: item.addons.map(line => ({ addon_id: line.addon_id, quantity: line.quantity })),
}));
