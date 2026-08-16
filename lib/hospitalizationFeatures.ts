// Feature definition for the hospitalization-risk model — a SEPARATE model
// from the daily riskModel.ts, with a different time horizon (7-day
// forecast, not "today") and a different claim (probability of
// hospitalization, not a symptom-severity bucket). Shared between the
// offline trainer (scripts/train-hospitalization-model.ts) and the runtime
// feature computation (lib/hospitalizationRisk.ts) so they can't drift.

export const HOSP_FEATURE_NAMES = [
  "alertCount7d",
  "feverRecurrenceCount7d",
  "severeDayCount7d",
  "maxTrendDelta7d",
  "avgDailyModelProb7d",
  "caregiverBurdenFlag7d",
] as const;

export interface HospitalizationInputs {
  /** Count of OPEN clinical (YELLOW/RED) RiskAlerts in the trailing 7 days — cumulative alert burden, not just today's status. */
  alertCount7d: number;
  /** Count of distinct days with fever >= 100.4°F in the trailing 7 days — recurrence, not a single spike. */
  feverRecurrenceCount7d: number;
  /** Count of days with pain or nausea >= 7 in the trailing 7 days — sustained near-severe symptom burden. */
  severeDayCount7d: number;
  /** Largest single-day pain/nausea escalation (vs. that day's own prior-2-day average) observed anywhere in the window. */
  maxTrendDelta7d: number;
  /** Average of the daily risk model's probability across the trailing 7 days — sustained elevated day-to-day risk, not just a peak. */
  avgDailyModelProb7d: number;
  /**
   * Whether a CAREGIVER_BURDEN alert fired for this patient's caregiver in
   * the trailing 7 days (0 or 1). Included as a leading indicator: a
   * caregiver who is losing the capacity to cope is a defensible proxy for
   * reduced care-seeking and symptom-management support at home, which is a
   * plausible independent contributor to hospitalization risk — not merely
   * a restatement of the patient's own symptom severity. See
   * docs/model-calibration.md for the explicit reasoning and how the
   * simulated training data encodes it as a standalone (not purely
   * correlated) signal.
   */
  caregiverBurdenFlag7d: number;
}

export function toFeatureVector(inputs: HospitalizationInputs): number[] {
  return [
    inputs.alertCount7d,
    inputs.feverRecurrenceCount7d,
    inputs.severeDayCount7d,
    inputs.maxTrendDelta7d,
    inputs.avgDailyModelProb7d,
    inputs.caregiverBurdenFlag7d,
  ];
}
