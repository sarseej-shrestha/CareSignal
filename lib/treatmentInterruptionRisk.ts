// Flags when a LOGISTICAL care need (see lib/needCategory.ts) could risk
// interrupting an upcoming treatment — WITHOUT inventing a specific
// appointment date. This repository has no scheduling data (no next-
// appointment date anywhere in the schema), only Patient.treatmentFrequency
// (weekly/every_2_weeks/every_3_weeks/monthly — the same real, structured
// field lib/transportationResources.ts already uses to decide whether
// transportation is a recurring barrier for a given patient). Reusing that
// exact signal here: a logistical problem for a patient on a frequent
// regimen is genuinely more likely to land on or near a real treatment day
// than for a patient on a monthly one. This is a real, derived inference
// from real data, not a fabricated schedule.

import type { TreatmentFrequency } from "./transportationResources";

const FREQUENT_ENOUGH_TO_FLAG: ReadonlySet<TreatmentFrequency> = new Set(["weekly", "every_2_weeks"]);

export interface InterruptionRiskResult {
  atRisk: boolean;
  reason: string | null;
}

export function checkTreatmentInterruptionRisk(treatmentFrequency: TreatmentFrequency): InterruptionRiskResult {
  if (!FREQUENT_ENOUGH_TO_FLAG.has(treatmentFrequency)) {
    return { atRisk: false, reason: null };
  }

  const frequencyLabel = treatmentFrequency === "weekly" ? "about weekly" : "about every 2 weeks";
  return {
    atRisk: true,
    reason: `This patient's treatment schedule is ${frequencyLabel} — a logistical barrier like this could interrupt an upcoming treatment, not just delay a single check-in.`,
  };
}
