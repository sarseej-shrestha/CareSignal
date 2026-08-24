"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  FileText,
  HeartHandshake,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { SoapNoteGenerator } from "@/components/SoapNoteGenerator";
import { HospitalizationRiskPanel } from "@/components/HospitalizationRiskPanel";
import { FhirExportButton } from "@/components/FhirExportButton";
import { PhoneMockup, SmsBubble } from "@/components/demo/PhoneMockup";
import { patients as seedPatients } from "@/lib/seedData";

// Both demo beats replay a REAL seeded patient's REAL final check-in through
// /api/demo/trigger -> lib/demoScenarios.ts -> the same recordSymptomLog /
// recordCaregiverLog pathway a live Twilio SMS uses. The message text below
// is read straight out of lib/seedData.ts (not retyped) so it can never
// drift from what actually gets replayed.
const guidry = seedPatients.find((p) => p.mrn === "OCH-70144")!;
const guidryFinalLog = guidry.logs[guidry.logs.length - 1];

const trahan = seedPatients.find((p) => p.mrn === "OCH-70146")!;
const angela = trahan.caregiver!;
const angelaEarlierLog = angela.logs[angela.logs.length - 2];
const angelaFinalLog = angela.logs[angela.logs.length - 1];

type Stage = "intro" | "sending" | "detected" | "triage" | "careTeam";

interface TriggerResponse {
  patientId: string;
  patientName: string;
  summary: string;
  riskStatus?: "GREEN" | "YELLOW" | "RED";
  riskScore?: number;
  reasons?: string[];
  caregiverBurdenReasons?: string[];
  hospitalizationRiskScore?: number;
  hospitalizationRiskFactors?: string[];
  hospitalizationHasRecentHistory?: boolean;
  error?: string;
}

