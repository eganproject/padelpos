"use client";

import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";

/** Sama dengan API (apps/api/src/customers.ts). */
export type Account = {
  id: string; email: string; name: string; phone: string; photo_url: string; created_at: string; needs_profile: boolean;
};
export type Phase = "upcoming" | "past" | "cancelled";
export type HistoryItem = {
  id: string; code: string; order_id: string | null; order_code: string | null;
  court_id: string; court_name: string; date: string; start_time: string; end_time: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "expired"; phase: Phase; source: "staff" | "online";
  total: number; paid: number; cancel_reason: string;
  /** Boleh tidaknya pelanggan memindah jadwal sendiri, dengan keterangan untuk ditampilkan. */
  reschedule?: { allowed: boolean; reason: string };
  addons: { name: string; quantity: number; subtotal: number }[];
};
export type Overview = {
  account: Account;
  next: HistoryItem | null;
  upcoming: HistoryItem[];
  upcoming_count: number;
  awaiting: { order_id: string; order_code: string; amount: number; expires_at: number; sessions: number }[];
  recent: HistoryItem[];
  stats: { sessions: number; hours: number; this_month: number; favorite: { id: string; name: string; sessions: number } | null };
};
export type FirebaseWebConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };
export type PublicLogin = { enabled: false; firebase: null } | { enabled: true; firebase: FirebaseWebConfig };

/**
 * Akun yang sedang masuk, dibagi ke seluruh halaman: kepala halaman, keranjang, dan area akun
 * membaca satu sumber yang sama. `undefined` berarti belum diperiksa, `null` berarti tamu.
 */
let current: Account | null | undefined;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
export function setAccount(account: Account | null) { current = account; emit(); }
export function refreshAccount() {
  loading = api<{ account: Account | null }>("/customer/session")
    .then(result => setAccount(result.account))
    .catch(() => { if (current === undefined) setAccount(null); })
    .finally(() => { loading = null; });
  return loading;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (current === undefined && !loading) void refreshAccount();
  return () => { listeners.delete(listener); };
}
export function useAccount() {
  return useSyncExternalStore(subscribe, () => current, () => undefined);
}

/** Pesan untuk kode galat Firebase yang mungkin ditemui pelanggan atau admin saat menyiapkan. */
const firebaseMessages: Record<string, string> = {
  "auth/unauthorized-domain": "Alamat situs ini belum diizinkan di Firebase. Minta admin menambahkannya di Authorized domains.",
  "auth/operation-not-allowed": "Login Google belum diaktifkan di Firebase. Minta admin menyalakannya di Sign-in method.",
  "auth/invalid-api-key": "Konfigurasi Firebase di panel admin tidak valid.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Konfigurasi Firebase di panel admin tidak valid.",
  "auth/network-request-failed": "Koneksi terputus. Periksa internet Anda lalu coba lagi.",
  "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  "auth/user-disabled": "Akun Google ini dinonaktifkan. Hubungi venue.",
  "auth/internal-error": "Google sedang bermasalah. Coba lagi sebentar lagi.",
};
/** Pelanggan menutup jendela Google sendiri: bukan galat yang perlu ditampilkan. */
const quietCodes = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);
export class SignInCancelled extends Error {}

/**
 * SDK Firebase hanya diunduh saat pelanggan menekan "Masuk dengan Google": halaman lain tidak
 * ikut membayar ukurannya. Setelah token ditukar menjadi sesi aplikasi, sesi Firebase di browser
 * langsung ditutup — aplikasi tidak bergantung padanya lagi.
 */
async function firebase(config: FirebaseWebConfig) {
  const [{ initializeApp, getApps }, auth] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
  const name = `padelix-${config.projectId}`;
  const app = getApps().find(item => item.name === name) ?? initializeApp(config, name);
  const instance = auth.getAuth(app);
  instance.languageCode = "id";
  return { auth, instance };
}
async function exchange(idToken: string) {
  const result = await api<{ account: Account; created: boolean }>("/customer/session", { method: "POST", body: JSON.stringify({ id_token: idToken }) });
  setAccount(result.account);
  return result;
}
function explain(problem: unknown): never {
  const code = (problem as { code?: string })?.code ?? "";
  if (quietCodes.has(code)) throw new SignInCancelled();
  if (problem instanceof ApiError) throw problem;
  throw new Error(firebaseMessages[code] ?? "Login Google gagal. Coba lagi sebentar lagi.");
}

