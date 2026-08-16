// Offline trainer for the hospitalization-risk model — a SECOND, separate
// classifier from scripts/train-risk-model.ts. Different question, different
// time horizon: not "what's today's symptom severity" but "how likely is
// this patient to be hospitalized in the next 7 days," built from ROLLING
// 7-day aggregates (cumulative alerts, fever recurrence, sustained trend
// severity, average daily risk, caregiver-burden history) rather than a
// single day's readings.
//
// Simulates at the level of the aggregate features themselves (rather than
// re-simulating raw daily logs and rolling them up, which would mean running
// the daily model thousands of times for no added realism here) — each
// simulated example is one "patient-week" snapshot: the 6 rolling features
// as of some day, and whether a hospitalization event is injected in the
// following 7 days.
//
// Run: npx tsx scripts/train-hospitalization-model.ts
// Output: lib/hospitalization-model-coefficients.json

import { writeFileSync } from "fs";
import { join } from "path";
import { HOSP_FEATURE_NAMES, toFeatureVector, type HospitalizationInputs } from "../lib/hospitalizationFeatures";

let rngState = 1337;
function rng(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randRange(min: number, max: number): number {
  return min + rng() * (max - min);
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface Tier {
  name: string;
  weight: number;
  alertCountRange: [number, number];
  feverRecurrenceRange: [number, number];
  severeDayRange: [number, number];
  trendDeltaRange: [number, number];
  avgDailyProbRange: [number, number];
  baseCaregiverBurdenProb: number;
  baseHospProb: number; // baseline hospitalization probability for this tier before the caregiver-burden boost
}

// Three rolling-window severity tiers, mirroring the daily model's persona
// structure but at the aggregate level: most patient-weeks are low-burden,
// a minority run persistently rockier, and a small minority are actively
// escalating (multiple alerts + fever recurrence + a hard trend spike).
const TIERS: Tier[] = [
  {
    name: "low",
    weight: 0.6,
    alertCountRange: [0, 1],
    feverRecurrenceRange: [0, 0],
    severeDayRange: [0, 1],
    trendDeltaRange: [0, 2],
    avgDailyProbRange: [0, 0.15],
    baseCaregiverBurdenProb: 0.05,
    baseHospProb: 0.01,
  },
  {
    name: "moderate",
    weight: 0.27,
    alertCountRange: [1, 3],
    feverRecurrenceRange: [0, 1],
    severeDayRange: [1, 3],
    trendDeltaRange: [1, 4],
    avgDailyProbRange: [0.15, 0.45],
    baseCaregiverBurdenProb: 0.15,
    baseHospProb: 0.08,
  },
  {
    name: "high",
    weight: 0.13,
    alertCountRange: [3, 7],
    feverRecurrenceRange: [1, 3],
    severeDayRange: [2, 6],
    trendDeltaRange: [3, 7],
    avgDailyProbRange: [0.45, 0.9],
    baseCaregiverBurdenProb: 0.3,
    baseHospProb: 0.3,
  },
];

function pickTier(): Tier {
  const r = rng();
  let cumulative = 0;
  for (const t of TIERS) {
    cumulative += t.weight;
    if (r <= cumulative) return t;
  }
  return TIERS[TIERS.length - 1];
}

// The caregiver-burden flag contributes an INDEPENDENT probability boost on
// top of the tier's baseline — not merely a byproduct of patient severity.
// This encodes the stated reasoning explicitly (see
// lib/hospitalizationFeatures.ts and docs/model-calibration.md): a
// caregiver losing coping capacity is treated as its own leading indicator,
// not a restatement of how sick the patient already looks on paper.
const CAREGIVER_BURDEN_HOSP_BOOST = 0.12;

interface TrainingExample {
  features: number[];
  label: number;
}

function simulateExample(): TrainingExample {
  const tier = pickTier();
  const inputs: HospitalizationInputs = {
    alertCount7d: Math.round(randRange(...tier.alertCountRange)),
    feverRecurrenceCount7d: Math.round(randRange(...tier.feverRecurrenceRange)),
    severeDayCount7d: Math.round(randRange(...tier.severeDayRange)),
    maxTrendDelta7d: clamp(randRange(...tier.trendDeltaRange), 0, 10),
    avgDailyModelProb7d: clamp(randRange(...tier.avgDailyProbRange), 0, 1),
    caregiverBurdenFlag7d: rng() < tier.baseCaregiverBurdenProb ? 1 : 0,
  };

  const hospProb = clamp(
    tier.baseHospProb + inputs.caregiverBurdenFlag7d * CAREGIVER_BURDEN_HOSP_BOOST,
    0,
    0.97
  );
  let label = rng() < hospProb ? 1 : 0;
  if (rng() < 0.02) label = 1 - label; // small label noise, same rationale as the daily model

  return { features: toFeatureVector(inputs), label };
}

function generateDataset(n: number): TrainingExample[] {
  return Array.from({ length: n }, () => simulateExample());
}

function standardize(dataset: TrainingExample[]) {
  const nFeatures = HOSP_FEATURE_NAMES.length;
  const means = new Array(nFeatures).fill(0);
  const stds = new Array(nFeatures).fill(0);
  for (const ex of dataset) for (let j = 0; j < nFeatures; j++) means[j] += ex.features[j];
  for (let j = 0; j < nFeatures; j++) means[j] /= dataset.length;
  for (const ex of dataset) for (let j = 0; j < nFeatures; j++) stds[j] += (ex.features[j] - means[j]) ** 2;
  for (let j = 0; j < nFeatures; j++) stds[j] = Math.sqrt(stds[j] / dataset.length) || 1;

  const standardized = dataset.map((ex) => ({
    features: ex.features.map((v, j) => (v - means[j]) / stds[j]),
    label: ex.label,
  }));
  return { standardized, means, stds };
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function trainLogisticRegression(dataset: TrainingExample[], epochs: number, lr: number, l2: number) {
  const nFeatures = dataset[0].features.length;
  let weights = new Array(nFeatures).fill(0);
  let bias = 0;
  const n = dataset.length;

  const nPos = dataset.filter((ex) => ex.label === 1).length;
  const nNeg = n - nPos;
  const posWeight = Math.min(6, nNeg / Math.max(1, nPos));

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(nFeatures).fill(0);
    let gradB = 0;
    for (const ex of dataset) {
      const z = weights.reduce((sum, w, j) => sum + w * ex.features[j], bias);
      const pred = sigmoid(z);
      const sampleWeight = ex.label === 1 ? posWeight : 1;
      const error = sampleWeight * (pred - ex.label);
      for (let j = 0; j < nFeatures; j++) gradW[j] += error * ex.features[j];
      gradB += error;
    }
    for (let j = 0; j < nFeatures; j++) weights[j] -= lr * (gradW[j] / n + l2 * weights[j]);
    bias -= lr * (gradB / n);
  }
  return { weights, bias, posWeight };
}

function evaluate(dataset: { features: number[]; label: number }[], weights: number[], bias: number) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (const ex of dataset) {
    const z = weights.reduce((sum, w, j) => sum + w * ex.features[j], bias);
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === 1 && ex.label === 1) tp++;
    else if (pred === 1 && ex.label === 0) fp++;
    else if (pred === 0 && ex.label === 0) tn++;
    else fn++;
  }
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const accuracy = (tp + tn) / dataset.length;
  const positiveRate = (tp + fn) / dataset.length;
  return { tp, fp, tn, fn, precision, recall, accuracy, positiveRate };
}

