import { minute, timeSlots } from "./operations";

export const venueTimezone = "Asia/Jakarta";
export const slotMinutes = 30;

export type SlotState = "available" | "booked" | "maintenance" | "past";
export type ShopCourt = { id: string; name: string; hourly_rate: number; opens_at: string; closes_at: string };
export type ShopSlot = { start: string; end: string; state: SlotState };
export type CourtAvailability = { court: ShopCourt; slots: ShopSlot[] };
export type Availability = { date: string; today: string; time: string; timezone: string; courts: CourtAvailability[] };

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

// --- Sumber data sementara -------------------------------------------------
// Tahap 2a memakai contoh lokal yang mencerminkan hasil `npm run seed -w apps/api`.
// Tahap 2b mengganti isi fetchAvailability() dengan panggilan ke /api/public/availability.
// Bentuk kembaliannya sengaja dibuat final agar tampilan tidak perlu berubah.

const fixtureCourts: ShopCourt[] = [
  { id: "center-court", name: "Center Court", hourly_rate: 350000, opens_at: "06:00", closes_at: "23:00" },
  { id: "court-2", name: "Court 2", hourly_rate: 300000, opens_at: "06:00", closes_at: "23:00" },
  { id: "court-3", name: "Court 3 (Outdoor)", hourly_rate: 250000, opens_at: "07:00", closes_at: "21:00" },
];

type Block = { court: string; offset: number; start: string; end: string; kind: "booked" | "maintenance" };
const fixtureBlocks: Block[] = [
  { court: "center-court", offset: 0, start: "18:00", end: "19:30", kind: "booked" },
  { court: "court-2", offset: 0, start: "19:00", end: "20:00", kind: "booked" },
  { court: "center-court", offset: 1, start: "07:00", end: "08:30", kind: "booked" },
  { court: "court-3", offset: 1, start: "16:00", end: "18:00", kind: "booked" },
  { court: "court-3", offset: 1, start: "09:00", end: "11:00", kind: "maintenance" },
  { court: "court-2", offset: 2, start: "20:00", end: "21:00", kind: "booked" },
];

export async function fetchAvailability(date: string): Promise<Availability> {
  const now = venueNow();
  const courts = fixtureCourts.map(court => {
    const starts = timeSlots(minute(court.opens_at), minute(court.closes_at) - slotMinutes);
    const slots: ShopSlot[] = starts.map(start => {
      const end = timeSlots(minute(start) + slotMinutes, minute(start) + slotMinutes)[0];
      const blocked = fixtureBlocks.find(block => block.court === court.id && addDays(now.date, block.offset) === date && block.start <= start && block.end > start);
      const past = date < now.date || (date === now.date && start < now.time);
      return { start, end, state: blocked ? blocked.kind : past ? "past" : "available" };
    });
    return { court, slots };
  });
  return { date, today: now.date, time: now.time, timezone: now.timezone, courts };
}

export async function fetchCourts(): Promise<ShopCourt[]> {
  return fixtureCourts;
}
