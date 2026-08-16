import { prisma } from "@/lib/db";
import { computeHospitalizationRisk } from "@/lib/hospitalizationRisk";
import type { HospitalizationInputs } from "@/lib/hospitalizationFeatures";
import { DashboardClient, type DashboardPatient } from "./DashboardClient";

// Human-readable contributing factors for the hospitalization-risk panel —
// recomputed here (not read back from the stored score) so the "why" always
// matches the live inputs, same spirit as RiskBadge's reasons list but for
// a different model/question. Thresholds are descriptive, not clinical
// cutoffs — see docs/model-calibration.md for the trained feature weights.
function hospitalizationFactors(inputs: HospitalizationInputs): string[] {
  const factors: string[] = [];
  if (inputs.caregiverBurdenFlag7d === 1) factors.push("Caregiver burden alert in the past 7 days");
  if (inputs.alertCount7d >= 2) factors.push(`${inputs.alertCount7d} clinical alerts in the past 7 days`);
  if (inputs.feverRecurrenceCount7d >= 1) factors.push(`Fever recurrence on ${inputs.feverRecurrenceCount7d} day(s)`);
  if (inputs.severeDayCount7d >= 2) factors.push(`${inputs.severeDayCount7d} days of near-severe symptoms`);
  if (inputs.maxTrendDelta7d >= 3) factors.push("A sharp single-day symptom escalation this week");
  if (inputs.avgDailyModelProb7d >= 0.3) factors.push("Sustained elevated daily risk across the week");
  return factors;
}

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

  const hospResults = await Promise.all(patients.map((p) => computeHospitalizationRisk(p.id)));

  const dashboardPatients: DashboardPatient[] = patients.map((p, idx) => {
    const clinicalAlert = p.alerts.find((a) => a.level === "YELLOW" || a.level === "RED");
    const burdenAlert = p.alerts.find((a) => a.level === "CAREGIVER_BURDEN");
    const hosp = hospResults[idx];

    return {
      id: p.id,
      mrn: p.mrn,
      firstName: p.firstName,
      lastName: p.lastName,
      parish: p.parish,
      cancerType: p.cancerType,
      chemoCycle: p.chemoCycle,
      riskStatus: p.riskStatus as "GREEN" | "YELLOW" | "RED",
      riskScore: p.riskScore,
      hasCaregiverBurden: !!burdenAlert,
      hospitalizationRiskScore: hosp.score,
      hospitalizationRiskFactors: hospitalizationFactors(hosp.inputs),
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

  return <DashboardClient patients={dashboardPatients} demoModeEnabled={process.env.DEMO_MODE === "true"} />;
}
