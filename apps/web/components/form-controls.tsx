"use client";

import flatpickr from "flatpickr";
import { Indonesian } from "flatpickr/dist/l10n/id.js";
import type { Instance } from "flatpickr/dist/types/instance";
import { CalendarDays, Clock3 } from "lucide-react";
import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { NumericFormat } from "react-number-format";
import ReactSelect, { type SingleValue } from "react-select";

/*
 * Kontrol isian bersama untuk pilihan, tanggal/jam, dan nominal rupiah.
 *
 * Ketiganya memanggil onChange dengan objek berbentuk { target: { value } } seperti elemen
 * bawaan, jadi penangan lama `e => set(e.target.value)` tetap berlaku. Nilai yang dikirim
 * selalu sama dengan isian bawaan: kode opsi untuk pilihan, YYYY-MM-DD atau HH:MM untuk
 * tanggal/jam, dan angka tanpa titik ribuan untuk nominal.
 */
export type ValueEvent = { target: { value: string } };
const emit = (value: string): ValueEvent => ({ target: { value } });

/* --- Pilihan --------------------------------------------------------------- */

type Option = { value: string; label: string; isDisabled: boolean };
type Group = { label: string; options: Option[] };

const textOf = (node: ReactNode): string =>
  Children.toArray(node).map(child => typeof child === "string" || typeof child === "number" ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : "").join("");

/** Membaca <option> dan <optgroup> dari children, termasuk yang dibungkus fragmen atau hasil map. */
function optionsFrom(children: ReactNode, out: (Option | Group)[] = []): (Option | Group)[] {
  Children.forEach(children, child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>(child)) return;
    if (child.type === Fragment) optionsFrom(child.props.children, out);
    else if (child.type === "optgroup") out.push({ label: child.props.label ?? "", options: optionsFrom(child.props.children).filter((item): item is Option => !("options" in item)) });
    else if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({ value: child.props.value === undefined ? label : String(child.props.value), label, isDisabled: Boolean(child.props.disabled) });
    }
  });
  return out;
}

type SelectProps = {
  value: string | number;
  onChange: (event: ValueEvent) => void;
  children: ReactNode;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  name?: string;
  id?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  "aria-label"?: string;
};

/**
 * Pengganti <select> berbasis react-select: daftar mengambang yang rapi di tema terang/gelap,
 * bisa diketik untuk mencari bila pilihannya banyak, dan dikendalikan papan ketik.
 * Opsi bernilai kosong pada isian wajib menjadi teks petunjuk, sehingga formulir tetap
 * menolak dikirim sebelum ada yang dipilih.
 */
