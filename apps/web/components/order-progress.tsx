import { Check } from "lucide-react";
import { formatShortDay } from "@/lib/shop";

/**
 * Posisi pesanan setelah dibayar: dipesan, lunas atau DP, lalu main. Pesanan yang batal atau
 * kedaluwarsa tidak memakainya karena kartu status di atasnya sudah menjelaskan semuanya.
 */
export function OrderProgress({ status, firstSession }: { status: string; firstSession?: { date: string; start_time: string } }) {
  if (status !== "confirmed" && status !== "completed") return null;
  const played = status === "completed";
  const steps = [
    { label: "Dipesan", done: true },
    { label: "Dibayar", done: true },
    { label: played ? "Selesai main" : firstSession ? `Main ${formatShortDay(firstSession.date)}` : "Main", done: played },
  ];
  const current = steps.findIndex(step => !step.done);
  return (
    <ol className="shop-steps order-progress" aria-label="Status pesanan">
      {steps.map((step, index) => (
        <li key={step.label} className={step.done ? "done" : index === current ? "now" : ""} aria-current={index === current ? "step" : undefined}>
          <span className="dot" aria-hidden="true">{step.done ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
          <span className="label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
