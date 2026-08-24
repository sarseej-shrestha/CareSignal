// Offline training script for CareSignal's Layer 2 risk classifier.
//
// Trains a logistic regression on SIMULATED longitudinal symptom data, calibrated
// to mirror published chemotherapy symptom-monitoring literature: escalation
// events cluster around fever spikes and multi-day symptom trends, with an
// overall ~15-20% escalation rate. See docs/model-calibration.md for the full
// rationale and validation path.
//
// Run: npx tsx scripts/train-risk-model.ts
// Output: lib/model-coefficients.json (weights, bias, feature standardization stats)

import { writeFileSync } from "fs";
import { join } from "path";
import { FEATURE_NAMES, type FeatureVector } from "../lib/riskFeatures";
import type { DailySymptoms } from "../lib/riskEngine";

const SEED = 42;
let rngState = SEED;
function rng(): number {
  // Mulberry32 — deterministic PRNG so training is reproducible.
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

interface Persona {
  name: string;
  weight: number; // relative frequency among simulated patients
  baselinePain: number;
  baselineNausea: number;
  baselineFatigue: number;
  escalationProb: number; // chance per patient-timeline of an escalation arc
}

// Personas mirror typical chemo symptom-monitoring cohorts: most patients track
// stable/mild, a minority run a rockier course, and escalation arcs (fever
// spikes, multi-day symptom climbs) are the minority-but-real event of interest.
const PERSONAS: Persona[] = [
  { name: "stable", weight: 0.5, baselinePain: 1.5, baselineNausea: 1.5, baselineFatigue: 3, escalationProb: 0.3 },
  { name: "moderate", weight: 0.32, baselinePain: 3, baselineNausea: 3, baselineFatigue: 4.5, escalationProb: 0.65 },
  { name: "fragile", weight: 0.18, baselinePain: 4, baselineNausea: 4, baselineFatigue: 5.5, escalationProb: 0.95 },
];

function pickPersona(): Persona {
  const r = rng();
  let cumulative = 0;
  for (const p of PERSONAS) {
    cumulative += p.weight;
    if (r <= cumulative) return p;
  }
  return PERSONAS[PERSONAS.length - 1];
}

interface TrainingExample {
  features: FeatureVector;
  label: number;
}

/**
 * Simulate one patient's day-by-day timeline (DAYS_PER_PATIENT days), optionally
 * injecting a 2-4 day escalation arc (rising pain/nausea and/or a fever spike).
 * Each day past the first becomes one training example, scored a day is
 * "escalation" (label=1) if it is inside an injected arc's peak window, with
 * some noise so the boundary isn't perfectly clean (real triage isn't either).
 */
function simulatePatientTimeline(days: number): TrainingExample[] {
  const persona = pickPersona();
  const history: DailySymptoms[] = [];
  const examples: TrainingExample[] = [];

  const hasEscalationArc = rng() < persona.escalationProb;
  const arcLength = hasEscalationArc ? Math.floor(randRange(5, 9)) : 0;
  const arcStart = hasEscalationArc ? Math.floor(randRange(2, Math.max(3, days - arcLength - 1))) : -1;
  const arcIsFeverType = hasEscalationArc && rng() < 0.5;

  for (let day = 0; day < days; day++) {
    const inArc = hasEscalationArc && day >= arcStart && day < arcStart + arcLength;
    const arcProgress = inArc ? (day - arcStart + 1) / arcLength : 0;

    let pain = persona.baselinePain + randRange(-1, 1);
    let nausea = persona.baselineNausea + randRange(-1, 1);
    let fatigue = persona.baselineFatigue + randRange(-1, 1);
    let fever = 98.2 + randRange(-0.4, 0.4);

    if (inArc) {
      if (arcIsFeverType) {
        fever += arcProgress * randRange(2.2, 3.8);
        pain += arcProgress * randRange(1.5, 3);
      } else {
        pain += arcProgress * randRange(4, 7);
        nausea += arcProgress * randRange(4, 7);
        fatigue += arcProgress * randRange(1.5, 3.5);
      }
    }

    pain = clamp(Math.round(pain), 0, 10);
    nausea = clamp(Math.round(nausea), 0, 10);
    fatigue = clamp(Math.round(fatigue), 0, 10);
    fever = clamp(fever, 96.5, 105);

    history.push({ pain, nausea, fatigue, fever, createdAt: new Date() });

    const features = extractFeaturesInline(history);
    // Label: the day is a true escalation event if it's the peak day of an arc
    // (or fever crosses the neutropenic threshold, or a severe single-day
    // symptom fires) — with a little label noise since real triage outcomes
    // are noisy too, not a clean function of the features.
    // The whole arc is the clinically-relevant escalation window (rising trend
    // through peak), not just its single worst day — that matches how a nurse
    // triage flag should behave: catch the climb, not just the crisis.
    const hardTrigger = fever >= 100.4 || pain >= 8 || nausea >= 8;
    let label = inArc || hardTrigger ? 1 : 0;
    if (rng() < 0.03) label = 1 - label; // ~3% label noise

    examples.push({ features, label });
  }

  return examples;
}

// Local copy of extractFeatures logic to avoid importing a .ts path quirk when
// run standalone — kept byte-for-byte equivalent to lib/riskFeatures.ts.
function extractFeaturesInline(history: DailySymptoms[]): FeatureVector {
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
  return [today.pain, today.nausea, today.fatigue, feverElevation, feverSpike, painTrend, nauseaTrend];
}

function generateDataset(nPatients: number, daysPerPatient: number): TrainingExample[] {
  const dataset: TrainingExample[] = [];
  for (let i = 0; i < nPatients; i++) {
    dataset.push(...simulatePatientTimeline(daysPerPatient));
  }
  return dataset;
}

function standardize(dataset: TrainingExample[]) {
  const nFeatures = FEATURE_NAMES.length;
  const means = new Array(nFeatures).fill(0);
  const stds = new Array(nFeatures).fill(0);

  for (const ex of dataset) {
    for (let j = 0; j < nFeatures; j++) means[j] += ex.features[j];
  }
  for (let j = 0; j < nFeatures; j++) means[j] /= dataset.length;

  for (const ex of dataset) {
    for (let j = 0; j < nFeatures; j++) stds[j] += (ex.features[j] - means[j]) ** 2;
  }
  for (let j = 0; j < nFeatures; j++) {
    stds[j] = Math.sqrt(stds[j] / dataset.length) || 1;
  }

  const standardized = dataset.map((ex) => ({
    features: ex.features.map((v, j) => (v - means[j]) / stds[j]),
    label: ex.label,
  }));

  return { standardized, means, stds };
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function trainLogisticRegression(
  dataset: { features: FeatureVector; label: number }[],
  epochs: number,
  learningRate: number,
  l2: number
) {
  const nFeatures = dataset[0].features.length;
  const weights = new Array(nFeatures).fill(0);
  let bias = 0;
  const n = dataset.length;

  // Class weighting: this is a safety-critical triage flag, so a missed
  // escalation (false negative) is costlier than an extra nurse look at a
  // stable patient (false positive). Weight the minority (escalation) class
  // up so gradient descent doesn't just learn to always predict "no escalation".
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
      for (let j = 0; j < nFeatures; j++) {
        gradW[j] += error * ex.features[j];
      }
      gradB += error;
    }

    for (let j = 0; j < nFeatures; j++) {
      weights[j] -= learningRate * (gradW[j] / n + l2 * weights[j]);
    }
    bias -= learningRate * (gradB / n);
  }

  return { weights, bias, posWeight };
}

