import { describe, expect, it } from "vitest";
import { predictHospitalizationRisk, HOSP_MODEL_THRESHOLD } from "@/lib/hospitalizationModel";
import type { HospitalizationInputs } from "@/lib/hospitalizationFeatures";
import coefficients from "@/lib/hospitalization-model-coefficients.json";

function inputs(overrides: Partial<HospitalizationInputs> = {}): HospitalizationInputs {
  return {
    alertCount7d: 0,
    feverRecurrenceCount7d: 0,
    severeDayCount7d: 0,
    maxTrendDelta7d: 0,
    avgDailyModelProb7d: 0,
    caregiverBurdenFlag7d: 0,
    ...overrides,
  };
}

describe("hospitalization-model-coefficients.json", () => {
  it("loads with the expected shape", () => {
    expect(coefficients.weights.length).toBe(coefficients.featureNames.length);
    expect(coefficients.featureMeans.length).toBe(coefficients.weights.length);
    expect(coefficients.featureStds.length).toBe(coefficients.weights.length);
    expect(typeof coefficients.bias).toBe("number");
  });

  it("has a lower positive rate than the daily model — hospitalization is rarer than a daily escalation", async () => {
    const dailyCoefficients = await import("@/lib/model-coefficients.json");
    expect(coefficients.trainingMeta.positiveRate).toBeLessThan(dailyCoefficients.trainingMeta.positiveRate);
  });
});

describe("predictHospitalizationRisk", () => {
  it("always returns a probability between 0 and 1", () => {
    const prob = predictHospitalizationRisk(
      inputs({ alertCount7d: 7, feverRecurrenceCount7d: 3, severeDayCount7d: 6, maxTrendDelta7d: 10, avgDailyModelProb7d: 1, caregiverBurdenFlag7d: 1 })
    );
    expect(prob).toBeGreaterThanOrEqual(0);
    expect(prob).toBeLessThanOrEqual(1);
  });

  it("scores a maximally severe profile above the decision threshold", () => {
    const prob = predictHospitalizationRisk(
      inputs({ alertCount7d: 6, feverRecurrenceCount7d: 3, severeDayCount7d: 5, maxTrendDelta7d: 7, avgDailyModelProb7d: 0.85, caregiverBurdenFlag7d: 1 })
    );
    expect(prob).toBeGreaterThan(HOSP_MODEL_THRESHOLD);
  });

  it("scores a clean/stable profile lower than a severe one", () => {
    const clean = predictHospitalizationRisk(inputs());
    const severe = predictHospitalizationRisk(
      inputs({ alertCount7d: 5, feverRecurrenceCount7d: 2, severeDayCount7d: 4, maxTrendDelta7d: 6, avgDailyModelProb7d: 0.7, caregiverBurdenFlag7d: 1 })
    );
    expect(severe).toBeGreaterThan(clean);
  });

  it("caregiver burden alone increases risk relative to an otherwise-identical profile without it", () => {
    // This is the pitch's explicit claim — verify the trained model actually
    // learned a standalone, non-zero contribution from this feature, not
    // just a coincidental correlation with the other severity features.
    const withoutBurden = predictHospitalizationRisk(inputs({ alertCount7d: 1, avgDailyModelProb7d: 0.2 }));
    const withBurden = predictHospitalizationRisk(inputs({ alertCount7d: 1, avgDailyModelProb7d: 0.2, caregiverBurdenFlag7d: 1 }));
    expect(withBurden).toBeGreaterThan(withoutBurden);
  });

  it("a caregiver-burden flag alone can outrank a symptomatically-worse profile without one (Ruth Trahan case)", () => {
    // Mirrors the actual seeded scenario: Ruth's own symptoms are moderate
    // (not the most severe patient) but her caregiver's burden pushes her
    // hospitalization-risk estimate above patients with more alerts/fever
    // recurrence but an intact caregiver.
    const ruthLike = predictHospitalizationRisk(
      inputs({ alertCount7d: 1, severeDayCount7d: 0, avgDailyModelProb7d: 0.49, caregiverBurdenFlag7d: 1 })
    );
    const moreSevereButNoBurden = predictHospitalizationRisk(
      inputs({ alertCount7d: 1, feverRecurrenceCount7d: 1, severeDayCount7d: 1, avgDailyModelProb7d: 0.4, caregiverBurdenFlag7d: 0 })
    );
    expect(ruthLike).toBeGreaterThan(moreSevereButNoBurden);
  });
});
