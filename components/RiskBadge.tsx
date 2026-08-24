import { AlertTriangle, CircleCheck, Flame, HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";

export type BadgeLevel = "GREEN" | "YELLOW" | "RED" | "CAREGIVER_BURDEN";

const CONFIG: Record<
  BadgeLevel,
  { label: string; icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  GREEN: {
    label: "Stable",
    icon: CircleCheck,
    className: "bg-[var(--viz-status-good)]/12 text-[var(--viz-status-good)] border-[var(--viz-status-good)]/30",
  },
  YELLOW: {
    label: "Elevated risk",
    icon: AlertTriangle,
    className: "bg-[var(--viz-status-warning)]/15 text-[#8a5a00] dark:text-[var(--viz-status-warning)] border-[var(--viz-status-warning)]/40",
  },
  RED: {
    label: "High risk",
    icon: Flame,
    className: "bg-[var(--viz-status-critical)]/12 text-[var(--viz-status-critical)] border-[var(--viz-status-critical)]/35",
  },
  CAREGIVER_BURDEN: {
    label: "Caregiver burden",
    icon: HeartHandshake,
    className: "bg-[var(--viz-caregiver-burden)]/12 text-[var(--viz-caregiver-burden)] border-[var(--viz-caregiver-burden)]/35",
  },
};

export function RiskBadge({ level, score }: { level: BadgeLevel; score?: number }) {
  const { label, icon: Icon, className } = CONFIG[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        className
      )}
    >
      <Icon className="size-3.5" />
      {label}
      {typeof score === "number" && level !== "CAREGIVER_BURDEN" && (
        <span className="font-mono tabular-nums opacity-80">p={score.toFixed(2)}</span>
      )}
    </span>
  );
}
