"use client";

import { useMemo, useState } from "react";
import { Activity, MapPin, MessageCircle, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PatientRiskTable, type QueuePatient } from "@/components/PatientRiskTable";
import { SymptomTrendChart, type TrendPoint } from "@/components/SymptomTrendChart";
import { RiskBadge } from "@/components/RiskBadge";
import { NeedCard } from "@/components/NeedCard";
import type { UnifiedNeed } from "@/lib/needPresentation";
import { sortNeeds } from "@/lib/needPresentation";
import { SourceBadge, type LogSource } from "@/components/SourceBadge";
import { TranslateMessage } from "@/components/TranslateMessage";
import { CommunicationThread, type CommunicationMessageView } from "@/components/CommunicationThread";
import { ReplyComposer } from "@/components/ReplyComposer";
import { DemoControls } from "@/components/DemoControls";
import { LimitationsPanel } from "@/components/LimitationsPanel";
import { HospitalizationRiskPanel } from "@/components/HospitalizationRiskPanel";
import { SdohActionCard } from "@/components/SdohActionCard";
import type { TreatmentFrequency } from "@/lib/transportationResources";
import { SoapNoteGenerator } from "@/components/SoapNoteGenerator";
import { FhirExportButton } from "@/components/FhirExportButton";
import { sortByConsolidatedPriority } from "@/lib/alertConsolidation";
import type { ClinicalSnapshot } from "@/lib/clinicalSnapshot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CaregiverLogView {
  id: string;
  date: string;
  dateLabel: string;
  patientStatus: number;
  copingScore: number;
  rawSmsText: string | null;
}