async function callTrigger(scenarioId: string): Promise<TriggerResponse> {
  const res = await fetch("/api/demo/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "The demo trigger didn't run.");
  return data;
}

function symptomBullets(pain: number, nausea: number, fatigue: number, fever: number): string[] {
  const bullets: string[] = [];
  if (fever >= 100.4) bullets.push(`Fever — ${fever.toFixed(1)}°F, above the 100.4°F neutropenic threshold`);
  else if (fever >= 100) bullets.push(`Low-grade fever — ${fever.toFixed(1)}°F`);
  if (pain >= 6) bullets.push(`Severe pain — ${pain}/10`);
  else if (pain >= 4) bullets.push(`Elevated pain — ${pain}/10`);
  if (nausea >= 6) bullets.push(`Severe nausea — ${nausea}/10`);
  else if (nausea >= 4) bullets.push(`Elevated nausea — ${nausea}/10`);
  if (fatigue >= 6) bullets.push(`Significant fatigue — ${fatigue}/10`);
  else if (fatigue >= 4) bullets.push(`Elevated fatigue — ${fatigue}/10`);
  if (fever < 100) bullets.push("No fever reported");
  return bullets;
}

const STEPS = ["Patient", "Detection", "Triage", "Care team"] as const;

function stageIndex(stage: Stage): number {
  if (stage === "intro" || stage === "sending") return 0;
  if (stage === "detected") return 1;
  if (stage === "triage") return 2;
  return 3;
}

function ProgressStepper({ stage }: { stage: Stage }) {
  const active = stageIndex(stage);
  return (
    <div className="mx-auto flex max-w-md items-center justify-between gap-2 py-2 text-xs">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`flex size-5 items-center justify-center rounded-full border text-[10px] font-medium ${
                i <= active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className={i <= active ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
          </div>
          {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
        </div>
      ))}
    </div>
  );
}

export function DemoClient({ demoModeEnabled }: { demoModeEnabled: boolean }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [result, setResult] = useState<TriggerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [caregiverRevealed, setCaregiverRevealed] = useState(false);
  const [caregiverResult, setCaregiverResult] = useState<TriggerResponse | null>(null);
  const [caregiverLoading, setCaregiverLoading] = useState(false);
  const [caregiverError, setCaregiverError] = useState<string | null>(null);

  const triageRef = useRef<HTMLDivElement>(null);
  const careTeamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stage === "triage" && triageRef.current) {
      triageRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [stage]);

  useEffect(() => {
    if (stage === "careTeam" && careTeamRef.current) {
      careTeamRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [stage]);

  async function handleSend() {
    setStage("sending");
    setError(null);
    try {
      const data = await callTrigger("guidry-divergence");
      setResult(data);
      setStage("detected");
      window.setTimeout(() => setStage("triage"), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The demo trigger didn't run.");
      setStage("intro");
    }
  }

  async function handleCaregiverSend() {
    setCaregiverLoading(true);
    setCaregiverError(null);
    try {
      const data = await callTrigger("trahan-burden");
      setCaregiverResult(data);
    } catch (err) {
      setCaregiverError(err instanceof Error ? err.message : "The demo trigger didn't run.");
    } finally {
      setCaregiverLoading(false);
    }
  }

  const bullets = result
    ? symptomBullets(guidryFinalLog.pain, guidryFinalLog.nausea, guidryFinalLog.fatigue, guidryFinalLog.fever)
    : [];

  const rulesOnlyLevel = "YELLOW";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 px-6 py-10">
      <ProgressStepper stage={stage} />

      {/* Stage: Patient */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">A patient checks in</CardTitle>
          <p className="text-sm text-muted-foreground">
            Denise Guidry is on cycle 4 of chemotherapy for lung cancer. She doesn&apos;t use an app or a portal —
            she just texts CareSignal&apos;s number, in her own words.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <PhoneMockup contactName={`${guidry.firstName} ${guidry.lastName}`} contactSub={guidry.phone}>
            <SmsBubble text={guidryFinalLog.rawSmsText ?? ""} pending={stage === "intro"} />
          </PhoneMockup>
          {stage === "intro" && (
            <Button size="lg" onClick={handleSend} className="gap-2">
              <Send className="size-4" />
              Send message
            </Button>
          )}
          {stage === "sending" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              CareSignal is reading this message&hellip;
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Stage: Detection */}
      {(stage === "detected" || stage === "triage" || stage === "careTeam") && result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="size-4" />
              Message received
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              CareSignal parses freeform text like this with a small language model, the same way it would parse
              structured shorthand like &ldquo;7,4,6,98.7&rdquo;. No app needed on either end.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--viz-series-fatigue)]">
              <Sparkles className="size-3.5" />
              Parsed by AI from freeform text
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Symptoms detected</div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage: Triage */}
      {(stage === "triage" || stage === "careTeam") && result && (
        <div ref={triageRef} className="flex flex-col gap-4">
          <Card
            className="border-l-4"
            style={{
              borderLeftColor:
                result.riskStatus === "RED" ? "var(--viz-status-critical)" : "var(--viz-status-warning)",
            }}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Bell className="size-3.5" />
                  New alert on the triage queue
                </div>
                <CardTitle className="text-base">{result.patientName}</CardTitle>
              </div>
              {result.riskStatus && <RiskBadge level={result.riskStatus} score={result.riskScore} />}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="rounded-lg border bg-muted/30 p-3 text-sm italic">
                &ldquo;{guidryFinalLog.rawSmsText}&rdquo;
              </p>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Why this risk level</div>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">
                  {(result.reasons ?? []).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-muted-foreground">
                Hard clinical rules on their own would only reach <span className="font-medium">{rulesOnlyLevel}</span>
                {" "}here — no fever, no single reading past a hard threshold. The trained model reads the trend
                across her last several check-ins and pushes this to{" "}
                <span className="font-medium">{result.riskStatus}</span> instead. That escalation only ever goes up,
                never down, over what the rules alone would say.
              </p>
              {stage === "triage" && (
                <Button onClick={() => setStage("careTeam")} className="w-fit gap-2">
                  Review patient
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stage: Care team */}
      {stage === "careTeam" && result && (
        <div ref={careTeamRef} className="flex flex-col gap-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">The care team takes it from here</h2>
            <p className="text-sm text-muted-foreground">
              Denise&apos;s alert is now open on a nurse&apos;s real triage queue. Everything below runs against the
              actual CareSignal app, not a mockup.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <FileText className="size-4" />
                Draft a clinical note
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                One click turns her check-in history into a Subjective / Objective / Assessment / Plan note. It
                starts as an unreviewed draft and stays labeled that way until a clinician marks it reviewed.
              </p>
            </CardHeader>
            <CardContent>
              <SoapNoteGenerator patientId={result.patientId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <HeartHandshake className="size-4 text-[var(--viz-caregiver-burden)]" />
                A second, separate signal
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Denise doesn&apos;t have a caregiver on file. Most symptom trackers stop at the patient —
                CareSignal doesn&apos;t. Here&apos;s a different patient on the same queue, Ruth Trahan, whose
                daughter Angela checks in on her own channel.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <PhoneMockup contactName={`${angela.firstName} ${angela.lastName}`} contactSub={`${angela.relationship} of ${trahan.firstName} ${trahan.lastName}`}>
                <SmsBubble text={angelaEarlierLog.rawSmsText ?? ""} timestamp="2 days ago" />
                <SmsBubble text={angelaFinalLog.rawSmsText ?? ""} pending={!caregiverResult} timestamp={caregiverResult ? "Today" : undefined} />
              </PhoneMockup>
              {!caregiverResult && !caregiverRevealed && (
                <Button
                  onClick={() => {
                    setCaregiverRevealed(true);
                    handleCaregiverSend();
                  }}
                  disabled={caregiverLoading}
                  className="gap-2"
                >
                  {caregiverLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send message
                </Button>
              )}
              {caregiverError && <p className="text-sm text-destructive">{caregiverError}</p>}
              {caregiverResult && (
                <div className="flex w-full flex-col gap-2 rounded-lg border border-[var(--viz-caregiver-burden)]/30 bg-[var(--viz-caregiver-burden)]/5 p-3">
                  <RiskBadge level="CAREGIVER_BURDEN" />
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {(caregiverResult.caregiverBurdenReasons ?? []).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    This never changes Ruth&apos;s own clinical risk score — it&apos;s tracked, colored, and
                    reasoned about completely separately.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {caregiverResult && typeof caregiverResult.hospitalizationRiskScore === "number" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <TrendingUp className="size-4" />
                  Looking ahead a week, not just today
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  A separate model forecasts hospitalization risk over the next 7 days. Ruth&apos;s caregiver signal
                  feeds into this forecast too — which is part of why her score is the highest in this seeded
                  panel, even though she doesn&apos;t have the worst symptoms today.
                </p>
              </CardHeader>
              <CardContent>
                <HospitalizationRiskPanel
                  score={caregiverResult.hospitalizationRiskScore}
                  factors={caregiverResult.hospitalizationRiskFactors ?? []}
                  hasRecentHistory={caregiverResult.hospitalizationHasRecentHistory ?? true}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Interoperability, if you need it</CardTitle>
              <p className="text-sm text-muted-foreground">
                CareSignal can package a patient&apos;s record as a FHIR-compatible bundle for a real EHR. Optional
                — most of the demo doesn&apos;t need this.
              </p>
            </CardHeader>
            <CardContent>
              <FhirExportButton patientId={result.patientId} patientMrn={guidry.mrn} />
            </CardContent>
          </Card>

          <div className="flex flex-col items-center gap-3 border-t pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              That&apos;s the loop: a message in, a real risk assessment, a nurse&apos;s queue, a documentation
              assist, and a second signal most tools never look for.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" render={<Link href={`/dashboard?patient=${result.patientId}`} />} nativeButton={false}>
                Open the full dashboard
              </Button>
              <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
                Back to CareSignal
              </Button>
            </div>
          </div>
        </div>
      )}

      {!demoModeEnabled && (
        <p className="text-center text-xs text-muted-foreground">
          Note: DEMO_MODE is off on this deployment. The buttons above call the real API and will show an error until
          it&apos;s enabled.
        </p>
      )}
    </div>
  );
}
