"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { photoUrl } from "@/lib/venue-info";

/**
 * Sampul foto lapangan. Ketuk untuk membuka galeri layar penuh.
 * Tanpa foto, sampulnya digambar sebagai lapangan bergaris sehingga kartu tetap
 * punya gambar dan tingginya tidak berubah begitu foto ditambahkan admin.
 */
export function CourtCover({ name, photos, className = "", priority = false }: {
  name: string; photos: string[]; className?: string; priority?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!photos.length) return <div className={`court-cover empty ${className}`.trim()} aria-hidden="true"><span className="court-cover-lines" /></div>;
  return (
    <>
      <button type="button" className={`court-cover ${className}`.trim()} onClick={() => setOpen(true)} aria-label={`Lihat ${photos.length} foto ${name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- foto berasal dari API sendiri dan sudah diperkecil saat diunggah */}
        <img src={photoUrl(photos[0])} alt="" loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"} />
        {photos.length > 1 && <span className="court-cover-count"><Images size={14} aria-hidden="true" /> {photos.length}</span>}
      </button>
      {open && <PhotoLightbox name={name} photos={photos} close={close} />}
    </>
  );
}

export function PhotoLightbox({ name, photos, close, start = 0 }: { name: string; photos: string[]; close: () => void; start?: number }) {
  const [index, setIndex] = useState(start);
  const dialog = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const step = useCallback((delta: number) => setIndex(value => (value + delta + photos.length) % photos.length), [photos.length]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [close, step]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Foto ${name}`} ref={dialog} tabIndex={-1}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="lightbox-bar">
        <span><b>{name}</b> · {index + 1} dari {photos.length}</span>
        <button type="button" onClick={close} aria-label="Tutup galeri"><X size={20} aria-hidden="true" /></button>
      </div>
      <figure className="lightbox-stage"
        onClick={event => { if (event.target === event.currentTarget) close(); }}
        onTouchStart={event => { touch.current = event.touches[0].clientX; }}
        onTouchEnd={event => {
          if (touch.current === null) return;
          const moved = event.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(moved) > 40) step(moved < 0 ? 1 : -1);
        }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(photos[index])} alt={`${name}, foto ${index + 1} dari ${photos.length}`} />
      </figure>
      {photos.length > 1 && (
        <>
          <button type="button" className="lightbox-nav prev" onClick={() => step(-1)} aria-label="Foto sebelumnya"><ChevronLeft size={26} aria-hidden="true" /></button>
          <button type="button" className="lightbox-nav next" onClick={() => step(1)} aria-label="Foto berikutnya"><ChevronRight size={26} aria-hidden="true" /></button>
          <div className="lightbox-thumbs">
            {photos.map((id, position) => (
              <button type="button" key={id} aria-current={position === index} onClick={() => setIndex(position)} aria-label={`Foto ${position + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(id)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
