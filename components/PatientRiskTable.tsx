"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RiskBadge } from "@/components/RiskBadge";
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
          <TableHead>Clinical risk</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {patients.map((p) => (
          <TableRow
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={cn(
              "cursor-pointer",
              selectedId === p.id && "bg-muted/60"
            )}
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
              <RiskBadge level={p.riskStatus} score={p.riskScore} />
            </TableCell>
            <TableCell>
              {p.hasCaregiverBurden && <RiskBadge level="CAREGIVER_BURDEN" />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