export interface DashboardPatient extends QueuePatient {
  preferredLanguage: string;
  treatmentFrequency: TreatmentFrequency;
  reasons: string[];
  logs: TrendPoint[];
  rawLogs: {
    id: string;
    date: string;
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
  clinicalSnapshot: ClinicalSnapshot | null;
  clinicalAlertId: string | null;
  clinicalAlertStatus: string | null;
  burdenAlertId: string | null;
  burdenAlertStatus: string | null;
  // Non-clinical needs (LOGISTICAL/EMOTIONAL/FINANCIAL/UNCERTAIN/SAFETY),
  // routed outside the clinical risk score — see lib/needCategory.ts and
  // lib/safetyGate.ts. Never blended into riskStatus/riskScore.
  careNeeds: { id: string; category: string; reasons: string[]; status: string; dateLabel: string }[];
  // hospitalizationRiskScore is inherited from QueuePatient — separate
  // model, separate time horizon (7-day forecast, not today's status),
  // never merged into riskStatus/riskScore.
  hospitalizationRiskFactors: string[];
  hospitalizationHasRecentHistory: boolean;
  communications: CommunicationMessageView[];
  lastInboundParticipant: "PATIENT" | "CAREGIVER";
}

interface TimelineEntry {
  id: string;
  date: string;
  dateLabel: string;
  actor: string;
  source: LogSource;
  parsedByAi: boolean;
  text: string;
}

function buildUnifiedNeeds(p: DashboardPatient): UnifiedNeed[] {
  const needs: UnifiedNeed[] = [];

  if (p.clinicalAlertId && p.clinicalAlertStatus && p.reasons.length > 0) {
    needs.push({
      id: p.clinicalAlertId,
      kind: p.riskStatus === "RED" ? "RED" : "YELLOW",
      reasons: p.reasons,
      status: p.clinicalAlertStatus,
    });
  }

  if (p.burdenAlertId && p.burdenAlertStatus && p.caregiverBurdenReasons) {
    needs.push({
      id: p.burdenAlertId,
      kind: "CAREGIVER_BURDEN",
      reasons: p.caregiverBurdenReasons,
      status: p.burdenAlertStatus,
    });
  }

  for (const need of p.careNeeds) {
    needs.push({
      id: need.id,
      kind: need.category as UnifiedNeed["kind"],
      reasons: need.reasons,
      status: need.status,
      dateLabel: need.dateLabel,
    });
  }

  return sortNeeds(needs);
}

function buildTimeline(p: DashboardPatient): TimelineEntry[] {
  const symptomEntries: TimelineEntry[] = p.rawLogs.map((log) => ({
    id: log.id,
    date: log.date,
    dateLabel: log.dateLabel,
    actor: p.firstName,
    source: log.source,
    parsedByAi: log.parsedByAi,
    text: log.rawSmsText ?? `Pain ${log.pain}/10 · Nausea ${log.nausea}/10 · Fatigue ${log.fatigue}/10 · Fever ${log.fever.toFixed(1)}°F`,
  }));

  const caregiverEntries: TimelineEntry[] = (p.caregiver?.logs ?? []).map((log) => ({
    id: log.id,
    date: log.date,
    dateLabel: log.dateLabel,
    actor: p.caregiver ? `${p.caregiver.firstName} (${p.caregiver.relationship})` : "Caregiver",
    source: "CAREGIVER_SMS" as LogSource,
    parsedByAi: false,
    text: log.rawSmsText ?? `Patient status ${log.patientStatus}/5 · Coping ${log.copingScore}/5`,
  }));

  return [...symptomEntries, ...caregiverEntries].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function DashboardClient({
  patients,
  demoModeEnabled,
  initialSelectedId = null,
}: {
  patients: DashboardPatient[];
  demoModeEnabled: boolean;
  initialSelectedId?: string | null;
}) {
  const sortedQueue = useMemo(() => sortByConsolidatedPriority(patients), [patients]);

  const [selectedId, setSelectedId] = useState<string | null>(
    (initialSelectedId && patients.some((p) => p.id === initialSelectedId) ? initialSelectedId : null) ??
      sortedQueue[0]?.id ??
      null
  );
  const selected = patients.find((p) => p.id === selectedId) ?? null;

  const needs = useMemo(() => (selected ? buildUnifiedNeeds(selected) : []), [selected]);
  const activeNeeds = needs.filter((n) => n.status !== "RESOLVED");
  const resolvedNeeds = needs.filter((n) => n.status === "RESOLVED");
  const timeline = useMemo(() => (selected ? buildTimeline(selected) : []), [selected]);

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
          SMS-first symptom monitoring for rural Louisiana cancer care, Terrebonne &amp; Lafourche Parish
        </p>
      </header>

      <LimitationsPanel />

      {demoModeEnabled && <DemoControls />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What needs attention</CardTitle>
          <p className="text-xs text-muted-foreground">
            One row per patient, clinical status and caregiver status shown together. The underlying scores stay
            completely separate; this only changes how they&apos;re presented. Click a row to review.
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
              <CardTitle className="text-lg">
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
            {/* WHAT HAPPENED — the patient's own most recent words, and how
                that compares to their own recent baseline. Real deltas, same
                math as the risk engine's own 3-day trend rule, not a new
                data source. This is the first thing a clinician reads. */}
            {selected.clinicalSnapshot && (
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What happened
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{selected.clinicalSnapshot.latestDateLabel}</span>
                    <SourceBadge
                      source={selected.clinicalSnapshot.latestSource as LogSource}
                      parsedByAi={selected.clinicalSnapshot.parsedByAi}
                    />
                  </div>
                  {selected.clinicalSnapshot.latestRawText && (
                    <div className="mb-2">
                      <p className="flex items-start gap-1.5 text-sm text-foreground/90">
                        <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        &ldquo;{selected.clinicalSnapshot.latestRawText}&rdquo;
                      </p>
                      {/* Clinician-facing translation, on demand only — never
                          shown for an already-English message (no LLM call
                          wasted on a translation that adds no value). Uses
                          the same preferredLanguage field lib/i18n.ts already
                          relies on for outbound SMS, not a new detection
                          system, and isn't expected to be perfect — a
                          preferredLanguage="en" patient who occasionally
                          texts in Spanish just won't see the button, which
                          is a UX tradeoff, not a safety one: the original
                          text is always shown regardless. */}
                      {selected.preferredLanguage !== "en" && (
                        <TranslateMessage text={selected.clinicalSnapshot.latestRawText} />
                      )}
                    </div>
                  )}
                  {selected.clinicalSnapshot.deltas ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {(["pain", "nausea", "fatigue"] as const).map((dim) => {
                        const delta = selected.clinicalSnapshot!.deltas![dim];
                        if (Math.abs(delta) < 0.5) return null;
                        return (
                          <span
                            key={dim}
                            className={delta > 0 ? "font-medium text-[var(--viz-status-critical)]" : undefined}
                          >
                            {delta > 0 ? "↑" : "↓"} {dim} {Math.abs(delta).toFixed(1)} pts vs. baseline
                          </span>
                        );
                      })}
                      {Math.abs(selected.clinicalSnapshot.deltas.fever) >= 0.5 && (
                        <span
                          className={
                            selected.clinicalSnapshot.deltas.fever > 0
                              ? "font-medium text-[var(--viz-status-critical)]"
                              : undefined
                          }
                        >
                          {selected.clinicalSnapshot.deltas.fever > 0 ? "↑" : "↓"} temp{" "}
                          {Math.abs(selected.clinicalSnapshot.deltas.fever).toFixed(1)}° vs. baseline
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No baseline yet, this is an early check-in.</p>
                  )}
                </div>
              </div>
            )}

            {/* WHY THIS MATTERS / NEXT STEP, unified — every kind of need
                CareSignal can surface (clinical risk, caregiver burden,
                logistical/emotional/financial/uncertain) rendered as one
                consistent list instead of three differently-styled boxes.
                Claim/resolve controls live here, so "who owns this" and
                "what happens next" sit right next to "why". */}
            {activeNeeds.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Active needs
                </div>
                <div className="flex flex-col gap-3">
                  {activeNeeds.map((need) => (
                    <NeedCard key={need.id} need={need} />
                  ))}
                </div>
              </div>
            )}

            {resolvedNeeds.length > 0 && (
              <details className="rounded-lg border border-dashed p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                  {resolvedNeeds.length} resolved
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {resolvedNeeds.map((need) => (
                    <NeedCard key={need.id} need={need} />
                  ))}
                </div>
              </details>
            )}

            {activeNeeds.length === 0 && resolvedNeeds.length === 0 && (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No open needs for {selected.firstName} right now.
              </p>
            )}

            {/* Closed-loop communication — the conversation so far, then a
                composer to reply. A reply is tied to whichever active need is
                currently highest-priority (if any), so sending it can advance
                that need to ACTIONED (see app/api/communications/send/route.ts)
                — sending with no active need just records the message with
                no status side effect. This never touches the safety/risk
                pipeline: an inbound reply here is not a different code path
                from any other inbound SMS, it's the exact same webhook. */}
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Communication
              </div>
              <div className="flex flex-col gap-3">
                <CommunicationThread messages={selected.communications} />
                <ReplyComposer
                  patientId={selected.id}
                  patientName={selected.firstName}
                  caregiverName={selected.caregiver?.firstName ?? null}
                  relatedAlertId={activeNeeds[0]?.id ?? null}
                  defaultParticipant={selected.lastInboundParticipant}
                />
              </div>
            </div>

            {/* Progressive disclosure — everything above is enough to decide
                what to do next. Supporting context, documentation, and the
                full history are one click away, not competing for the same
                first look. */}
            <Tabs key={selected.id} defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="documentation">Documentation</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
                {/* No risk-level gate here on purpose — transportation burden
                    comes from how OFTEN a patient has to travel for treatment,
                    not from their current symptom severity, so a stable
                    patient on a frequent regimen still gets the suggestion.
                    See lib/transportationResources.ts. */}
                <SdohActionCard parish={selected.parish} treatmentFrequency={selected.treatmentFrequency} />
                <SymptomTrendChart data={selected.logs} />
                <HospitalizationRiskPanel
                  score={selected.hospitalizationRiskScore}
                  factors={selected.hospitalizationRiskFactors}
                  hasRecentHistory={selected.hospitalizationHasRecentHistory}
                />
              </TabsContent>

              <TabsContent value="documentation" className="flex flex-col gap-4 pt-4">
                <SoapNoteGenerator patientId={selected.id} />
                <FhirExportButton patientId={selected.id} patientMrn={selected.mrn} />
              </TabsContent>

              <TabsContent value="timeline" className="pt-4">
                {selected.caregiver && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="size-3.5" />
                    Combined check-ins from {selected.firstName} and {selected.caregiver.firstName} (
                    {selected.caregiver.relationship})
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {timeline.map((entry) => (
                    <div key={entry.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {entry.actor} · {entry.dateLabel}
                        </span>
                        <SourceBadge source={entry.source} parsedByAi={entry.parsedByAi} />
                      </div>
                      <p className="flex items-start gap-1.5 text-xs italic text-muted-foreground">
                        <MessageCircle className="mt-0.5 size-3 shrink-0" />
                        &ldquo;{entry.text}&rdquo;
                      </p>
                    </div>
                  ))}
                  {timeline.length === 0 && (
                    <p className="text-sm text-muted-foreground">No check-ins on file yet.</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
