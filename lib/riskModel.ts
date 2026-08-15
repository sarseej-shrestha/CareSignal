// Layer 2 — trained probabilistic classifier.
//
// Loads coefficients produced offline by scripts/train-risk-model.ts (a logistic
// regression trained on simulated longitudinal symptom data, calibrated to
// published chemotherapy symptom-monitoring escalation base rates). This is a
// genuinely trained model — standardized features, learned weights, class
// rebalancing for recall — not a second set of if/else thresholds. See
// docs/model-calibration.md for training data, metrics, and validation plan.

import coefficients from "./model-coefficients.json";
import { extractFeatures } from "./riskFeatures";
import type { DailySymptoms } from "./riskEngine";

interface ModelCoefficients {
  weights: number[];
  bias: number;
  featureMeans: number[];
  featureStds: number[];
  threshold: number;
}

const model = coefficients as unknown as ModelCoefficients;

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Returns the trained model's escalation-risk probability (0-1) for the most
 * recent day in `history`, given the chronological (oldest-first) symptom log.
 */
export function predictRiskProbability(history: DailySymptoms[]): number {
  if (history.length === 0) return 0;

  const rawFeatures = extractFeatures(history);
  const standardized = rawFeatures.map(
    (v, j) => (v - model.featureMeans[j]) / (model.featureStds[j] || 1)
  );

  const z = model.weights.reduce((sum, w, j) => sum + w * standardized[j], model.bias);
  return sigmoid(z);
}

export const MODEL_THRESHOLD = model.threshold;
