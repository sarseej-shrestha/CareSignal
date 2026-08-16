// Consolidates the daily clinical risk signal and the 7-day hospitalization
// forecast into ONE prioritized notification per patient, instead of a
// nurse having to separately notice/review each. Both signals are still
// computed and displayed distinctly (see docs/model-calibration.md's
// "never merged" principle for the underlying scores/badges) — this layer
// only affects how they're SURFACED for triage: one queue entry, one
// combined priority, both signals visible together when both apply.

export type RiskLevel = "GREEN" | "YELLOW" | "RED";

// Above this, hospitalization risk is treated as "elevated" for
// notification purposes. Set equal to the model's own trained decision
// threshold (HOSP_MODEL_THRESHOLD, 0.5) — NOT a lower value. An earlier
// attempt at 0.35 looked reasonable checked only against the 7 hand-picked
// seed patients (whose model outputs happened to cluster low), but running
// it against the full simulated population (scripts/estimate-alert-volume.ts)
// showed it fires on ~60% of all patient-days — a threshold that low would
// swamp triage, not consolidate it. Documented, not magic: revisit alongside
// any hospitalization-model retrain, and re-run the estimate script rather
// than assuming a threshold checked only against a handful of examples
// generalizes.
export const HOSP_ALERT_THRESHOLD = 0.5;

export type ConsolidatedTier = "DUAL_RED" | "RED" | "DUAL_YELLOW" | "YELLOW" | "HOSP_WATCH" | "NONE";

export interface ConsolidatedNotification {
  tier: ConsolidatedTier;
  dailyLevel: RiskLevel;
  dailyScore: number;
  hospitalizationScore: number;
  hospitalizationElevated: boolean;
  /** Lower = higher priority for the triage queue. */
  priorityRank: number;
}

const PRIORITY_RANK: Record<ConsolidatedTier, number> = {
  DUAL_RED: 0,
  RED: 1,
  DUAL_YELLOW: 2,
  YELLOW: 3,
  HOSP_WATCH: 4,
  NONE: 5,
};

export function consolidateNotification(patient: {
  riskStatus: RiskLevel;
  riskScore: number;
  hospitalizationRiskScore: number;
}): ConsolidatedNotification {
  const hospitalizationElevated = patient.hospitalizationRiskScore >= HOSP_ALERT_THRESHOLD;

  let tier: ConsolidatedTier;
  if (patient.riskStatus === "RED" && hospitalizationElevated) tier = "DUAL_RED";
  else if (patient.riskStatus === "RED") tier = "RED";
  else if (patient.riskStatus === "YELLOW" && hospitalizationElevated) tier = "DUAL_YELLOW";
  else if (patient.riskStatus === "YELLOW") tier = "YELLOW";
  else if (hospitalizationElevated) tier = "HOSP_WATCH";
  else tier = "NONE";

  return {
    tier,
    dailyLevel: patient.riskStatus,
    dailyScore: patient.riskScore,
    hospitalizationScore: patient.hospitalizationRiskScore,
    hospitalizationElevated,
    priorityRank: PRIORITY_RANK[tier],
  };
}

export interface ConsolidatableSortable {
  riskStatus: RiskLevel;
  riskScore: number;
  hospitalizationRiskScore: number;
}

/**
 * Sorts by consolidated priority (dual-signal RED first, ... down to no
 * signal), breaking ties by the combined severity of both scores. Does not
 * mutate the input array.
 */
export function sortByConsolidatedPriority<T extends ConsolidatableSortable>(patients: T[]): T[] {
  return [...patients].sort((a, b) => {
    const ca = consolidateNotification(a);
    const cb = consolidateNotification(b);
    if (ca.priorityRank !== cb.priorityRank) return ca.priorityRank - cb.priorityRank;
    const combinedA = a.riskScore + a.hospitalizationRiskScore;
    const combinedB = b.riskScore + b.hospitalizationRiskScore;
    return combinedB - combinedA;
  });
}
