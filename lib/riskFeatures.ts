// Shared feature extraction — used by both the offline training script
// (scripts/train-risk-model.ts) and the runtime model (lib/riskModel.ts),
// so training and inference can never drift apart.

import type { DailySymptoms } from "./riskEngine";

export const FEATURE_NAMES = [
  "pain",
  "nausea",
  "fatigue",
  "feverElevation",
  "feverSpike",
  "painTrend",
  "nauseaTrend",
] as const;

export type FeatureVector = number[];

/**
 * Build the model's feature vector from a chronological (oldest-first) history
 * of daily symptom logs. The last entry is the day being scored.
 */
export function extractFeatures(history: DailySymptoms[]): FeatureVector {
  if (history.length === 0) {
    return [0, 0, 0, 0, 0, 0, 0];
  }

  const today = history[history.length - 1];
  const priorTwo = history.slice(-3, -1);

  const avgPainPrior = priorTwo.length
    ? priorTwo.reduce((a, d) => a + d.pain, 0) / priorTwo.length
    : today.pain;
  const avgNauseaPrior = priorTwo.length
    ? priorTwo.reduce((a, d) => a + d.nausea, 0) / priorTwo.length
    : today.nausea;

  const feverElevation = Math.max(0, today.fever - 98.6);
  const feverSpike = today.fever >= 100.4 ? 1 : 0;
  const painTrend = today.pain - avgPainPrior;
  const nauseaTrend = today.nausea - avgNauseaPrior;

  return [
    today.pain,
    today.nausea,
    today.fatigue,
    feverElevation,
    feverSpike,
    painTrend,
    nauseaTrend,
  ];
}