function main() {
  console.log("Simulating hospitalization-risk training data...");
  const nExamples = 20000;
  const fullDataset = generateDataset(nExamples);
  const positiveRate = fullDataset.filter((e) => e.label === 1).length / fullDataset.length;
  console.log(`Generated ${fullDataset.length} patient-week examples. Positive (hospitalization) rate: ${(positiveRate * 100).toFixed(1)}%`);

  const shuffled = [...fullDataset].sort(() => rng() - 0.5);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainRaw = shuffled.slice(0, splitIdx);
  const testRaw = shuffled.slice(splitIdx);

  const { standardized: trainStd, means, stds } = standardize(trainRaw);
  const testStd = testRaw.map((ex) => ({ features: ex.features.map((v, j) => (v - means[j]) / stds[j]), label: ex.label }));

  console.log("Training logistic regression...");
  const { weights, bias, posWeight } = trainLogisticRegression(trainStd, 800, 0.5, 0.0005);
  console.log(`Positive-class weight used: ${posWeight.toFixed(2)}`);

  const trainMetrics = evaluate(trainStd, weights, bias);
  const testMetrics = evaluate(testStd, weights, bias);
  console.log("\n--- Train metrics ---", trainMetrics);
  console.log("\n--- Test metrics (held out) ---", testMetrics);

  console.log("\n--- Feature weights (standardized) ---");
  HOSP_FEATURE_NAMES.forEach((name, j) => console.log(`  ${name}: ${weights[j].toFixed(3)}`));

  const output = {
    trainedAt: new Date().toISOString(),
    featureNames: HOSP_FEATURE_NAMES,
    weights,
    bias,
    featureMeans: means,
    featureStds: stds,
    threshold: 0.5,
    trainingMeta: {
      nExamples,
      positiveRate,
      testMetrics,
      caregiverBurdenHospBoost: CAREGIVER_BURDEN_HOSP_BOOST,
    },
  };

  const outPath = join(__dirname, "..", "lib", "hospitalization-model-coefficients.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote coefficients to ${outPath}`);
}

main();
