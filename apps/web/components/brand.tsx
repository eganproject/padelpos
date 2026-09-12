import { Orbit } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark"><Orbit size={compact ? 20 : 24} strokeWidth={2.4} /></span>
      <span className="brand-name">PADEL<span>IX</span></span>
    </div>
  );
}
