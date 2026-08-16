// Shared inbound-message handling: recording logs, recomputing risk, and
// firing alerts. Used by the Twilio webhook (app/api/twilio/inbound/route.ts)
// so the same logic backs both a live SMS and any simulated/demo inbound call.

import { prisma } from "./db";
import { assessRisk, type RiskAssessment } from "./risk";
import type { DailySymptoms } from "./riskEngine";

export type LogSource = "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB";

export async function recordSymptomLog(params: {
  patientId: string;
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  source: LogSource;
  rawSmsText?: string | null;
  parsedByAi?: boolean;
}): Promise<RiskAssessment> {
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
    },
  });

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

  return assessment;
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

  if (params.copingScore > 2) {
    return { burdenFlagged: false };
  }

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

  return { burdenFlagged: true };
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

const STRUCTURED_SYMPTOM_RE = /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/;
const STRUCTURED_CAREGIVER_RE = /^(\d+)\s*,\s*(\d+)$/;

export function parseStructuredSymptoms(
  text: string
): { pain: number; nausea: number; fatigue: number; fever: number } | null {
  const match = text.trim().match(STRUCTURED_SYMPTOM_RE);
  if (!match) return null;
  const [, pain, nausea, fatigue, fever] = match;
  return { pain: Number(pain), nausea: Number(nausea), fatigue: Number(fatigue), fever: Number(fever) };
}

export function parseStructuredCaregiverCheckin(
  text: string
): { patientStatus: number; copingScore: number } | null {
  const match = text.trim().match(STRUCTURED_CAREGIVER_RE);
  if (!match) return null;
  const [, patientStatus, copingScore] = match;
  return { patientStatus: Number(patientStatus), copingScore: Number(copingScore) };
}
