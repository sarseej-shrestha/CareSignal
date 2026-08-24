"use client";

import { useMemo, useState } from "react";
import { Activity, HeartHandshake, MapPin, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PatientRiskTable, type QueuePatient } from "@/components/PatientRiskTable";
import { SymptomTrendChart, type TrendPoint } from "@/components/SymptomTrendChart";
import { RiskBadge } from "@/components/RiskBadge";
import { SourceBadge, type LogSource } from "@/components/SourceBadge";
import { DemoControls } from "@/components/DemoControls";
import { LimitationsPanel } from "@/components/LimitationsPanel";
import { HospitalizationRiskPanel } from "@/components/HospitalizationRiskPanel";
import { SdohActionCard } from "@/components/SdohActionCard";
import type { TreatmentFrequency } from "@/lib/transportationResources";
import { SoapNoteGenerator } from "@/components/SoapNoteGenerator";
import { FhirExportButton } from "@/components/FhirExportButton";
import { sortByConsolidatedPriority } from "@/lib/alertConsolidation";

interface CaregiverLogView {
  id: string;
  dateLabel: string;
  patientStatus: number;
  copingScore: number;
  rawSmsText: string | null;
}

export interface DashboardPatient extends QueuePatient {
  treatmentFrequency: TreatmentFrequency;
  reasons: string[];
  logs: TrendPoint[];
  rawLogs: {
    id: string;
    dateLabel: string;
    pain: number;
    nausea: number;
    fatigue: number;
    fever: number;
    source: LogSource;
    parsedByAi: boolean;
    rawSmsText: string | null;
  }[];
  caregiver: {
    firstName: string;
    lastName: string;
    relationship: string;
    logs: CaregiverLogView[];
  } | null;
  caregiverBurdenReasons: string[] | null;
  // hospitalizationRiskScore is inherited from QueuePatient — separate
  // model, separate time horizon (7-day forecast, not today's status),
  // never merged into riskStatus/riskScore.
  hospitalizationRiskFactors: string[];
  hospitalizationHasRecentHistory: boolean;
}

