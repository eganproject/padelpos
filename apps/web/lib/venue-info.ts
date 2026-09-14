import type { ShopCourt } from "./shop";
import type { AddonOption } from "./addons";

/** Sama dengan daftar di API (apps/api/src/content.ts). */
export const facilityKinds = ["parkir", "toilet", "kamar-bilas", "musala", "kantin", "ruang-tunggu", "wifi", "loker", "sewa-raket", "sewa-bola", "pelatih", "p3k"] as const;
export type FacilityKind = typeof facilityKinds[number];
export const facilityLabels: Record<FacilityKind, string> = {
  parkir: "Parkir", toilet: "Toilet", "kamar-bilas": "Kamar bilas", musala: "Musala", kantin: "Kantin",
  "ruang-tunggu": "Ruang tunggu", wifi: "Wi-Fi", loker: "Loker", "sewa-raket": "Sewa raket",
  "sewa-bola": "Sewa bola", pelatih: "Pelatih", p3k: "P3K",
};

export type VenueInfo = {
  name: string; tagline: string; about: string; address: string; maps_url: string; show_map: boolean;
  whatsapp: string; phone: string; email: string; instagram: string; hours_note: string;
  facilities: FacilityKind[]; extra_facilities: string[]; updated_at: string | null;
};
export type RefundTier = { hours: number; percent: number };
export type Reschedule = "unset" | "no" | "yes";
export type Policies = {
  refund_tiers: RefundTier[]; refund_days: number; reschedule: Reschedule; reschedule_hours: number;
  cancellation_note: string; terms: string; updated_at: string | null;
};
export type Faq = { id: string; question: string; answer: string };
export type PublicInfo = { info: VenueInfo; policies: Policies; faqs: Faq[]; courts: ShopCourt[]; addons: AddonOption[] };

export const environmentLabel: Record<"indoor" | "outdoor", string> = { indoor: "Indoor", outdoor: "Outdoor" };
export const photoUrl = (id: string) => `/api/public/photos/${encodeURIComponent(id)}`;

export const hoursLabel = (hours: number) => (hours >= 48 && hours % 24 === 0 ? `${hours / 24} hari` : `${hours} jam`);

/** Kebijakan pembatalan dalam kalimat untuk pelanggan, urut dari batas waktu terjauh. */
export function refundLines(policies: Pick<Policies, "refund_tiers">) {
  const tiers = [...policies.refund_tiers].sort((a, b) => b.hours - a.hours);
  const lines = tiers.map((tier, index) => {
    const upper = tiers[index - 1];
    const when = tier.hours === 0
      ? upper ? `Batal kurang dari ${hoursLabel(upper.hours)} sebelum jam main` : "Batal kapan pun sebelum jam main"
      : upper ? `Batal ${hoursLabel(tier.hours)} hingga kurang dari ${hoursLabel(upper.hours)} sebelum jam main` : `Batal paling lambat ${hoursLabel(tier.hours)} sebelum jam main`;
    return { when, result: tier.percent === 100 ? "Dana kembali penuh" : `Dana kembali ${tier.percent}%`, percent: tier.percent };
  });
  const last = tiers[tiers.length - 1];
  if (last && last.hours > 0) lines.push({ when: `Batal kurang dari ${hoursLabel(last.hours)} sebelum jam main, atau tidak datang`, result: "Dana tidak dikembalikan", percent: 0 });
  return lines;
}

export function rescheduleLine(policies: Pick<Policies, "reschedule" | "reschedule_hours">) {
  if (policies.reschedule === "no") return "Jadwal yang sudah dipesan tidak dapat diubah.";
  if (policies.reschedule === "yes") return policies.reschedule_hours > 0
    ? `Ubah jadwal dapat diajukan paling lambat ${hoursLabel(policies.reschedule_hours)} sebelum jam main, selama slot pengganti tersedia.`
    : "Ubah jadwal dapat diajukan sebelum jam main, selama slot pengganti tersedia.";
  return null;
}

export const refundDaysLine = (policies: Pick<Policies, "refund_days">) =>
  policies.refund_days > 0 ? `Pengembalian dana diproses paling lama ${policies.refund_days} hari kerja.` : null;

export const hasCancellationPolicy = (policies: Policies) =>
  policies.refund_tiers.length > 0 || policies.reschedule !== "unset" || policies.cancellation_note !== "";
export const hasPolicies = (policies: Policies) => hasCancellationPolicy(policies) || policies.terms !== "";

/** Satu kalimat pendek untuk ringkasan pesanan, atau null bila venue belum mengatur kebijakan. */
export function policySummary(policies: Pick<Policies, "refund_tiers">) {
  const first = [...policies.refund_tiers].sort((a, b) => b.hours - a.hours)[0];
  if (!first) return null;
  const limit = first.hours === 0 ? "sebelum jam main" : `hingga ${hoursLabel(first.hours)} sebelum main`;
  return first.percent === 100 ? `Batal gratis ${limit}` : `Batal ${limit}, dana kembali ${first.percent}%`;
}

export const whatsappLink = (number: string, text?: string) => `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
/** 6281234567890 menjadi 0812 3456 7890. */
export function formatWhatsapp(number: string) {
  const local = number.startsWith("62") ? "0" + number.slice(2) : number;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1 $2 $3");
}
export const mapsLink = (info: Pick<VenueInfo, "maps_url" | "address">) =>
  info.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}`;
export const mapsEmbed = (address: string) => `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=16&output=embed`;

export type TextBlock = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };
/**
 * Teks bebas dari admin menjadi paragraf dan daftar, tanpa HTML atau markdown.
 * Baris kosong memisahkan paragraf; baris berawalan "- " atau "1. " menjadi daftar.
 */
export function textBlocks(value: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;
  for (const raw of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { current = null; continue; }
    const bullet = /^[-•*]\s+(.+)$/.exec(line), numbered = /^\d{1,2}[.)]\s+(.+)$/.exec(line);
    const kind = bullet ? "ul" : numbered ? "ol" : "p";
    const item = bullet?.[1] ?? numbered?.[1] ?? line;
    if (current && current.kind === kind) {
      if (current.kind === "p") current.text += "\n" + line; else current.items.push(item);
    } else {
      current = kind === "p" ? { kind, text: line } : { kind, items: [item] };
      blocks.push(current);
    }
  }
  return blocks;
}

export const formatUpdated = (value: string | null) =>
  value ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date(value)) : "";
