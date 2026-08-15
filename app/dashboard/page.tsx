import { prisma } from "@/lib/db";
import { DashboardClient, type DashboardPatient } from "./DashboardClient";

export const dynamic = "force-dynamic";

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const patients = await prisma.patient.findMany({
    include: {
      symptomLogs: { orderBy: { createdAt: "asc" } },
      caregiver: { include: { caregiverLogs: { orderBy: { createdAt: "asc" } } } },
      alerts: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const dashboardPatients: DashboardPatient[] = patients.map((p) => {
    const clinicalAlert = p.alerts.find((a) => a.level === "YELLOW" || a.level === "RED");
    const burdenAlert = p.alerts.find((a) => a.level === "CAREGIVER_BURDEN");

    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      parish: p.parish,
      cancerType: p.cancerType,
      chemoCycle: p.chemoCycle,
      riskStatus: p.riskStatus as "GREEN" | "YELLOW" | "RED",
      riskScore: p.riskScore,
      hasCaregiverBurden: !!burdenAlert,
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
    };
  });

  return <DashboardClient patients={dashboardPatients} />;
}
