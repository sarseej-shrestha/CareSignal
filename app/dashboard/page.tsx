import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { computeHospitalizationRisk, hospitalizationFactors } from "@/lib/hospitalizationRisk";
import { DashboardClient, type DashboardPatient } from "./DashboardClient";

export const metadata: Metadata = {
  title: "Nurse triage dashboard — CareSignal",
  description: "SMS-first remote symptom monitoring for rural Louisiana cancer care.",
};

export const dynamic = "force-dynamic";

// Every RiskAlert.level that represents a care need routed OUTSIDE the
// clinical YELLOW/RED pathway — see lib/needCategory.ts for the
// classification these come from, and lib/safetyGate.ts for SAFETY
// specifically (a deterministic gate, not an LLM-classified category, but
// surfaced through the same alert mechanism since it's the same "needs a
// human, isn't a symptom score" shape).
const CARE_NEED_LEVELS = ["LOGISTICAL", "EMOTIONAL", "FINANCIAL", "UNCERTAIN", "SAFETY"];

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const { patient: initialSelectedId } = await searchParams;
  const patients = await prisma.patient.findMany({
    include: {
      symptomLogs: { orderBy: { createdAt: "asc" } },
      caregiver: { include: { caregiverLogs: { orderBy: { createdAt: "asc" } } } },
      alerts: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const hospResults = await Promise.all(patients.map((p) => computeHospitalizationRisk(p.id)));

  const dashboardPatients: DashboardPatient[] = patients.map((p, idx) => {
    const clinicalAlert = p.alerts.find((a) => a.level === "YELLOW" || a.level === "RED");
    const burdenAlert = p.alerts.find((a) => a.level === "CAREGIVER_BURDEN");
    const careNeedAlerts = p.alerts.filter((a) => CARE_NEED_LEVELS.includes(a.level) && a.status === "OPEN");
    const hosp = hospResults[idx];

    return {
      id: p.id,
      mrn: p.mrn,
      firstName: p.firstName,
      lastName: p.lastName,
      parish: p.parish,
      cancerType: p.cancerType,
      chemoCycle: p.chemoCycle,
      treatmentFrequency: p.treatmentFrequency as "weekly" | "every_2_weeks" | "every_3_weeks" | "monthly",
      riskStatus: p.riskStatus as "GREEN" | "YELLOW" | "RED",
      riskScore: p.riskScore,
      hasCaregiverBurden: !!burdenAlert,
      hasOpenCareNeed: careNeedAlerts.length > 0,
      hospitalizationRiskScore: hosp.score,
      hospitalizationRiskFactors: hospitalizationFactors(hosp.inputs),
      hospitalizationHasRecentHistory: hosp.hasRecentHistory,
      reasons: clinicalAlert ? (JSON.parse(clinicalAlert.reasons) as string[]) : [],
      logs: p.symptomLogs.map((log) => ({
        date: log.createdAt.toISOString(),
        label: formatDateLabel(log.createdAt),
        pain: log.pain,
        nausea: log.nausea,
        fatigue: log.fatigue,
        fever: log.fever,
        source: log.source as "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB",
        parsedByAi: log.parsedByAi,
      })),
      rawLogs: p.symptomLogs
        .slice()
        .reverse()
        .map((log) => ({
          id: log.id,
          dateLabel: formatDateLabel(log.createdAt),
          pain: log.pain,
          nausea: log.nausea,
          fatigue: log.fatigue,
          fever: log.fever,
          source: log.source as "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB",
          parsedByAi: log.parsedByAi,
          rawSmsText: log.rawSmsText,
        })),
      caregiver: p.caregiver
        ? {
            firstName: p.caregiver.firstName,
            lastName: p.caregiver.lastName,
            relationship: p.caregiver.relationship,
            logs: p.caregiver.caregiverLogs
              .slice()
              .reverse()
              .map((log) => ({
                id: log.id,
                dateLabel: formatDateLabel(log.createdAt),
                patientStatus: log.patientStatus,
                copingScore: log.copingScore,
                rawSmsText: log.rawSmsText,
              })),
          }
        : null,
      caregiverBurdenReasons: burdenAlert ? (JSON.parse(burdenAlert.reasons) as string[]) : null,
      careNeeds: careNeedAlerts.map((a) => ({
        id: a.id,
        category: a.level,
        reasons: JSON.parse(a.reasons) as string[],
        status: a.status,
        dateLabel: formatDateLabel(a.createdAt),
      })),
    };
  });

  return (
    <DashboardClient
      patients={dashboardPatients}
      demoModeEnabled={process.env.DEMO_MODE === "true"}
      initialSelectedId={initialSelectedId ?? null}
    />
  );
}
