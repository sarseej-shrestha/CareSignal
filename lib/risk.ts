// Combines Layer 1 (interpretable rules) and Layer 2 (trained classifier) into
// a single assessment. The rule engine sets the safety-critical floor; the
// model's probability can escalate a bucket further, but never silently
// downgrades a rule-triggered flag — interpretability stays in charge of the
// hard stops, the model adds graded, learned signal on top.

import { evaluateRules, type DailySymptoms, type RiskLevel } from "./riskEngine";
import { predictRiskProbability } from "./riskModel";

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  modelProb: number;
}

export function assessRisk(history: DailySymptoms[]): RiskAssessment {
  const rule = evaluateRules(history);
  const modelProb = predictRiskProbability(history);
  const reasons = [...rule.reasons];
  let level = rule.level;

  if (level === "GREEN" && modelProb >= 0.5) {
    level = "YELLOW";
    reasons.push(`Model flagged an emerging risk pattern (p=${modelProb.toFixed(2)}) despite no single rule trigger`);
  } else if (level === "YELLOW" && modelProb >= 0.75) {
    level = "RED";
    reasons.push(`Model probability high (p=${modelProb.toFixed(2)}) — escalating trend flag`);
  }

  return { level, reasons, modelProb };
}
