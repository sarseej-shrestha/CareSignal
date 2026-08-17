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
export function PatientRiskTable({
  patients,
  selectedId,
  onSelect,
}: {
  patients: QueuePatient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col divide-y">
      {patients.map((p) => {
        const notification = consolidateNotification(p);
        const isDual = notification.tier === "DUAL_RED" || notification.tier === "DUAL_YELLOW";
        const isHospWatch = notification.tier === "HOSP_WATCH";

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              "flex flex-col gap-2 px-4 py-3 text-left transition hover:bg-muted/40",
              selectedId === p.id && "bg-muted/60"
            )}
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

              {/* The pairing: clinical status and caregiver status side by
                  side, in the SAME card — "Patient: RED — Caregiver: Burden
                  flagged" as one unit, whenever both apply. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <RiskBadge level={p.riskStatus} score={p.riskScore} />
                {p.hasCaregiverBurden && <RiskBadge level="CAREGIVER_BURDEN" />}
              </div>
            </div>

            {(isDual || isHospWatch) && (
              <span
                className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--viz-series-fever)]/35 bg-[var(--viz-series-fever)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--viz-series-fever)]"
                title="Daily clinical risk AND 7-day hospitalization risk are both elevated — shown as one notification, not two."
              >
                {isDual ? "+ " : ""}7-day risk {(p.hospitalizationRiskScore * 100).toFixed(0)}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
