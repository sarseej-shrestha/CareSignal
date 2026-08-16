// Runtime inference for the hospitalization-risk model. Loads coefficients
// trained offline by scripts/train-hospitalization-model.ts. Same
// standardize-then-sigmoid pattern as lib/riskModel.ts, but a genuinely
// separate model — different features (rolling 7-day aggregates, not a
// single day + 3-day trend), different question (hospitalization within 7
// days, not today's symptom severity), never merged into riskStatus/riskScore.

import coefficients from "./hospitalization-model-coefficients.json";
import { toFeatureVector, type HospitalizationInputs } from "./hospitalizationFeatures";

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

export function predictHospitalizationRisk(inputs: HospitalizationInputs): number {
  const raw = toFeatureVector(inputs);
  const standardized = raw.map((v, j) => (v - model.featureMeans[j]) / (model.featureStds[j] || 1));
  const z = model.weights.reduce((sum, w, j) => sum + w * standardized[j], model.bias);
  return sigmoid(z);
}

export const HOSP_MODEL_THRESHOLD = model.threshold;
