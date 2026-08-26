// Shared inbound-message handling: recording logs, recomputing risk, and
// firing alerts. Used by the Twilio webhook (app/api/twilio/inbound/route.ts)
// so the same logic backs both a live SMS and any simulated/demo inbound call.

import { prisma } from "./db";
import { assessRisk, type RiskAssessment } from "./risk";
import type { DailySymptoms } from "./riskEngine";
import { computeHospitalizationRisk } from "./hospitalizationRisk";
import type { NeedCategory } from "./needCategory";
import type { TreatmentFrequency } from "./transportationResources";
import { checkTreatmentInterruptionRisk } from "./treatmentInterruptionRisk";

export type LogSource = "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB";

// NOT wrapped in a prisma.$transaction() — tried that, load-tested it, and
// reverted it. See docs/load-test-results.md for the full story: SQLite
// under Prisma's interactive-transaction model queues concurrent
// transactions badly (each one holds the connection across multiple
// round-trip queries), and at 50-100 concurrent requests it started hitting
// Prisma's 5s interactive-transaction timeout — "Transaction already
// closed" / "Socket timeout" — which LOST writes outright, and pushed
// average latency into the 10-20+ second range. That is a strictly worse
// outcome than the race condition the transaction was meant to prevent,
// which was never actually observed (load-tested up to 60 concurrent
// same-patient requests without one, most likely because SQLite's
// single-writer semantics already serialize this closely enough in
// practice). If this ever moves to a real multi-connection database
// (Postgres), re-evaluate wrapping this in a transaction — that database
// won't have the same queuing behavior — but do not reintroduce it on
// SQLite without re-running the load test.
export async function recordSymptomLog(params: {
  patientId: string;
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  source: LogSource;
  rawSmsText?: string | null;
  parsedByAi?: boolean;
  // Optional — defaults to CLINICAL. Every existing caller (demoScenarios.ts,
  // structured-format webhook path) that predates need classification stays
  // correct unmodified: a structured pain/nausea/fatigue/fever report IS
  // unambiguously clinical. Only the freeform AI-parsed path passes a
  // real value, from lib/ai.ts's needCategory field.
  needCategory?: NeedCategory;
  // Optional — only used to check treatment-interruption risk on a
  // LOGISTICAL need (lib/treatmentInterruptionRisk.ts). Omitted by callers
  // that don't have it handy; the interruption check is simply skipped.
  treatmentFrequency?: TreatmentFrequency;
}): Promise<RiskAssessment> {
  const needCategory = params.needCategory ?? "CLINICAL";

  await prisma.symptomLog.create({
    data: {
      patientId: params.patientId,
      pain: params.pain,
      nausea: params.nausea,
      fatigue: params.fatigue,
      fever: params.fever,
      source: params.source,
      rawSmsText: params.rawSmsText ?? null,
      parsedByAi: params.parsedByAi ?? false,
      needCategory,
    },
  });

  // Non-clinical needs get their own alert, same pattern as CAREGIVER_BURDEN
  // below: a distinct RiskAlert.level, never blended into the clinical
  // YELLOW/RED score. ROUTINE deliberately creates nothing — "acknowledged,
  // no action required" (see lib/needCategory.ts) — everything else
  // (LOGISTICAL/EMOTIONAL/FINANCIAL/UNCERTAIN) surfaces on the same queue a
  // clinical alert would, routed by category instead of severity.
  if (needCategory !== "CLINICAL" && needCategory !== "ROUTINE" && params.rawSmsText) {
    const reasons = [`Message: "${params.rawSmsText}"`];

    if (needCategory === "LOGISTICAL" && params.treatmentFrequency) {
      const interruption = checkTreatmentInterruptionRisk(params.treatmentFrequency);
      if (interruption.atRisk && interruption.reason) reasons.push(interruption.reason);
    }

    await prisma.riskAlert.create({
      data: {
        patientId: params.patientId,
        level: needCategory,
        reasons: JSON.stringify(reasons),
        modelProb: null,
        status: "OPEN",
      },
    });
  }

  const logs = await prisma.symptomLog.findMany({
    where: { patientId: params.patientId },
    orderBy: { createdAt: "asc" },
  });
  const history: DailySymptoms[] = logs.map((l) => ({
    pain: l.pain,
    nausea: l.nausea,
    fatigue: l.fatigue,
    fever: l.fever,
    createdAt: l.createdAt,
  }));
  const assessment = assessRisk(history);

  await prisma.patient.update({
    where: { id: params.patientId },
    data: { riskStatus: assessment.level, riskScore: assessment.modelProb },
  });

  if (assessment.level === "YELLOW" || assessment.level === "RED") {
    await prisma.riskAlert.create({
      data: {
        patientId: params.patientId,
        level: assessment.level,
        reasons: JSON.stringify(assessment.reasons),
        modelProb: assessment.modelProb,
        status: "OPEN",
      },
    });
  }

  // Separate model, separate time horizon — recomputed alongside the daily
  // assessment (a new symptom log changes the rolling 7-day features it's
  // built from) but never merged into riskStatus/riskScore above.
  const hosp = await computeHospitalizationRisk(params.patientId);
  await prisma.patient.update({ where: { id: params.patientId }, data: { hospitalizationRiskScore: hosp.score } });

  return assessment;
}

