import { AlertTriangle, Flame, HeartHandshake, Bus, HandHeart, CircleHelp, ShieldAlert } from "lucide-react";
import { AlertStatusControl } from "@/components/AlertStatusControl";
import { NEED_KIND_ACCENT, NEED_KIND_LABEL, type NeedKind, type UnifiedNeed } from "@/lib/needPresentation";
import { cn } from "@/lib/utils";

const ICON: Record<NeedKind, React.ComponentType<{ className?: string }>> = {
  SAFETY: ShieldAlert,
  RED: Flame,
  YELLOW: AlertTriangle,
  CAREGIVER_BURDEN: HeartHandshake,
  LOGISTICAL: Bus,
  EMOTIONAL: HandHeart,
  FINANCIAL: HeartHandshake,
  UNCERTAIN: CircleHelp,
};

// One consistent card for every kind of need CareSignal can surface, so a
// clinician learns ONE visual pattern instead of three (clinical risk box,
// caregiver-burden box, care-need box, each previously styled slightly
// differently). The reasons list is exactly what the backend already
// produces: risk-engine reasons for CLINICAL, coping-based reasons for
// CAREGIVER_BURDEN, or the quoted raw SMS plus a routing note for a care
// need (see lib/inbound.ts). This renders it consistently. Nothing new
// is inferred here.
export function NeedCard({ need }: { need: UnifiedNeed }) {
  const Icon = ICON[need.kind];
  const accent = NEED_KIND_ACCENT[need.kind];
  const isResolved = need.status === "RESOLVED";

  return (
    <div
      className={cn("rounded-lg border p-3 transition-opacity", isResolved && "opacity-60")}
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: accent }}>
          <Icon className="size-4 shrink-0" />
          {NEED_KIND_LABEL[need.kind]}
        </span>
        <AlertStatusControl alertId={need.id} status={need.status} />
      </div>

      <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
        {need.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
