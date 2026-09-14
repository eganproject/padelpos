/**
 * Elemen penjelas pada denah venue: jalan, pintu masuk, kantin, tangga, dan sejenisnya.
 * Hanya informasi — tidak dapat dipesan dan tidak memengaruhi jadwal.
 * Satuan sama dengan lapangan: 1 unit = 0,1 meter.
 */
export const featureKinds = ["jalan", "pintu-masuk", "kantin", "tempat-duduk", "toilet", "parkir", "resepsionis", "loker", "tangga", "lift", "lainnya"] as const;
export type FeatureKind = typeof featureKinds[number];
export type VenueFeature = { id: string; kind: FeatureKind; label: string; x: number; y: number; w: number; h: number; floor_id?: string | null };
/** Ukuran venue lama (satu lantai). Untuk venue bertingkat, ukuran denah ada di setiap lantai. */
export type Venue = { width: number; height: number; grid: number };
export type Floor = { id: string; name: string; width: number; height: number };

export const featureInfo: Record<FeatureKind, { label: string; size: [number, number] }> = {
  "jalan": { label: "Jalan / akses", size: [400, 30] },
  "pintu-masuk": { label: "Pintu masuk", size: [60, 30] },
  "kantin": { label: "Kantin", size: [120, 80] },
  "tempat-duduk": { label: "Tempat duduk", size: [90, 50] },
  "toilet": { label: "Toilet", size: [50, 40] },
  "parkir": { label: "Parkir", size: [200, 100] },
  "resepsionis": { label: "Resepsionis", size: [70, 40] },
  "loker": { label: "Loker", size: [60, 30] },
  "tangga": { label: "Tangga", size: [40, 60] },
  "lift": { label: "Lift", size: [30, 30] },
  "lainnya": { label: "Lainnya", size: [80, 60] },
};

export const featureName = (feature: Pick<VenueFeature, "kind" | "label">) => feature.label || featureInfo[feature.kind].label;
