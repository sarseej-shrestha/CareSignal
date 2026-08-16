import { describe, expect, it } from "vitest";
import { predictRiskProbability, MODEL_THRESHOLD } from "@/lib/riskModel";
import type { DailySymptoms } from "@/lib/riskEngine";
import coefficients from "@/lib/model-coefficients.json";

function day(overrides: Partial<DailySymptoms> = {}): DailySymptoms {
  return { pain: 1, nausea: 1, fatigue: 2, fever: 98.4, createdAt: new Date(), ...overrides };
}

describe("model-coefficients.json", () => {
  it("loads with the expected shape", () => {
    expect(Array.isArray(coefficients.weights)).toBe(true);
    expect(coefficients.weights.length).toBe(coefficients.featureNames.length);
    expect(coefficients.featureMeans.length).toBe(coefficients.weights.length);
    expect(coefficients.featureStds.length).toBe(coefficients.weights.length);
    expect(typeof coefficients.bias).toBe("number");
  });

  it("was trained on a positive rate within the documented 15-20% target range", () => {
    expect(coefficients.trainingMeta.positiveRate).toBeGreaterThanOrEqual(0.15);
    expect(coefficients.trainingMeta.positiveRate).toBeLessThanOrEqual(0.2);
  });
});

describe("predictRiskProbability", () => {
  it("returns 0 for an empty history", () => {
    expect(predictRiskProbability([])).toBe(0);
  });

  it("always returns a probability between 0 and 1", () => {
    const history = [day({ pain: 10, nausea: 10, fatigue: 10, fever: 105 })];
    const prob = predictRiskProbability(history);
    expect(prob).toBeGreaterThanOrEqual(0);
    expect(prob).toBeLessThanOrEqual(1);
  });

  it("scores a mild, stable history low", () => {
    const history = [
      day({ pain: 1, nausea: 1, fatigue: 2, fever: 98.3 }),
      day({ pain: 1, nausea: 1, fatigue: 2, fever: 98.4 }),
      day({ pain: 1, nausea: 1, fatigue: 2, fever: 98.3 }),
    ];
    expect(predictRiskProbability(history)).toBeLessThan(MODEL_THRESHOLD);
  });

  it("scores a fever-spike-plus-escalating-trend history high", () => {
    const history = [
      day({ pain: 2, nausea: 2, fatigue: 4, fever: 98.4 }),
      day({ pain: 3, nausea: 3, fatigue: 5, fever: 98.8 }),
      day({ pain: 7, nausea: 6, fatigue: 8, fever: 101.3 }),
    ];
    expect(predictRiskProbability(history)).toBeGreaterThan(MODEL_THRESHOLD);
  });

  it("scores a worsening history higher than an otherwise-identical stable one", () => {
    const stable = [day({ pain: 3, nausea: 3 }), day({ pain: 3, nausea: 3 }), day({ pain: 3, nausea: 3 })];
    const escalating = [day({ pain: 3, nausea: 3 }), day({ pain: 3, nausea: 3 }), day({ pain: 7, nausea: 7 })];
    expect(predictRiskProbability(escalating)).toBeGreaterThan(predictRiskProbability(stable));
  });
});
