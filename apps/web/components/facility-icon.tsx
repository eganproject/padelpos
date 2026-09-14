import type { ComponentType } from "react";
import { Armchair, Car, CircleDot, Coffee, GraduationCap, HeartPulse, Lock, Moon, ShowerHead, Toilet, Volleyball, Wifi, type LucideProps } from "lucide-react";
import type { FacilityKind } from "@/lib/venue-info";

const icons: Record<FacilityKind, ComponentType<LucideProps>> = {
  parkir: Car, toilet: Toilet, "kamar-bilas": ShowerHead, musala: Moon, kantin: Coffee, "ruang-tunggu": Armchair,
  wifi: Wifi, loker: Lock, "sewa-raket": Volleyball, "sewa-bola": CircleDot, pelatih: GraduationCap, p3k: HeartPulse,
};

export function FacilityIcon({ kind, size = 18 }: { kind: FacilityKind; size?: number }) {
  const Icon = icons[kind];
  return <Icon size={size} aria-hidden="true" />;
}
