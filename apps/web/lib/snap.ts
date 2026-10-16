"use client";

/**
 * Snap.js Midtrans: jendela pembayaran tampil di dalam halaman pesanan,
 * sehingga pelanggan tidak berpindah situs dan statusnya bisa langsung diperbarui.
 */
type SnapResult = { order_id?: string; transaction_status?: string; status_code?: string };
type SnapOptions = {
  embedId?: string;
  onSuccess?: (result: SnapResult) => void;
  onPending?: (result: SnapResult) => void;
  onError?: (result: SnapResult) => void;
  onClose?: () => void;
};
export type Snap = {
  embed?: (token: string, options: SnapOptions & { embedId: string }) => void;
  pay: (token: string, options?: SnapOptions) => void;
  hide?: () => void;
};
declare global { interface Window { snap?: Snap } }

const scriptUrl = (environment: "sandbox" | "production") =>
  environment === "production" ? "https://app.midtrans.com/snap/snap.js" : "https://app.sandbox.midtrans.com/snap/snap.js";

let loading: Promise<Snap> | null = null;

/** Memuat Snap.js sekali saja; gagal (mis. jaringan diblokir) berarti pelanggan memakai tautan biasa. */
export function loadSnap(clientKey: string, environment: "sandbox" | "production" = "sandbox"): Promise<Snap> {
  if (typeof window === "undefined") return Promise.reject(new Error("Snap hanya tersedia di browser."));
  if (window.snap) return Promise.resolve(window.snap);
  if (!loading) {
    loading = new Promise<Snap>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl(environment);
      script.dataset.clientKey = clientKey;
      script.async = true;
      script.onload = () => (window.snap ? resolve(window.snap) : reject(new Error("Snap tidak tersedia.")));
      script.onerror = () => reject(new Error("Snap.js gagal dimuat."));
      document.head.appendChild(script);
    });
    loading.catch(() => { loading = null; });
  }
  return loading;
}
