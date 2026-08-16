// DEMO_MODE fallback — replays the three headline seeded scenarios locally,
// with zero dependency on Twilio or Groq, so a live SMS/API hiccup mid-pitch
// doesn't sink the demo. Live SMS remains the primary demo path; this is a
// break-glass fallback only (see docs/pitch-notes.md).
//
// Each scenario resets its one target patient (and caregiver, where
// applicable) back to the pre-trigger state using the same fixture data as
// prisma/seed.ts (lib/seedData.ts — kept in one place on purpose), then
// replays only the FINAL check-in through the exact same recordSymptomLog /
// recordCaregiverLog functions a live inbound SMS uses (lib/inbound.ts).
// That's deliberate: the fallback exercises the real risk-engine + alert
// pathway, not a canned UI state, so what the audience sees is the same
// live computation a real SMS would have triggered — just without the
// external round-trip. It's also idempotent: triggering the same scenario
// repeatedly (e.g. during rehearsal) always resets first, so it always
// lands on the same end state.

import { prisma } from "./db";
import { assessRisk } from "./risk";
import type { DailySymptoms } from "./riskEngine";
import { recordCaregiverLog, recordSymptomLog } from "./inbound";
import { daysAgo, patients, type SeedPatient } from "./seedData";

export interface DemoScenario {
  id: string;
  label: string;
  description: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "naquin-fever",
    label: "Michael Naquin — fever escalation",
    description:
      "Resets Michael to his pre-spike trend, then replays the check-in that pushes him into a neutropenic fever (RED).",
  },
  {
    id: "guidry-divergence",
    label: "Denise Guidry — rules vs. model",
    description:
      "Resets Denise to her baseline, then replays the freeform check-in where rules alone say YELLOW but the trained model escalates to RED.",
  },
  {
    id: "trahan-burden",
    label: "Ruth Trahan — caregiver burden",
    description:
      "Resets Angela's (Ruth's daughter) check-in history, then replays the coping check-in that flags caregiver burnout — separate from Ruth's own clinical risk.",
  },
];

function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

function findSeedPatient(mrn: string): SeedPatient {
  const found = patients.find((p) => p.mrn === mrn);
  if (!found) throw new Error(`lib/seedData.ts has no patient with mrn ${mrn}`);
  return found;
}

async function ensurePatient(seed: SeedPatient) {
  return prisma.patient.upsert({
    where: { mrn: seed.mrn },
    update: {},
    create: {
      mrn: seed.mrn,
      firstName: seed.firstName,
      lastName: seed.lastName,
      phone: seed.phone,
      cancerType: seed.cancerType,
      chemoCycle: seed.chemoCycle,
      parish: seed.parish,
    },
  });
}

async function ensureCaregiver(patientId: string, seed: SeedPatient) {
  if (!seed.caregiver) return null;
  return prisma.caregiver.upsert({
    where: { phone: seed.caregiver.phone },
    update: { patientId },
    create: {
      firstName: seed.caregiver.firstName,
      lastName: seed.caregiver.lastName,
      phone: seed.caregiver.phone,
      relationship: seed.caregiver.relationship,
      patientId,
    },
  });
}

// Wipes this patient's (and their caregiver's) log/alert history, then
// silently re-inserts every log EXCEPT the final one — the "day before the
// demo moment" state — and recomputes risk for that partial history so the
// dashboard's "before" state is accurate too.
async function resetSymptomPatientBeforeFinalLog(seed: SeedPatient) {
  const patient = await ensurePatient(seed);
  await prisma.riskAlert.deleteMany({ where: { patientId: patient.id } });
  await prisma.symptomLog.deleteMany({ where: { patientId: patient.id } });

  const setupLogs = seed.logs.slice(0, -1);
  for (const log of setupLogs) {
    await prisma.symptomLog.create({
      data: {
        patientId: patient.id,
        pain: log.pain,
        nausea: log.nausea,
        fatigue: log.fatigue,
        fever: log.fever,
        rawSmsText: log.rawSmsText,
        parsedByAi: log.parsedByAi ?? false,
        source: log.source ?? "PATIENT_SMS",
        createdAt: daysAgo(log.daysAgo),
      },
    });
  }

  const history: DailySymptoms[] = setupLogs
    .slice()
    .sort((a, b) => b.daysAgo - a.daysAgo)
    .map((l) => ({ pain: l.pain, nausea: l.nausea, fatigue: l.fatigue, fever: l.fever, createdAt: daysAgo(l.daysAgo) }));
  const assessment = assessRisk(history);
  await prisma.patient.update({
    where: { id: patient.id },
    data: { riskStatus: assessment.level, riskScore: assessment.modelProb },
  });

  return patient;
}

