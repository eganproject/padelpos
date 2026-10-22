import { api } from "./api";
import type { Floor, Venue, VenueFeature } from "./venue";

export const venueTimezone = "Asia/Jakarta";
export const slotMinutes = 30;

export type SlotState = "available" | "booked" | "maintenance" | "past";
export type CourtBox = { x: number; y: number; w: number; h: number };
export type ShopCourt = {
  id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string;
  description: string; environment: "" | "indoor" | "outdoor"; surface: string; photos: string[];
  /** Kisaran tarif per jam sepanjang minggu, termasuk tarif khusus. */
  rate_min: number; rate_max: number;
  floor_id: string | null;
  layout: CourtBox;
};
/** `rate` adalah tarif per jam slot ini; `rule` nama tarif khusus bila berlaku. */
export type ShopSlot = { start: string; end: string; state: SlotState; rate: number; rule: string | null; rule_id?: string | null;
  /** Nama jam khusus member bila slot ini hanya bisa dipesan member. */
  member_only?: string | null };
export type CourtAvailability = { court: ShopCourt; slots: ShopSlot[] };
export type Availability = { date: string; today: string; time: string; timezone: string; venue: Venue; floors: Floor[]; features: VenueFeature[]; courts: CourtAvailability[] };

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

const slotsFrom = (slots: ShopSlot[], start: string, duration: number) => {
  const from = slots.findIndex(s => s.start === start);
  return from < 0 ? [] : slots.slice(from, from + duration / slotMinutes);
};

/** Total sewa dari tarif tiap slot 30 menit, dihitung sama persis dengan server. */
export const priceFor = (slots: ShopSlot[], start: string, duration: number) =>
  Math.round(slotsFrom(slots, start, duration).reduce((sum, slot) => sum + slot.rate, 0) / 2);

/** Nama tarif khusus yang ikut terpakai pada rentang ini. */
export const rulesFor = (slots: ShopSlot[], start: string, duration: number) =>
  [...new Set(slotsFrom(slots, start, duration).map(slot => slot.rule).filter((rule): rule is string => !!rule))];

export const memberOnlyFor = (slots: ShopSlot[], start: string, duration: number) =>
  [...new Set(slotsFrom(slots, start, duration).map(slot => slot.member_only).filter((label): label is string => !!label))];
/** Slot berurutan mulai dari `start` sepanjang `duration` menit, semuanya harus tersedia. */
export function rangeIsFree(slots: ShopSlot[], start: string, duration: number) {
  const range = slotsFrom(slots, start, duration);
  return range.length === duration / slotMinutes && range.every(s => s.state === "available");
}

export const fetchAvailability = (date: string) => api<Availability>(`/public/availability?date=${encodeURIComponent(date)}`);
export const fetchVenue = () => api<{ venue: Venue; floors: Floor[]; features: VenueFeature[]; timezone: string; today: string; courts: ShopCourt[] }>("/public/venue");

/** Nama lantai lapangan, hanya bila venue punya lebih dari satu lantai. */
export const floorLabel = (floors: Floor[], floorId: string | null) =>
  floors.length > 1 ? floors.find(floor => floor.id === (floorId ?? floors[0].id))?.name : undefined;

export type { Floor, Venue, VenueFeature } from "./venue";
