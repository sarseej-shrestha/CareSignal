import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { computeHospitalizationRisk, hospitalizationFactors } from "@/lib/hospitalizationRisk";
import { computeClinicalSnapshot } from "@/lib/clinicalSnapshot";
import { selectAlert } from "@/lib/selectAlert";
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

function formatDateTimeLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
      communications: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const hospResults = await Promise.all(patients.map((p) => computeHospitalizationRisk(p.id)));

  const dashboardPatients: DashboardPatient[] = patients.map((p, idx) => {
    // See lib/selectAlert.ts for why this isn't a plain .find() anymore.
    const clinicalAlert = selectAlert(p.alerts, (level) => level === "YELLOW" || level === "RED");
    const burdenAlert = selectAlert(p.alerts, (level) => level === "CAREGIVER_BURDEN");
    // Stays visible through OPEN -> ACKNOWLEDGED so claiming it doesn't make
    // it vanish before it's actually done — only RESOLVED drops it off the
    // active queue (hasOpenCareNeed below reflects the same "not resolved
    // yet" definition, not just "brand new").
    const careNeedAlerts = p.alerts.filter((a) => CARE_NEED_LEVELS.includes(a.level) && a.status !== "RESOLVED");
    const hosp = hospResults[idx];

    return {
      id: p.id,
      mrn: p.mrn,
      firstName: p.firstName,
      lastName: p.lastName,
      parish: p.parish,
      cancerType: p.cancerType,
      chemoCycle: p.chemoCycle,
      // Reused as-is from the existing outbound-SMS language field
      // (lib/i18n.ts) — not a new detection system. Only drives whether the
      // clinician-facing "Translate to English" control renders on the
      // "what happened" card; see components/TranslateMessage.tsx.
      preferredLanguage: p.preferredLanguage,
      treatmentFrequency: p.treatmentFrequency as "weekly" | "every_2_weeks" | "every_3_weeks" | "monthly",
      riskStatus: p.riskStatus as "GREEN" | "YELLOW" | "RED",
      riskScore: p.riskScore,
      hasCaregiverBurden: !!burdenAlert,
      hasOpenCareNeed: careNeedAlerts.length > 0,
      hospitalizationRiskScore: hosp.score,
      hospitalizationRiskFactors: hospitalizationFactors(hosp.inputs),
      hospitalizationHasRecentHistory: hosp.hasRecentHistory,
      reasons: clinicalAlert ? (JSON.parse(clinicalAlert.reasons) as string[]) : [],
      clinicalAlertId: clinicalAlert?.id ?? null,
      clinicalAlertStatus: clinicalAlert?.status ?? null,
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
          date: log.createdAt.toISOString(),
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
                date: log.createdAt.toISOString(),
                dateLabel: formatDateLabel(log.createdAt),
                patientStatus: log.patientStatus,
                copingScore: log.copingScore,
                rawSmsText: log.rawSmsText,
              })),
          }
        : null,
      clinicalSnapshot: computeClinicalSnapshot(p.symptomLogs, formatDateLabel),
      caregiverBurdenReasons: burdenAlert ? (JSON.parse(burdenAlert.reasons) as string[]) : null,
      burdenAlertId: burdenAlert?.id ?? null,
      burdenAlertStatus: burdenAlert?.status ?? null,
      careNeeds: careNeedAlerts.map((a) => ({
        id: a.id,
        category: a.level,
        reasons: JSON.parse(a.reasons) as string[],
        status: a.status,
        dateLabel: formatDateLabel(a.createdAt),
      })),
      communications: p.communications.map((m) => ({
        id: m.id,
        participant: m.participant as "PATIENT" | "CAREGIVER",
        direction: m.direction as "INBOUND" | "OUTBOUND",
        body: m.body,
        status: m.status,
        sentByName: m.sentByName,
        dateLabel: formatDateTimeLabel(m.createdAt),
      })),
      // Whichever participant most recently texted IN — the sensible
      // default for "who is this reply to" (see components/ReplyComposer.tsx),
      // overridable by the clinician via its own toggle when a caregiver
      // exists. Falls back to PATIENT when there's no inbound history yet.
      lastInboundParticipant:
        p.communications
          .slice()
          .reverse()
          .find((m) => m.direction === "INBOUND")?.participant === "CAREGIVER"
          ? "CAREGIVER"
          : "PATIENT",
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