async function triggerFinalSymptomLog(patientId: string, seed: SeedPatient) {
  const finalLog = seed.logs[seed.logs.length - 1];
  return recordSymptomLog({
    patientId,
    pain: finalLog.pain,
    nausea: finalLog.nausea,
    fatigue: finalLog.fatigue,
    fever: finalLog.fever,
    source: finalLog.source ?? "PATIENT_SMS",
    rawSmsText: finalLog.rawSmsText ?? `${finalLog.pain},${finalLog.nausea},${finalLog.fatigue},${finalLog.fever}`,
    parsedByAi: finalLog.parsedByAi ?? false,
  });
}

async function triggerCaregiverBurdenScenario(seed: SeedPatient) {
  if (!seed.caregiver) throw new Error(`Seed patient ${seed.mrn} has no caregiver to replay.`);

  const patient = await ensurePatient(seed);
  const caregiver = await ensureCaregiver(patient.id, seed);
  if (!caregiver) throw new Error("Caregiver upsert failed unexpectedly.");

  await prisma.riskAlert.deleteMany({ where: { patientId: patient.id, level: "CAREGIVER_BURDEN" } });
  await prisma.caregiverLog.deleteMany({ where: { caregiverId: caregiver.id } });

  // Ruth's own symptom history is untouched by this scenario — only replay
  // her caregiver's check-ins, since the point of this scenario is that
  // caregiver burden is a signal independent of the patient's own trend.
  const setupLogs = seed.caregiver.logs.slice(0, -1);
  for (const log of setupLogs) {
    await prisma.caregiverLog.create({
      data: {
        caregiverId: caregiver.id,
        patientStatus: log.patientStatus,
        copingScore: log.copingScore,
        rawSmsText: log.rawSmsText,
        createdAt: daysAgo(log.daysAgo, 19),
      },
    });
  }

  const finalLog = seed.caregiver.logs[seed.caregiver.logs.length - 1];
  const result = await recordCaregiverLog({
    caregiverId: caregiver.id,
    patientId: patient.id,
    patientStatus: finalLog.patientStatus,
    copingScore: finalLog.copingScore,
    rawSmsText: finalLog.rawSmsText ?? `${finalLog.patientStatus},${finalLog.copingScore}`,
  });

  return { patient, ...result };
}

export interface ScenarioResult {
  scenarioId: string;
  patientId: string;
  patientName: string;
  summary: string;
}

export async function triggerScenario(scenarioId: string): Promise<ScenarioResult> {
  if (!isDemoModeEnabled()) {
    throw new Error("DEMO_MODE is not enabled. Set DEMO_MODE=true in .env to use the fallback demo triggers.");
  }

  switch (scenarioId) {
    case "naquin-fever": {
      const seed = findSeedPatient("OCH-70143");
      const patient = await resetSymptomPatientBeforeFinalLog(seed);
      const assessment = await triggerFinalSymptomLog(patient.id, seed);
      return {
        scenarioId,
        patientId: patient.id,
        patientName: `${seed.firstName} ${seed.lastName}`,
        summary: `Risk escalated to ${assessment.level} (p=${assessment.modelProb.toFixed(2)}): ${assessment.reasons[0] ?? ""}`,
      };
    }
    case "guidry-divergence": {
      const seed = findSeedPatient("OCH-70144");
      const patient = await resetSymptomPatientBeforeFinalLog(seed);
      const assessment = await triggerFinalSymptomLog(patient.id, seed);
      return {
        scenarioId,
        patientId: patient.id,
        patientName: `${seed.firstName} ${seed.lastName}`,
        summary: `Risk escalated to ${assessment.level} (p=${assessment.modelProb.toFixed(2)}) — rules alone would only reach YELLOW here.`,
      };
    }
    case "trahan-burden": {
      const seed = findSeedPatient("OCH-70146");
      const { patient, burdenFlagged } = await triggerCaregiverBurdenScenario(seed);
      return {
        scenarioId,
        patientId: patient.id,
        patientName: `${seed.firstName} ${seed.lastName}`,
        summary: burdenFlagged
          ? "Caregiver burden flagged — separate from Ruth's own clinical risk."
          : "Caregiver check-in logged (coping score above the burden threshold — try again if the fixture data changes).",
      };
    }
    default:
      throw new Error(`Unknown demo scenario id: ${scenarioId}. Valid ids: ${DEMO_SCENARIOS.map((s) => s.id).join(", ")}`);
  }
}
