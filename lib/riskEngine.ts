// Layer 1 — interpretable, rule-based risk flags.
// These are the safety-critical hard stops: transparent, auditable, and independent
// of the trained model in lib/riskModel.ts. Clinical thresholds cited in
// docs/model-calibration.md (PRO-CTCAE grading, neutropenic fever standard).

export type RiskLevel = "GREEN" | "YELLOW" | "RED";

export interface DailySymptoms {
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  createdAt: Date | string;
}

export interface RuleResult {
  level: RiskLevel;
  reasons: string[];
}

const NEUTROPENIC_FEVER_F = 100.4;
const SEVERE_SYMPTOM_THRESHOLD = 8;
const TREND_ESCALATION_DELTA = 3;
const MODERATE_PAIN_NAUSEA_THRESHOLD = 5;
const MODERATE_FATIGUE_THRESHOLD = 7;

/**
 * Evaluate the most recent day's symptoms against interpretable rules.
 * `history` must be chronological (oldest first) and include the day being evaluated as the last entry.
 */
export function evaluateRules(history: DailySymptoms[]): RuleResult {
  if (history.length === 0) {
    return { level: "GREEN", reasons: [] };
  }

  const today = history[history.length - 1];
  const priorTwo = history.slice(-3, -1); // up to 2 days before today
  const reasons: string[] = [];
  let level: RiskLevel = "GREEN";

  const escalate = (candidate: RiskLevel, reason: string) => {
    reasons.push(reason);
    if (severityRank(candidate) > severityRank(level)) {
      level = candidate;
    }
  };

  // RED — fever
  if (today.fever >= NEUTROPENIC_FEVER_F) {
    escalate("RED", `Fever ${today.fever.toFixed(1)}°F ≥ 100.4°F — potential neutropenic fever`);
  }

  // RED — severe acute symptom
  if (today.pain >= SEVERE_SYMPTOM_THRESHOLD) {
    escalate("RED", `Severe pain (${today.pain}/10) — Grade 3/4 PRO-CTCAE range`);
  }
  if (today.nausea >= SEVERE_SYMPTOM_THRESHOLD) {
    escalate("RED", `Severe nausea (${today.nausea}/10) — Grade 3/4 PRO-CTCAE range`);
  }

  // YELLOW — 3-day trend escalation
  if (priorTwo.length > 0) {
    const avgPainPrior = average(priorTwo.map((d) => d.pain));
    const avgNauseaPrior = average(priorTwo.map((d) => d.nausea));
    const painDelta = today.pain - avgPainPrior;
    const nauseaDelta = today.nausea - avgNauseaPrior;

    if (painDelta >= TREND_ESCALATION_DELTA) {
      escalate(
        "YELLOW",
        `Sustained symptom escalation — pain up ${painDelta.toFixed(1)} pts vs. prior ${priorTwo.length}-day avg`
      );
    }
    if (nauseaDelta >= TREND_ESCALATION_DELTA) {
      escalate(
        "YELLOW",
        `Sustained symptom escalation — nausea up ${nauseaDelta.toFixed(1)} pts vs. prior ${priorTwo.length}-day avg`
      );
    }
  }

  // YELLOW — moderate single-day thresholds (only add as a reason if nothing higher fired)
  if (severityRank(level) < severityRank("RED")) {
    if (today.pain >= MODERATE_PAIN_NAUSEA_THRESHOLD) {
      escalate("YELLOW", `Moderate pain (${today.pain}/10)`);
    }
    if (today.nausea >= MODERATE_PAIN_NAUSEA_THRESHOLD) {
      escalate("YELLOW", `Moderate nausea (${today.nausea}/10)`);
    }
    if (today.fatigue >= MODERATE_FATIGUE_THRESHOLD) {
      escalate("YELLOW", `High fatigue (${today.fatigue}/10)`);
    }
  }

  return { level, reasons };
}

function severityRank(level: RiskLevel): number {
  return level === "RED" ? 2 : level === "YELLOW" ? 1 : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
