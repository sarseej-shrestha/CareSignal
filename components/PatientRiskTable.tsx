"use client";

import { RiskBadge } from "@/components/RiskBadge";
import { consolidateNotification } from "@/lib/alertConsolidation";
import { cn } from "@/lib/utils";

export interface QueuePatient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  parish: string;
  cancerType: string;
  chemoCycle: string;
  riskStatus: "GREEN" | "YELLOW" | "RED";
  riskScore: number;
  hospitalizationRiskScore: number;
  hasCaregiverBurden: boolean;
  hasOpenCareNeed: boolean;
}

// One unified card per patient — clinical status and caregiver-burden
// status are shown PAIRED, side by side, in the same row, not as two
// separate queue entries a nurse has to notice independently (this used
// to be a plain <Table>; caregiver burden lived in its own trailing
// column easy to miss, plus a wholly separate "Caregiver burden alerts"
// list above the queue for the same patients — see git history). The
// underlying scores are still completely separate (consolidateNotification
// / sortByConsolidatedPriority never factor caregiver burden into
// clinical priority ranking — that would be a real clinical-safety
// regression) — this is presentation only, pairing two independently
// computed signals visually, not blending them into one number.
function needsAttention(p: QueuePatient): boolean {
  return p.riskStatus === "RED" || p.riskStatus === "YELLOW" || p.hasCaregiverBurden || p.hasOpenCareNeed;
}

function Row({
  p,
  selectedId,
  onSelect,
}: {
  p: QueuePatient;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const notification = consolidateNotification(p);
  const isDual = notification.tier === "DUAL_RED" || notification.tier === "DUAL_YELLOW";
  const isHospWatch = notification.tier === "HOSP_WATCH";
  const isRed = p.riskStatus === "RED";

  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      className={cn(
        "flex flex-col gap-2 border-l-2 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        selectedId === p.id && "bg-accent/60"
      )}
      style={{
        borderLeftColor: isRed
          ? "var(--viz-status-critical)"
          : p.riskStatus === "YELLOW"
            ? "var(--viz-status-warning)"
            : "transparent",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <div className="font-medium">
            {p.firstName} {p.lastName}
          </div>
          <div className="text-xs text-muted-foreground">
            {p.parish} Parish · {p.cancerType} · {p.chemoCycle}
          </div>
        </div>

        {/* The pairing: clinical status and caregiver status side by side,
            in the SAME card. "Patient RED, caregiver burden flagged" reads
            as one unit whenever both apply. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <RiskBadge level={p.riskStatus} score={p.riskScore} />
          {p.hasCaregiverBurden && <RiskBadge level="CAREGIVER_BURDEN" />}
        </div>
      </div>

      {(isDual || isHospWatch || p.hasOpenCareNeed) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(isDual || isHospWatch) && (
            <span
              className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--viz-series-fever)]/35 bg-[var(--viz-series-fever)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--viz-series-fever)]"
              title="Daily clinical risk and 7-day hospitalization risk are both elevated, shown as one notification, not two."
            >
              {isDual ? "+ " : ""}7-day risk{" "}
              <span className="font-mono tabular-nums">{(p.hospitalizationRiskScore * 100).toFixed(0)}%</span>
            </span>
          )}
          {/* Non-clinical care need (logistical/emotional/financial/uncertain/
              safety), visible on the queue itself, not only after opening the
              patient, so a nurse scanning rows doesn't have to click into
              every card to find these. Category/why detail is in the panel. */}
          {p.hasOpenCareNeed && (
            <span
              className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--viz-caregiver-burden)]/35 bg-[var(--viz-caregiver-burden)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--viz-caregiver-burden)]"
              title="A non-clinical care need is open for this patient, see the patient panel for what kind and why."
            >
              + Care need
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// Grouped by urgency, not just sorted, so a nurse scanning the list sees a
// visible break between "needs a look" and "stable, nothing to do" instead
// of a uniform list where every row competes equally for attention.
// Ordering itself is untouched (sortByConsolidatedPriority upstream) — this
// only adds a visual section break at the point where urgency drops off.
export function PatientRiskTable({
  patients,
  selectedId,
  onSelect,
}: {
  patients: QueuePatient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const attention = patients.filter(needsAttention);
  const stable = patients.filter((p) => !needsAttention(p));

  return (
    <div className="flex flex-col">
      {attention.length > 0 && (
        <div className="flex flex-col divide-y">
          {attention.map((p) => (
            <Row key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
      {stable.length > 0 && (
        <div className="flex flex-col divide-y">
          {attention.length > 0 && (
            <div className="bg-muted/30 px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Stable · {stable.length}
            </div>
          )}
          {stable.map((p) => (
            <Row key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