function evaluate(dataset: { features: FeatureVector; label: number }[], weights: number[], bias: number) {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  const threshold = 0.5;

  for (const ex of dataset) {
    const z = weights.reduce((sum, w, j) => sum + w * ex.features[j], bias);
    const pred = sigmoid(z) >= threshold ? 1 : 0;
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
  console.log("Simulating training data...");
  const nPatients = 1200;
  const daysPerPatient = 21;
  const fullDataset = generateDataset(nPatients, daysPerPatient);
  console.log(`Generated ${fullDataset.length} patient-day examples from ${nPatients} simulated patients.`);

  const positiveRate = fullDataset.filter((e) => e.label === 1).length / fullDataset.length;
  console.log(`Overall escalation (positive) rate: ${(positiveRate * 100).toFixed(1)}%`);

  // 80/20 train/test split
  const shuffled = [...fullDataset].sort(() => rng() - 0.5);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainRaw = shuffled.slice(0, splitIdx);
  const testRaw = shuffled.slice(splitIdx);

  const { standardized: trainStd, means, stds } = standardize(trainRaw);
  const testStd = testRaw.map((ex) => ({
    features: ex.features.map((v, j) => (v - means[j]) / stds[j]),
    label: ex.label,
  }));

  console.log("Training logistic regression...");
  const { weights, bias, posWeight } = trainLogisticRegression(trainStd, 400, 0.5, 0.001);
  console.log(`Positive-class weight used: ${posWeight.toFixed(2)}`);

  const trainMetrics = evaluate(trainStd, weights, bias);
  const testMetrics = evaluate(testStd, weights, bias);

  console.log("\n--- Train metrics ---");
  console.log(trainMetrics);
  console.log("\n--- Test metrics (held out) ---");
  console.log(testMetrics);

  const output = {
    trainedAt: new Date().toISOString(),
    featureNames: FEATURE_NAMES,
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

  const outPath = join(__dirname, "..", "lib", "model-coefficients.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote coefficients to ${outPath}`);
}

main();
