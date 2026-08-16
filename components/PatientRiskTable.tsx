"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>Parish</TableHead>
          <TableHead>Diagnosis / Cycle</TableHead>
          <TableHead>Consolidated notification</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {patients.map((p) => {
          const notification = consolidateNotification(p);
          const isDual = notification.tier === "DUAL_RED" || notification.tier === "DUAL_YELLOW";
          const isHospWatch = notification.tier === "HOSP_WATCH";

          return (
            <TableRow
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={cn("cursor-pointer", selectedId === p.id && "bg-muted/60")}
            >
              <TableCell className="font-medium">
                {p.firstName} {p.lastName}
              </TableCell>
              <TableCell className="text-muted-foreground">{p.parish} Parish</TableCell>
              <TableCell className="text-muted-foreground">
                {p.cancerType}
                <span className="block text-xs">{p.chemoCycle}</span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  {isHospWatch ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--viz-series-fever)]/35 bg-[var(--viz-series-fever)]/10 px-2.5 py-1 text-xs font-medium text-[var(--viz-series-fever)]">
                      7-day risk {(p.hospitalizationRiskScore * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <RiskBadge level={p.riskStatus} score={p.riskScore} />
                  )}
                  {isDual && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--viz-series-fever)]/35 bg-[var(--viz-series-fever)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--viz-series-fever)]"
                      title="Daily clinical risk AND 7-day hospitalization risk are both elevated — shown as one notification, not two."
                    >
                      + 7-day risk {(p.hospitalizationRiskScore * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>{p.hasCaregiverBurden && <RiskBadge level="CAREGIVER_BURDEN" />}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
