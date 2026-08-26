import { describe, expect, it } from "vitest";
import { checkTreatmentInterruptionRisk } from "@/lib/treatmentInterruptionRisk";

describe("checkTreatmentInterruptionRisk", () => {
  it("flags a weekly-treatment patient", () => {
    const result = checkTreatmentInterruptionRisk("weekly");
    expect(result.atRisk).toBe(true);
    expect(result.reason).toMatch(/weekly/i);
  });

  it("flags an every-2-weeks patient", () => {
    const result = checkTreatmentInterruptionRisk("every_2_weeks");
    expect(result.atRisk).toBe(true);
  });

  it("does NOT flag an every-3-weeks patient", () => {
    expect(checkTreatmentInterruptionRisk("every_3_weeks").atRisk).toBe(false);
  });

  it("does NOT flag a monthly patient", () => {
    const result = checkTreatmentInterruptionRisk("monthly");
    expect(result.atRisk).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("never invents a specific date or appointment", () => {
    const result = checkTreatmentInterruptionRisk("weekly");
    expect(result.reason).not.toMatch(/\d{1,2}\/\d{1,2}|january|february|march|monday|tuesday/i);
  });
});