export function DashboardClient({
  patients,
  demoModeEnabled,
}: {
  patients: DashboardPatient[];
  demoModeEnabled: boolean;
}) {
  const sortedQueue = useMemo(() => sortByConsolidatedPriority(patients), [patients]);

  const [selectedId, setSelectedId] = useState<string | null>(sortedQueue[0]?.id ?? null);
  const selected = patients.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="size-4.5" aria-hidden="true" />
          </span>
          <h1 className="text-[1.6rem] font-semibold tracking-tight">CareSignal</h1>
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Nurse triage dashboard
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5" />
          SMS-first symptom monitoring for rural Louisiana cancer care — Terrebonne &amp; Lafourche Parish
        </p>
      </header>

      <LimitationsPanel />

      {demoModeEnabled && <DemoControls />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Priority queue</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each card pairs a patient&apos;s clinical status with their caregiver&apos;s status, when flagged — one
            unified view, not two separate lists to cross-reference. The underlying scores stay completely separate
            (see <code className="text-[11px]">docs/model-calibration.md</code>); this only changes how they&apos;re
            shown together. A &quot;+ 7-day risk&quot; tag means the hospitalization forecast is also elevated.
            Click a card to see the full trend.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <PatientRiskTable patients={sortedQueue} selectedId={selectedId} onSelect={setSelectedId} />
        </CardContent>
      </Card>

      {selected && (
        <Card
          className="border-l-4"
          style={{
            borderLeftColor: `var(--viz-status-${
              selected.riskStatus === "GREEN" ? "good" : selected.riskStatus === "YELLOW" ? "warning" : "critical"
            })`,
          }}
        >
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                {selected.firstName} {selected.lastName}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {selected.cancerType} · {selected.chemoCycle} · {selected.parish} Parish
              </p>
            </div>
            <div className="flex items-center gap-2">
              <RiskBadge level={selected.riskStatus} score={selected.riskScore} />
              {selected.caregiverBurdenReasons && <RiskBadge level="CAREGIVER_BURDEN" />}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* The two "why" boxes, paired side by side — the same unified
                pairing as the queue card above, carried into the detail
                view. Clinical risk is rules-based and the most defensible
                number this app produces, so it's visually primary (first,
                same tier as caregiver burden — never blended into one
                box or one score, just shown together). */}
            {(selected.reasons.length > 0 || selected.caregiverBurdenReasons) && (
              <div className="flex flex-col gap-3 sm:flex-row">
                {selected.reasons.length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-3 sm:flex-1">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">Why this risk level</div>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {selected.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.caregiverBurdenReasons && (
                  <div className="rounded-lg border border-[var(--viz-caregiver-burden)]/30 bg-[var(--viz-caregiver-burden)]/5 p-3 sm:flex-1">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--viz-caregiver-burden)]">
                      <HeartHandshake className="size-3.5" />
                      Why caregiver burden is flagged
                    </div>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {selected.caregiverBurdenReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* No risk-level gate here on purpose — transportation burden comes
                from how OFTEN a patient has to travel for treatment, not from
                their current symptom severity, so a stable GREEN patient on a
                frequent regimen still gets the suggestion. The component
                itself decides whether to render, based on treatment
                frequency + parish — see lib/transportationResources.ts. */}
            <SdohActionCard parish={selected.parish} treatmentFrequency={selected.treatmentFrequency} />

            <SoapNoteGenerator patientId={selected.id} />

            <FhirExportButton patientId={selected.id} patientMrn={selected.mrn} />

            <SymptomTrendChart data={selected.logs} />

            {/* Deliberately positioned AFTER the clinical content and trend
                chart above, not right after the header — see
                HospitalizationRiskPanel's own comment for why this is kept
                secondary rather than competing with the clinical risk
                reasons for first attention. */}
            <HospitalizationRiskPanel
              score={selected.hospitalizationRiskScore}
              factors={selected.hospitalizationRiskFactors}
              hasRecentHistory={selected.hospitalizationHasRecentHistory}
            />

            <Separator />

            <div>
              <h4 className="mb-2 text-sm font-medium">Check-in log</h4>
              <div className="flex flex-col gap-2">
                {selected.rawLogs.map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{log.dateLabel}</span>
                      <SourceBadge source={log.source} parsedByAi={log.parsedByAi} />
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Pain {log.pain}/10</span>
                      <span>Nausea {log.nausea}/10</span>
                      <span>Fatigue {log.fatigue}/10</span>
                      <span>Fever {log.fever.toFixed(1)}°F</span>
                    </div>
                    {log.rawSmsText && (
                      <p className="mt-1 flex items-start gap-1.5 text-xs italic text-muted-foreground">
                        <MessageCircle className="mt-0.5 size-3 shrink-0" />
                        &ldquo;{log.rawSmsText}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {selected.caregiver && (
              <>
                <Separator />
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <HeartHandshake className="size-4 text-[var(--viz-caregiver-burden)]" />
                    Caregiver check-ins — {selected.caregiver.firstName} {selected.caregiver.lastName} ({selected.caregiver.relationship})
                  </h4>
                  <div className="flex flex-col gap-2">
                    {selected.caregiver.logs.map((log) => (
                      <div key={log.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{log.dateLabel}</span>
                          <span className="flex gap-3 text-xs text-muted-foreground">
                            <span>Patient status {log.patientStatus}/5</span>
                            <span
                              className={
                                log.copingScore <= 2
                                  ? "font-semibold text-[var(--viz-caregiver-burden)]"
                                  : undefined
                              }
                            >
                              Coping {log.copingScore}/5
                            </span>
                          </span>
                        </div>
                        {log.rawSmsText && (
                          <p className="mt-1 flex items-start gap-1.5 text-xs italic text-muted-foreground">
                            <MessageCircle className="mt-0.5 size-3 shrink-0" />
                            &ldquo;{log.rawSmsText}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