export function Select({ value, onChange, children, required, disabled, className, name, id, autoFocus, onFocus, "aria-label": ariaLabel }: SelectProps) {
  const instanceId = useId();
  const all = useMemo(() => optionsFrom(children), [children]);
  const flat = all.flatMap(item => "options" in item ? item.options : [item]);
  const placeholderOption = required ? all.find((item): item is Option => !("options" in item) && item.value === "") : undefined;
  const options = placeholderOption ? all.filter(item => item !== placeholderOption) : all;
  const selected = flat.find(option => option !== placeholderOption && option.value === String(value)) ?? null;
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const listClass = `rs-list-${instanceId.replace(/[^\w-]/g, "")}`;
  useEffect(() => setPortal(document.body), []);
  /* Saat daftar dibuka, gulir ke opsi terpilih (mis. jam 13:00 di antara puluhan slot). */
  useEffect(() => {
    if (!menuOpen) return;
    const frame = requestAnimationFrame(() => {
      const list = document.querySelector<HTMLElement>(`.${listClass}`);
      const option = list?.querySelector<HTMLElement>(".rs__option--is-selected");
      if (list && option) list.scrollTop = option.offsetTop - list.clientHeight / 2 + option.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [menuOpen, listClass]);
  return (
    <ReactSelect<Option, false, Group>
      instanceId={instanceId}
      inputId={id}
      name={name}
      aria-label={ariaLabel}
      unstyled
      className={`rs${className ? ` ${className}` : ""}`}
      classNamePrefix="rs"
      options={options}
      value={selected}
      onChange={(option: SingleValue<Option>) => option && onChange(emit(option.value))}
      onFocus={onFocus}
      onMenuOpen={() => setMenuOpen(true)}
      onMenuClose={() => setMenuOpen(false)}
      /* Esc saat daftar terbuka cukup menutup daftar, bukan dialog di belakangnya. */
      onKeyDown={event => { if (event.key === "Escape" && menuOpen) event.nativeEvent.stopImmediatePropagation(); }}
      isDisabled={disabled}
      required={required}
      autoFocus={autoFocus}
      isSearchable={flat.length > 8}
      placeholder={placeholderOption?.label || "Pilih…"}
      noOptionsMessage={() => "Tidak ada pilihan"}
      menuPortalTarget={portal}
      menuPosition="fixed"
      menuPlacement="auto"
      menuShouldBlockScroll={false}
      maxMenuHeight={280}
      classNames={{ menuPortal: () => "rs-portal", menuList: () => listClass }}
    />
  );
}

/* --- Tanggal dan jam ------------------------------------------------------- */

/** YYYY-MM-DD atau HH:MM menjadi Date lokal; flatpickr sendiri membaca teks memakai format tampilan. */
function toDate(text: string | undefined, time: boolean): Date | undefined {
  if (!text) return undefined;
  if (time) {
    const [hours, minutes] = text.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return undefined;
    const date = new Date(); date.setHours(hours, minutes, 0, 0); return date;
  }
  const [year, month, day] = text.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : undefined;
}

type DateProps = {
  value: string;
  onChange: (event: ValueEvent) => void;
  type?: "date" | "time";
  min?: string;
  max?: string;
  /** Lompatan menit untuk jam, dalam detik seperti atribut step bawaan. */
  step?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Tema kalender: panel staf (bawaan) atau situs pelanggan. */
  theme?: "desk" | "shop";
  /** Tanpa ikon dan bingkai: isian tak terlihat di atas tombol lain, seperti chip tanggal. */
  bare?: boolean;
  "aria-label"?: string;
};

/**
 * Pemilih tanggal atau jam berbasis flatpickr, berbahasa Indonesia, minggu dimulai Senin.
 * Tanggal tampil sebagai "16 Okt 2026" tetapi nilainya tetap YYYY-MM-DD.
 */
export function DateInput({ value, onChange, type = "date", min, max, step, required, disabled, placeholder, className, theme = "desk", bare, "aria-label": ariaLabel }: DateProps) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<Instance | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const time = type === "time";

  useEffect(() => {
    if (!input.current) return;
    const instance = flatpickr(input.current, {
      locale: { ...Indonesian, firstDayOfWeek: 1 },
      dateFormat: time ? "H:i" : "j M Y",
      enableTime: time,
      noCalendar: time,
      time_24hr: true,
      minuteIncrement: step ? Math.max(1, Math.round(step / 60)) : 5,
      disableMobile: true,
      monthSelectorType: "static",
      defaultDate: toDate(value, time),
      minDate: time ? undefined : toDate(min, false),
      maxDate: time ? undefined : toDate(max, false),
      onChange: (dates, _text, self) => change.current(emit(dates[0] ? self.formatDate(dates[0], time ? "H:i" : "Y-m-d") : "")),
      onReady: (_dates, _text, self) => self.calendarContainer.classList.add(`dp-${theme}`),
    });
    picker.current = instance;
    return () => { instance.destroy(); picker.current = null; };
    // Kalender hanya dibuat ulang bila jenisnya berubah; nilai dan batas disinkronkan di bawah.
  }, [time, step, theme]);

  useEffect(() => {
    const instance = picker.current;
    if (!instance || time) return;
    instance.set("minDate", toDate(min, false));
    instance.set("maxDate", toDate(max, false));
  }, [min, max, time]);

  useEffect(() => {
    const instance = picker.current;
    if (!instance) return;
    const current = instance.selectedDates[0] ? instance.formatDate(instance.selectedDates[0], time ? "H:i" : "Y-m-d") : "";
    if (current !== value) instance.setDate(toDate(value, time) ?? [], false);
  }, [value, time]);

  const Icon = time ? Clock3 : CalendarDays;
  /* Esc saat kalender terbuka cukup menutup kalender, bukan dialog di belakangnya. */
  const closeOnEscape = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && picker.current?.isOpen) { event.nativeEvent.stopImmediatePropagation(); picker.current.close(); }
  };
  const field = <input ref={input} className="dp-input" onKeyDownCapture={closeOnEscape} disabled={disabled} placeholder={placeholder ?? (time ? "--:--" : "Pilih tanggal")} aria-label={ariaLabel} />;
  /* flatpickr membuat isian hanya-baca, yang dilewati validasi formulir. Isian tersembunyi ini
     membawa atribut required supaya browser tetap menahan formulir yang tanggalnya kosong. */
  const guard = required && <input className="dp-guard" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} onFocus={() => picker.current?.open()} />;
  if (bare) return <>{field}{guard}</>;
  return (
    <span className={`dp-field${disabled ? " disabled" : ""}${className ? ` ${className}` : ""}`}>
      {field}
      <Icon className="dp-icon" aria-hidden="true" />
      {guard}
    </span>
  );
}

/* --- Nominal rupiah -------------------------------------------------------- */

type MoneyProps = {
  value: number | string;
  onChange: (event: ValueEvent) => void;
  min?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  "aria-label"?: string;
};

/**
 * Isian rupiah berbasis react-number-format: titik ribuan muncul saat mengetik, awalan "Rp"
 * tetap di kiri. Batas min/max dan required dicek lewat validasi bawaan browser.
 */
export function MoneyInput({ value, onChange, min, max, required, disabled, placeholder = "0", autoFocus, className, onKeyDown, "aria-label": ariaLabel }: MoneyProps) {
  const input = useRef<HTMLInputElement>(null);
  const amount = value === "" || value === null || value === undefined ? undefined : Number(value);
  const shown = amount === undefined || Number.isNaN(amount) ? "" : amount;

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    let message = "";
    if (shown === "") { if (required) message = "Isi nominal terlebih dahulu."; }
    else if (min !== undefined && shown < min) message = `Nominal minimal Rp${min.toLocaleString("id-ID")}.`;
    else if (max !== undefined && shown > max) message = `Nominal maksimal Rp${max.toLocaleString("id-ID")}.`;
    element.setCustomValidity(message);
  }, [shown, min, max, required]);

  return (
    <span className={`money-field${disabled ? " disabled" : ""}${className ? ` ${className}` : ""}`}>
      <span className="money-prefix" aria-hidden="true">Rp</span>
      <NumericFormat
        getInputRef={input}
        value={shown}
        thousandSeparator="."
        decimalSeparator=","
        decimalScale={0}
        allowNegative={false}
        allowLeadingZeros={false}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onFocus={event => event.currentTarget.select()}
        isAllowed={({ floatValue }) => floatValue === undefined || floatValue <= 999_999_999_999}
        onValueChange={(values, source) => { if (source.source === "event") onChange(emit(values.floatValue === undefined ? "" : String(values.floatValue))); }}
      />
    </span>
  );
}
