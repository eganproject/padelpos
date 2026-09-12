import { api } from "./api";
import { minute } from "./operations";

export const venueTimezone = "Asia/Jakarta";
export const slotMinutes = 30;

export type SlotState = "available" | "booked" | "maintenance" | "past";
export type CourtBox = { x: number; y: number; w: number; h: number };
export type Venue = { width: number; height: number; grid: number };
export type ShopCourt = { id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string; layout: CourtBox };
export type ShopSlot = { start: string; end: string; state: SlotState };
export type CourtAvailability = { court: ShopCourt; slots: ShopSlot[] };
export type Availability = { date: string; today: string; time: string; timezone: string; venue: Venue; courts: CourtAvailability[] };

/** Dipakai sebelum data server tiba, hanya untuk menebak tanggal awal. */
export function venueNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: venueTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}`, timezone: venueTimezone };
}

export function addDays(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatDay(date: string) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

export function formatShortDay(date: string) {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}

export const priceFor = (court: ShopCourt, start: string, end: string) => Math.round(court.hourly_rate * (minute(end) - minute(start)) / 60);

/** Slot berurutan mulai dari `start` sepanjang `duration` menit, semuanya harus tersedia. */
export function rangeIsFree(slots: ShopSlot[], start: string, duration: number) {
  const from = slots.findIndex(s => s.start === start);
  if (from < 0) return false;
  const count = duration / slotMinutes;
  if (from + count > slots.length) return false;
  return slots.slice(from, from + count).every(s => s.state === "available");
}

export const fetchAvailability = (date: string) => api<Availability>(`/public/availability?date=${encodeURIComponent(date)}`);
export const fetchVenue = () => api<{ venue: Venue; timezone: string; today: string; courts: ShopCourt[] }>("/public/venue");
