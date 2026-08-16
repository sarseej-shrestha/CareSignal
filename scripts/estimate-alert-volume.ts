// Computes real numbers for docs/alert-volume-analysis.md by running the
// SAME independent simulator + the ACTUAL trained daily and hospitalization
// models (not hand-estimated guesses) over a large simulated sample, and
// tabulating how often each signal fires, alone and together.
//
// Run: npx tsx scripts/estimate-alert-volume.ts

import { simulateIndependentTimeline } from "../lib/independentPatientSimulator";
import { assessRisk } from "../lib/risk";
import { predictHospitalizationRisk } from "../lib/hospitalizationModel";
import type { HospitalizationInputs } from "../lib/hospitalizationFeatures";
import type { DailySymptoms } from "../lib/riskEngine";
import { HOSP_ALERT_THRESHOLD, consolidateNotification } from "../lib/alertConsolidation";

const WINDOW = 7;

interface DayResult {
  dailyLevel: "GREEN" | "YELLOW" | "RED";
  dailyScore: number;
  hospScore: number;
}

function evaluatePatient(seed: number, numDays: number): DayResult[] {
  const { days } = simulateIndependentTimeline(seed, numDays);

  const history: DailySymptoms[] = [];
  const dailyLevel: ("GREEN" | "YELLOW" | "RED")[] = [];
  const dailyModelProb: number[] = [];

  for (const day of days) {
    history.push({ pain: day.pain, nausea: day.nausea, fatigue: day.fatigue, fever: day.fever, createdAt: new Date() });
    const assessment = assessRisk(history);
    dailyLevel.push(assessment.level);
    dailyModelProb.push(assessment.modelProb);
  }

  const results: DayResult[] = [];

  for (let t = WINDOW - 1; t < days.length; t++) {
    const windowStart = t - (WINDOW - 1);
    let alertCount7d = 0;
    let feverRecurrenceCount7d = 0;
    let severeDayCount7d = 0;
    let maxTrendDelta7d = 0;
    let modelProbSum = 0;
    let burdenFlag = 0;

    for (let d = windowStart; d <= t; d++) {
      if (dailyLevel[d] === "YELLOW" || dailyLevel[d] === "RED") alertCount7d++;
      if (days[d].fever >= 100.4) feverRecurrenceCount7d++;
      if (days[d].pain >= 7 || days[d].nausea >= 7) severeDayCount7d++;
      modelProbSum += dailyModelProb[d];
      if (days[d].copingScore <= 2) burdenFlag = 1;

      const priorTwo = days.slice(Math.max(0, d - 2), d);
      if (priorTwo.length > 0) {
        const avgPain = priorTwo.reduce((a, l) => a + l.pain, 0) / priorTwo.length;
        const avgNausea = priorTwo.reduce((a, l) => a + l.nausea, 0) / priorTwo.length;
        maxTrendDelta7d = Math.max(maxTrendDelta7d, days[d].pain - avgPain, days[d].nausea - avgNausea);
      }
    }

    const inputs: HospitalizationInputs = {
      alertCount7d,
      feverRecurrenceCount7d,
      severeDayCount7d,
      maxTrendDelta7d,
      avgDailyModelProb7d: modelProbSum / WINDOW,
      caregiverBurdenFlag7d: burdenFlag,
    };

    results.push({
      dailyLevel: dailyLevel[t],
      dailyScore: dailyModelProb[t],
      hospScore: predictHospitalizationRisk(inputs),
    });
  }

  return results;
}

function main() {
  const nPatients = 2000;
  const daysPerPatient = 30;
  console.log(`Simulating ${nPatients} independent patients x ${daysPerPatient} days...`);

  let totalDays = 0;
  let dailyAlertDays = 0;
  let hospElevatedDays = 0;
  let dualDays = 0;
  let dailyOnlyDays = 0;
  let hospOnlyDays = 0;
  let noneDays = 0;

  for (let i = 0; i < nPatients; i++) {
    const results = evaluatePatient(900_000 + i * 131, daysPerPatient);
    for (const r of results) {
      totalDays++;
      const dailyAlert = r.dailyLevel === "YELLOW" || r.dailyLevel === "RED";
      const hospElevated = r.hospScore >= HOSP_ALERT_THRESHOLD;
      if (dailyAlert) dailyAlertDays++;
      if (hospElevated) hospElevatedDays++;

      const consolidated = consolidateNotification({
        riskStatus: r.dailyLevel,
        riskScore: r.dailyScore,
        hospitalizationRiskScore: r.hospScore,
      });
      if (consolidated.tier === "DUAL_RED" || consolidated.tier === "DUAL_YELLOW") dualDays++;
      else if (consolidated.tier === "RED" || consolidated.tier === "YELLOW") dailyOnlyDays++;
      else if (consolidated.tier === "HOSP_WATCH") hospOnlyDays++;
      else noneDays++;
    }
  }

  const pct = (n: number) => ((n / totalDays) * 100).toFixed(2) + "%";

  console.log(`\nTotal simulated patient-days: ${totalDays}`);
  console.log(`Daily clinical alert (YELLOW/RED) rate: ${pct(dailyAlertDays)}`);
  console.log(`Hospitalization-elevated (>= ${HOSP_ALERT_THRESHOLD}) rate: ${pct(hospElevatedDays)}`);
  console.log(`\n--- Consolidated notification breakdown ---`);
  console.log(`Dual-signal (both fired):     ${pct(dualDays)}`);
  console.log(`Daily-only:                   ${pct(dailyOnlyDays)}`);
  console.log(`Hospitalization-watch-only:   ${pct(hospOnlyDays)}`);
  console.log(`No signal:                    ${pct(noneDays)}`);

  console.log(`\n--- Panel-size projections (one check-in/patient/day) ---`);
  for (const panelSize of [50, 75, 100]) {
    const unconsolidated = (dailyAlertDays / totalDays) * panelSize + (hospElevatedDays / totalDays) * panelSize;
    const consolidatedTotal = ((dualDays + dailyOnlyDays + hospOnlyDays) / totalDays) * panelSize;
    const dual = (dualDays / totalDays) * panelSize;
    const dailyOnly = (dailyOnlyDays / totalDays) * panelSize;
    const hospOnly = (hospOnlyDays / totalDays) * panelSize;
    console.log(
      `Panel of ${panelSize}: ~${consolidatedTotal.toFixed(1)} consolidated notifications/day (${dual.toFixed(1)} dual-signal, ${dailyOnly.toFixed(1)} daily-only, ${hospOnly.toFixed(1)} hosp-watch-only) vs. ~${unconsolidated.toFixed(1)} if the two signals were reviewed as separate items`
    );
  }
}

main();
