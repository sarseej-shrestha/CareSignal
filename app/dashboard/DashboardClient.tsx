"use client";

import { useMemo, useState } from "react";
import { HeartHandshake, MapPin, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PatientRiskTable, type QueuePatient } from "@/components/PatientRiskTable";
import { SymptomTrendChart, type TrendPoint } from "@/components/SymptomTrendChart";
import { RiskBadge } from "@/components/RiskBadge";
import { SourceBadge, type LogSource } from "@/components/SourceBadge";
import { DemoControls } from "@/components/DemoControls";
import { HospitalizationRiskPanel } from "@/components/HospitalizationRiskPanel";
import { SdohActionCard } from "@/components/SdohActionCard";
import type { TreatmentFrequency } from "@/lib/transportationResources";
import { SoapNoteGenerator } from "@/components/SoapNoteGenerator";
import { FhirExportButton } from "@/components/FhirExportButton";
import { sortByConsolidatedPriority } from "@/lib/alertConsolidation";

export interface CaregiverLogView {
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

  const burdenPatients = useMemo(() => patients.filter((p) => p.caregiverBurdenReasons), [patients]);

  const [selectedId, setSelectedId] = useState<string | null>(sortedQueue[0]?.id ?? null);
  const selected = patients.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">CareSignal</h1>
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Nurse triage dashboard
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5" />
          SMS-first symptom monitoring for rural Louisiana cancer care — Terrebonne &amp; Lafourche Parish
        </p>
      </header>

      {demoModeEnabled && <DemoControls />}

      {burdenPatients.length > 0 && (
        <Card className="border-[var(--viz-caregiver-burden)]/35 bg-[var(--viz-caregiver-burden)]/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-[var(--viz-caregiver-burden)]">
              <HeartHandshake className="size-4" />
              Caregiver burden alerts
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              A distinct signal from patient clinical risk — flagged from the caregiver&apos;s own check-in, not the patient&apos;s symptoms.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {burdenPatients.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className="flex flex-col gap-1 rounded-lg border border-[var(--viz-caregiver-burden)]/25 bg-background px-4 py-3 text-left transition hover:border-[var(--viz-caregiver-burden)]/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.firstName} {p.lastName}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      caregiver: {p.caregiver?.firstName} {p.caregiver?.lastName} ({p.caregiver?.relationship})
                    </span>
                  </span>
                  <RiskBadge level="CAREGIVER_BURDEN" />
                </div>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {p.caregiverBurdenReasons?.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consolidated triage queue</CardTitle>
          <p className="text-xs text-muted-foreground">
            Daily clinical risk and 7-day hospitalization risk shown as ONE notification per patient — a
            &quot;+ 7-day risk&quot; tag means both signals are elevated at once, not two separate items to review.
            Click a row to see the full trend.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <PatientRiskTable patients={sortedQueue} selectedId={selectedId} onSelect={setSelectedId} />
        </CardContent>
      </Card>

      {selected && (
        <Card>
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
            {selected.reasons.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Why this risk level</div>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {selected.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            <HospitalizationRiskPanel
              score={selected.hospitalizationRiskScore}
              factors={selected.hospitalizationRiskFactors}
              hasRecentHistory={selected.hospitalizationHasRecentHistory}
            />

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
