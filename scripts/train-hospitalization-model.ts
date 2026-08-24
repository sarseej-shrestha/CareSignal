// Offline trainer for the hospitalization-risk model — rewritten to remove
// training-data circularity with the daily risk model (see
// lib/independentPatientSimulator.ts for the full rationale).
//
// Raw day-by-day patient timelines come from a genuinely independent
// simulator (different RNG algorithm, continuous hidden-state dynamics
// instead of discrete severity tiers, a hospitalization ground-truth
// process that doesn't reference the daily model at all). This script then
// derives every 7-day rolling feature — including avgDailyModelProb7d — by
// actually running those raw simulated logs through the REAL,
// already-independently-trained daily risk engine (lib/risk.ts) and
// classifier (lib/riskModel.ts), exactly as production does. That's
// legitimate reuse of a fixed, already-trained artifact, not the
// circularity being fixed — the circularity was in how the RAW DATA and
// the HOSPITALIZATION LABEL were generated, not in reusing real feature-
// computation logic.
//
// Run: npx tsx scripts/train-hospitalization-model.ts
// Output: lib/hospitalization-model-coefficients.json

import { writeFileSync } from "fs";
import { join } from "path";
import { HOSP_FEATURE_NAMES, toFeatureVector, type HospitalizationInputs } from "../lib/hospitalizationFeatures";
import { assessRisk } from "../lib/risk";
import type { DailySymptoms } from "../lib/riskEngine";
import { simulateIndependentTimeline } from "../lib/independentPatientSimulator";

interface TrainingExample {
  features: number[];
  label: number;
}

const WINDOW = 7;

function buildExamplesForPatient(seed: number, numDays: number): TrainingExample[] {
  const { days, hospitalizedOnsetDay } = simulateIndependentTimeline(seed, numDays);

  // Walk forward once, computing the REAL daily assessment (rules + trained
  // classifier) for each day from the history available as of that day —
  // exactly what recordSymptomLog does live. Cached per day so each 7-day
  // window just looks these up instead of recomputing.
  const history: DailySymptoms[] = [];
  const dailyLevel: ("GREEN" | "YELLOW" | "RED")[] = [];
  const dailyModelProb: number[] = [];

  for (const day of days) {
    history.push({ pain: day.pain, nausea: day.nausea, fatigue: day.fatigue, fever: day.fever, createdAt: new Date() });
    const assessment = assessRisk(history);
    dailyLevel.push(assessment.level);
    dailyModelProb.push(assessment.modelProb);
  }

  const examples: TrainingExample[] = [];

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

      // Same trend definition as lib/hospitalizationRisk.ts: each day
      // compared against ITS OWN trailing 2-day average, using the full
      // history up to that day (not clipped to the current 7-day window).
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

    // Ground truth: did the INDEPENDENT hidden-state process hospitalize
    // this patient within the 7 days AFTER day t? No reference to
    // dailyLevel/dailyModelProb here — that's the whole point.
    const label = hospitalizedOnsetDay !== null && hospitalizedOnsetDay > t && hospitalizedOnsetDay <= t + WINDOW ? 1 : 0;

    examples.push({ features: toFeatureVector(inputs), label });
  }

  return examples;
}

function generateDataset(nPatients: number, daysPerPatient: number): TrainingExample[] {
  const dataset: TrainingExample[] = [];
  for (let i = 0; i < nPatients; i++) {
    // Distinct seed per patient, offset from the daily model's training
    // seed range (42) and the original hospitalization trainer's seed
    // (1337) so there's no accidental overlap in the PRNG's state space.
    dataset.push(...buildExamplesForPatient(500_000 + i * 97, daysPerPatient));
  }
  return dataset;
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
  const posWeight = Math.min(8, nNeg / Math.max(1, nPos));

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

// Deterministic shuffle, separate from the training loop's own RNG concerns
// (this is just for the train/test split, not part of the simulation).
function shuffle<T>(arr: T[], seed: number): T[] {
  let state = seed || 12345;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function main() {
  console.log("Simulating hospitalization-risk training data from the INDEPENDENT simulator...");
  const nPatients = 6000;
  const daysPerPatient = 35;
  const fullDataset = generateDataset(nPatients, daysPerPatient);
  const positiveRate = fullDataset.filter((e) => e.label === 1).length / fullDataset.length;
  console.log(`Generated ${fullDataset.length} patient-day examples from ${nPatients} independently-simulated patients.`);
  console.log(`Positive (hospitalization) rate: ${(positiveRate * 100).toFixed(1)}%`);

  const shuffled = shuffle(fullDataset, 777);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainRaw = shuffled.slice(0, splitIdx);
  const testRaw = shuffled.slice(splitIdx);

  const { standardized: trainStd, means, stds } = standardize(trainRaw);
  const testStd = testRaw.map((ex) => ({ features: ex.features.map((v, j) => (v - means[j]) / stds[j]), label: ex.label }));

  console.log("Training logistic regression...");
  const { weights, bias, posWeight } = trainLogisticRegression(trainStd, 400, 0.5, 0.001);
  console.log(`Positive-class weight used: ${posWeight.toFixed(2)}`);

  const trainMetrics = evaluate(trainStd, weights, bias);
  const testMetrics = evaluate(testStd, weights, bias);
  console.log("\n--- Train metrics ---", trainMetrics);
  console.log("\n--- Test metrics (held out) ---", testMetrics);

  console.log("\n--- Feature weights (standardized) ---");
  HOSP_FEATURE_NAMES.forEach((name, j) => console.log(`  ${name}: ${weights[j].toFixed(3)}`));

  const output = {
    trainedAt: new Date().toISOString(),
    simulatorVersion: "independent-v1", // see lib/independentPatientSimulator.ts
    featureNames: HOSP_FEATURE_NAMES,
    weights,
    bias,
    featureMeans: means,
    featureStds: stds,
    threshold: 0.5,
    trainingMeta: {
      nPatients,
      daysPerPatient,
      nExamples: fullDataset.length,
      positiveRate,
      testMetrics,
    },
  };

  const outPath = join(__dirname, "..", "lib", "hospitalization-model-coefficients.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote coefficients to ${outPath}`);
}

main();