export async function signInWithGoogle(config: FirebaseWebConfig) {
  const { auth, instance } = await firebase(config);
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await auth.signInWithPopup(instance, provider);
    const token = await credential.user.getIdToken();
    return await exchange(token);
  } catch (problem) {
    // Peramban dalam aplikasi (Instagram, WhatsApp) sering memblokir jendela baru: pindah halaman saja.
    if ((problem as { code?: string })?.code === "auth/popup-blocked") {
      sessionStorage.setItem("padelix_login_redirect", "1");
      await auth.signInWithRedirect(instance, provider);
      return null;
    }
    explain(problem);
  } finally {
    await auth.signOut(instance).catch(() => {});
  }
}

/** Menyelesaikan login yang tadi dialihkan ke halaman Google (cadangan bila jendela diblokir). */
export async function finishRedirect(config: FirebaseWebConfig) {
  if (sessionStorage.getItem("padelix_login_redirect") !== "1") return null;
  sessionStorage.removeItem("padelix_login_redirect");
  const { auth, instance } = await firebase(config);
  try {
    const credential = await auth.getRedirectResult(instance);
    if (!credential) return null;
    return await exchange(await credential.user.getIdToken());
  } catch (problem) {
    explain(problem);
  } finally {
    await auth.signOut(instance).catch(() => {});
  }
}

export async function signOut() {
  await api("/customer/logout", { method: "POST", body: "{}" }).catch(() => {});
  setAccount(null);
}

/** Sesi habis di tengah jalan (mis. akun dihapus di tab lain): kerangka akun mengarahkan ke halaman masuk. */
async function member<T>(request: Promise<T>) {
  try { return await request; }
  catch (problem) { if (problem instanceof ApiError && problem.status === 401) setAccount(null); throw problem; }
}
export const fetchOverview = () => member(api<Overview>("/customer/overview"));
export const fetchHistory = (scope: Phase) => member(api<{ items: HistoryItem[]; counts: Record<Phase, number> }>(`/customer/bookings?scope=${scope}`));
export const saveProfile = async (body: { name: string; phone: string }) => {
  const result = await api<{ account: Account }>("/customer/me", { method: "PUT", body: JSON.stringify(body) });
  setAccount(result.account);
  return result.account;
};
export const rescheduleBooking = (id: string, body: { court_id: string; date: string; start_time: string; end_time: string }) =>
  member(api<{ booking: HistoryItem }>(`/customer/bookings/${encodeURIComponent(id)}/reschedule`, { method: "POST", body: JSON.stringify(body) }));
export const claimOrder = (body: { code: string; phone: string }) =>
  api<{ linked: number; already: number }>("/customer/claim", { method: "POST", body: JSON.stringify(body) });
export async function deleteAccount() {
  await api("/customer/me", { method: "DELETE" });
  setAccount(null);
}

/** Sama dengan aturan server (phoneSchema): nomor HP Indonesia 08…, 628…, atau +628…. */
export function validPhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  const normalized = digits.startsWith("0") ? "62" + digits.slice(1) : digits.startsWith("62") ? digits : "62" + digits;
  return /^628\d{7,12}$/.test(normalized);
}

/** Halaman tujuan setelah masuk. Hanya jalur di situs ini, bukan alamat luar. */
export const safeNext = (value: string | null) => (value && value.startsWith("/") && !value.startsWith("//") ? value : "/akun");

/** Berkas kalender (.ics) untuk satu sesi, dibuat di browser tanpa bantuan server. */
export function calendarFile(item: Pick<HistoryItem, "id" | "court_name" | "date" | "start_time" | "end_time">, venue: { name: string; address: string }) {
  // Jam venue memakai WIB; ditulis dengan offset tetap agar kalender di zona lain tetap tepat.
  const stamp = (date: string, time: string) => {
    // "24:00" adalah tengah malam berikutnya, bukan 23:59.
    const local = new Date(`${date}T${time === "24:00" ? "00:00" : time}:00+07:00`);
    if (time === "24:00") local.setUTCDate(local.getUTCDate() + 1);
    return local.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  const escape = (value: string) => value.replace(/[\\,;]/g, match => `\\${match}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Padelix//Booking//ID", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${item.id}@padelix`, `DTSTAMP:${stamp(new Date().toISOString().slice(0, 10), "00:00")}`,
    `DTSTART:${stamp(item.date, item.start_time)}`, `DTEND:${stamp(item.date, item.end_time)}`,
    `SUMMARY:${escape(`Main padel · ${item.court_name}`)}`,
    `LOCATION:${escape([venue.name, venue.address].filter(Boolean).join(", "))}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${escape(`Main padel di ${item.court_name} dua jam lagi`)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
}
