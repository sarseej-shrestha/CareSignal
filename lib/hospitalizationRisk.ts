// Computes the real 7-day rolling features for one patient from the
// database and runs them through the hospitalization-risk model. This is
// the only place those features are assembled — keep it in sync with
// scripts/train-hospitalization-model.ts's simulated feature semantics
// (lib/hospitalizationFeatures.ts documents each field's exact meaning).

import { prisma } from "./db";
import { predictRiskProbability } from "./riskModel";
import type { DailySymptoms } from "./riskEngine";
import { predictHospitalizationRisk } from "./hospitalizationModel";
import type { HospitalizationInputs } from "./hospitalizationFeatures";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface HospitalizationRiskResult {
  score: number;
  inputs: HospitalizationInputs;
  // False when there's zero symptom-log history in the trailing 7-day
  // window — the model still returns a real number in that case (its
  // learned intercept, not a placeholder), but that number is a population
  // baseline, not a personalized estimate, and looks exactly as precise as
  // any other patient's score unless the UI is told to caveat it. See
  // components/HospitalizationRiskPanel.tsx.
  hasRecentHistory: boolean;
}

export async function computeHospitalizationRisk(patientId: string): Promise<HospitalizationRiskResult> {
  const since = new Date(Date.now() - SEVEN_DAYS_MS);

  const [windowLogs, allLogs, alertCount7d, burdenAlertCount7d] = await Promise.all([
    prisma.symptomLog.findMany({ where: { patientId, createdAt: { gte: since } }, orderBy: { createdAt: "asc" } }),
    prisma.symptomLog.findMany({ where: { patientId }, orderBy: { createdAt: "asc" } }),
    prisma.riskAlert.count({ where: { patientId, level: { in: ["YELLOW", "RED"] }, createdAt: { gte: since } } }),
    prisma.riskAlert.count({ where: { patientId, level: "CAREGIVER_BURDEN", createdAt: { gte: since } } }),
  ]);

  const feverRecurrenceCount7d = windowLogs.filter((l) => l.fever >= 100.4).length;
  const severeDayCount7d = windowLogs.filter((l) => l.pain >= 7 || l.nausea >= 7).length;

  // Largest single-day escalation observed anywhere in the window, each
  // measured against THAT day's own trailing 2-day average (same trend
  // definition as lib/riskEngine.ts's 3-day rule) using the full history,
  // not just the 7-day window, so the very first day in the window can
  // still see its true prior days.
  let maxTrendDelta7d = 0;
  for (const log of windowLogs) {
    const priorTwo = allLogs.filter((l) => l.createdAt < log.createdAt).slice(-2);
    if (priorTwo.length === 0) continue;
    const avgPain = priorTwo.reduce((a, l) => a + l.pain, 0) / priorTwo.length;
    const avgNausea = priorTwo.reduce((a, l) => a + l.nausea, 0) / priorTwo.length;
    maxTrendDelta7d = Math.max(maxTrendDelta7d, log.pain - avgPain, log.nausea - avgNausea);
  }

  // Average of the daily risk model's probability across the window — each
  // day's probability computed from the real history available as of that
  // day, not the full history retroactively.
  let avgDailyModelProb7d = 0;
  if (windowLogs.length > 0) {
    const probs = windowLogs.map((log) => {
      const historyUpToLog: DailySymptoms[] = allLogs
        .filter((l) => l.createdAt <= log.createdAt)
        .map((l) => ({ pain: l.pain, nausea: l.nausea, fatigue: l.fatigue, fever: l.fever, createdAt: l.createdAt }));
      return predictRiskProbability(historyUpToLog);
    });
    avgDailyModelProb7d = probs.reduce((a, b) => a + b, 0) / probs.length;
  }

  const inputs: HospitalizationInputs = {
    alertCount7d,
    feverRecurrenceCount7d,
    severeDayCount7d,
    maxTrendDelta7d,
    avgDailyModelProb7d,
    caregiverBurdenFlag7d: burdenAlertCount7d > 0 ? 1 : 0,
  };

  return { score: predictHospitalizationRisk(inputs), inputs, hasRecentHistory: windowLogs.length > 0 };
}

// Human-readable contributing factors for the hospitalization-risk panel —
// recomputed from the live inputs (not read back from the stored score) so
// the "why" always matches what actually went into the model. Thresholds are
// descriptive, not clinical cutoffs — see docs/model-calibration.md for the
// trained feature weights. Shared by app/dashboard/page.tsx and
// lib/demoScenarios.ts so the /demo walkthrough shows the same real factors
// a nurse would see on the dashboard.
export function hospitalizationFactors(inputs: HospitalizationInputs): string[] {
  const factors: string[] = [];
  if (inputs.caregiverBurdenFlag7d === 1) factors.push("Caregiver burden alert in the past 7 days");
  if (inputs.alertCount7d >= 2) factors.push(`${inputs.alertCount7d} clinical alerts in the past 7 days`);
  if (inputs.feverRecurrenceCount7d >= 1) factors.push(`Fever recurrence on ${inputs.feverRecurrenceCount7d} day(s)`);
  if (inputs.severeDayCount7d >= 2) factors.push(`${inputs.severeDayCount7d} days of near-severe symptoms`);
  if (inputs.maxTrendDelta7d >= 3) factors.push("A sharp single-day symptom escalation this week");
  if (inputs.avgDailyModelProb7d >= 0.3) factors.push("Sustained elevated daily risk across the week");
  return factors;
}