// Fired by the deterministic crisis-language safety gate (lib/safetyGate.ts)
// — always the patient's own record, even when a caregiver sent the
// message (a caregiver relaying crisis language about the patient is still
// about the patient's safety). Deliberately NOT a SymptomLog: this isn't a
// pain/nausea/fatigue/fever reading, and fabricating zero values for those
// fields to force it into that shape would misleadingly enter the symptom
// trend chart. A plain RiskAlert with the real quoted text is honest about
// what this actually is.
export async function recordSafetyAlert(params: { patientId: string; rawSmsText: string; reason: string }) {
  return prisma.riskAlert.create({
    data: {
      patientId: params.patientId,
      level: "SAFETY",
      reasons: JSON.stringify([params.reason, `Message: "${params.rawSmsText}"`]),
      modelProb: null,
      status: "OPEN",
    },
  });
}

export async function recordCaregiverLog(params: {
  caregiverId: string;
  patientId: string;
  patientStatus: number;
  copingScore: number;
  rawSmsText?: string | null;
}): Promise<{ burdenFlagged: boolean }> {
  await prisma.caregiverLog.create({
    data: {
      caregiverId: params.caregiverId,
      patientStatus: params.patientStatus,
      copingScore: params.copingScore,
      rawSmsText: params.rawSmsText ?? null,
    },
  });

  let burdenFlagged = false;

  if (params.copingScore <= 2) {
    const recentLogs = await prisma.caregiverLog.findMany({
      where: { caregiverId: params.caregiverId },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    const lowCount = recentLogs.filter((l) => l.copingScore <= 2).length;

    await prisma.riskAlert.create({
      data: {
        patientId: params.patientId,
        level: "CAREGIVER_BURDEN",
        reasons: JSON.stringify([
          `Caregiver coping score ${params.copingScore}/5 ("overwhelmed") — ${lowCount} of last ${recentLogs.length} check-ins at or below threshold`,
          "Caregiver check-in flags exhaustion and burnout risk",
        ]),
        modelProb: null,
        status: "OPEN",
      },
    });

    burdenFlagged = true;
  }

  // Every caregiver check-in changes the hospitalization model's rolling
  // 7-day caregiverBurdenFlag7d feature — a coping score IMPROVING can drop
  // that flag out of the 7-day window just as much as a bad score can add
  // it in, so this recompute must run on every check-in, not just the
  // burden-flagged branch above. It used to sit inside that branch (an
  // early return skipped it entirely on a good coping score), which meant
  // the displayed hospitalizationRiskScore only ever moved on bad news and
  // silently never reflected recovery — see
  // tests/integration/hospitalizationRecompute.test.ts for the regression
  // test that pins this down.
  const hosp = await computeHospitalizationRisk(params.patientId);
  await prisma.patient.update({ where: { id: params.patientId }, data: { hospitalizationRiskScore: hosp.score } });

  return { burdenFlagged };
}

export type Sender =
  | { type: "PATIENT"; patient: NonNullable<Awaited<ReturnType<typeof prisma.patient.findUnique>>> }
  | {
      type: "CAREGIVER";
      caregiver: NonNullable<Awaited<ReturnType<typeof prisma.caregiver.findUnique>>>;
      patient: NonNullable<Awaited<ReturnType<typeof prisma.patient.findUnique>>>;
    };

export async function findSenderByPhone(phone: string): Promise<Sender | null> {
  const patient = await prisma.patient.findUnique({ where: { phone } });
  if (patient) return { type: "PATIENT", patient };

  const caregiver = await prisma.caregiver.findUnique({ where: { phone }, include: { patient: true } });
  if (caregiver) return { type: "CAREGIVER", caregiver, patient: caregiver.patient };

  return null;
}

// Plausible human ranges — the regexes above only check "is this shaped like
// numbers," not "are these numbers sane." Without this, a message like
// "99,99,99,999" would parse as a structured symptom report with a 999°F
// fever and write that straight into the risk engine. Out-of-range input is
// treated as NOT structured (returns null) so the caller falls through to
// freeform AI parsing instead, whose JSON-schema output bounds (see
// lib/ai.ts) constrain the model's answer even on a weird input.
const STRUCTURED_SYMPTOM_RE = /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/;
const STRUCTURED_CAREGIVER_RE = /^(\d+)\s*,\s*(\d+)$/;

const SCORE_MIN = 0;
const SCORE_MAX = 10;
const FEVER_MIN_F = 90;
const FEVER_MAX_F = 110;
const COPING_MIN = 1;
const COPING_MAX = 5;

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function parseStructuredSymptoms(
  text: string
): { pain: number; nausea: number; fatigue: number; fever: number } | null {
  const match = text.trim().match(STRUCTURED_SYMPTOM_RE);
  if (!match) return null;
  const [, pain, nausea, fatigue, fever] = match;
  const parsed = { pain: Number(pain), nausea: Number(nausea), fatigue: Number(fatigue), fever: Number(fever) };
  const scoresValid =
    inRange(parsed.pain, SCORE_MIN, SCORE_MAX) &&
    inRange(parsed.nausea, SCORE_MIN, SCORE_MAX) &&
    inRange(parsed.fatigue, SCORE_MIN, SCORE_MAX);
  const feverValid = inRange(parsed.fever, FEVER_MIN_F, FEVER_MAX_F);
  if (!scoresValid || !feverValid) return null;
  return parsed;
}

export function parseStructuredCaregiverCheckin(
  text: string
): { patientStatus: number; copingScore: number } | null {
  const match = text.trim().match(STRUCTURED_CAREGIVER_RE);
  if (!match) return null;
  const [, patientStatus, copingScore] = match;
  const parsed = { patientStatus: Number(patientStatus), copingScore: Number(copingScore) };
  const valid = inRange(parsed.patientStatus, COPING_MIN, COPING_MAX) && inRange(parsed.copingScore, COPING_MIN, COPING_MAX);
  if (!valid) return null;
  return parsed;
}
