import { Bus, CircleHelp, HandHeart, HeartHandshake, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

// A care-need category is deliberately NOT rendered with RiskBadge — it is
// not a clinical severity level, and visually conflating "LOGISTICAL" with
// "RED" would misrepresent what this is. Same spirit as RiskBadge's own
// separation from HospitalizationRiskPanel: a different kind of signal
// gets a different, unambiguous visual language. SAFETY reuses the
// critical-red color intentionally (it IS the most urgent category, from
// lib/safetyGate.ts's deterministic gate) but keeps its own label so it's
// never confused with a clinical RED risk score.
const CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  LOGISTICAL: {
    label: "Logistical need",
    icon: Bus,
    className: "bg-[var(--viz-series-fatigue)]/12 text-[var(--viz-series-fatigue)] border-[var(--viz-series-fatigue)]/35",
  },
  EMOTIONAL: {
    label: "Emotional support",
    icon: HandHeart,
    className: "bg-[var(--viz-caregiver-burden)]/12 text-[var(--viz-caregiver-burden)] border-[var(--viz-caregiver-burden)]/35",
  },
  FINANCIAL: {
    label: "Financial need",
    icon: HeartHandshake,
    className: "bg-[var(--viz-series-nausea)]/12 text-[var(--viz-series-nausea)] border-[var(--viz-series-nausea)]/35",
  },
  UNCERTAIN: {
    label: "Needs clarification",
    icon: CircleHelp,
    className: "bg-muted text-muted-foreground border-border",
  },
  SAFETY: {
    label: "Safety check needed",
    icon: ShieldAlert,
    className: "bg-[var(--viz-status-critical)]/12 text-[var(--viz-status-critical)] border-[var(--viz-status-critical)]/35",
  },
};

export function CareNeedBadge({ category }: { category: string }) {
  const config = CONFIG[category] ?? CONFIG.UNCERTAIN;
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        config.className
      )}
    >
      <Icon className="size-3.5" />
      {config.label}
    </span>
  );
}
