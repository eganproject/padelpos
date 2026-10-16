import { Orbit } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark"><Orbit strokeWidth={2.2} aria-hidden="true" /></span>
      {!compact && <span className="brand-name">Padelix</span>}
    </div>
  );
}
