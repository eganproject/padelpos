"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { isRoll, pageCss, paperOptions, type Paper, type ReceiptData } from "@/lib/receipt";
import { Receipt } from "@/components/receipt";

const papers = paperOptions.map(option => option.value);
const toMm = (px: number) => px * 25.4 / 96;

/**
 * Halaman cetak nota untuk kasir, dibuka dari detail booking di panel admin. Ukuran kertas
 * bawaan diambil dari Pengaturan › Nota & Cetak dan bisa diganti untuk cetakan ini saja.
 * `?cetak=1` langsung membuka dialog cetak setelah nota siap; `?ukuran=58mm` memilih kertas.
 */
function ReceiptPrint() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const [data, setData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState<{ message: string; login: boolean } | null>(null);
  const [paper, setPaper] = useState<Paper>("80mm");
  const [width, setWidth] = useState(76);
  const [height, setHeight] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const printed = useRef(false);

  useEffect(() => {
    api<ReceiptData>(`/operations/bookings/${id}/receipt`).then(result => {
      setData(result);
      const asked = search.get("ukuran") as Paper | null;
      setPaper(asked && papers.includes(asked) ? asked : result.settings.paper);
      setWidth(result.settings.custom_width);
    }).catch(problem => setError({ message: (problem as Error).message, login: problem instanceof ApiError && problem.status === 401 }));
  }, [id, search]);

  // Panjang kertas gulung mengikuti tinggi nota; diukur ulang bila font selesai dimuat atau isi berubah.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setHeight(toMm(node.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [data, paper, width]);

  useEffect(() => {
    if (!data || !height || printed.current || search.get("cetak") !== "1") return;
    printed.current = true;
    // Beri waktu satu bingkai agar aturan @page terbaru sudah terpasang sebelum dialog dibuka.
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [data, height, search]);

  if (error) return (
    <div className="receipt-screen"><div className="receipt-message" role="alert">
      <p>{error.message}</p>
      {error.login ? <Link className="receipt-btn" href="/login">Masuk ke panel admin</Link> : <Link className="receipt-btn" href="/admin/bookings">Kembali ke booking</Link>}
    </div></div>
  );
  if (!data) return <div className="receipt-screen"><p className="receipt-message" aria-busy="true">Menyiapkan nota…</p></div>;

  const settings = { ...data.settings, paper, custom_width: width };
  return (
    <div className="receipt-screen">
      <style>{pageCss(paper, width, height)}</style>
      <div className="receipt-tools no-print">
        <Link className="receipt-btn ghost" href="/admin/bookings"><ArrowLeft size={16} aria-hidden="true" /> Booking</Link>
        <div className="receipt-papers" role="radiogroup" aria-label="Ukuran kertas">
          {paperOptions.map(option => (
            <button key={option.value} type="button" role="radio" aria-checked={paper === option.value} className={paper === option.value ? "active" : ""} title={option.hint} onClick={() => setPaper(option.value)}>{option.label}</button>
          ))}
        </div>
        {paper === "custom" && <label className="receipt-width">Lebar <input type="number" min={40} max={216} value={width} onChange={event => setWidth(Math.min(216, Math.max(40, Number(event.target.value) || 40)))} /> mm</label>}
        <button type="button" className="receipt-btn primary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Cetak</button>
      </div>
      <p className="receipt-hint no-print">
        {isRoll(paper)
          ? "Di dialog cetak pilih printer thermal, atur Margin ke None dan Skala 100%. Panjang kertas mengikuti isi nota."
          : `Di dialog cetak pilih ukuran kertas ${paper.toUpperCase()}. Untuk menyimpan sebagai PDF, pilih tujuan "Simpan sebagai PDF".`}
      </p>
      <div className="receipt-stage">
        <Receipt ref={ref} data={{ ...data, settings }} />
      </div>
    </div>
  );
}

export default function ReceiptPrintPage() {
  return <Suspense fallback={<div className="receipt-screen"><p className="receipt-message">Menyiapkan nota…</p></div>}><ReceiptPrint /></Suspense>;
}
