import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DailySymptoms } from "@/lib/riskEngine";

function day(overrides: Partial<DailySymptoms> = {}): DailySymptoms {
  return { pain: 1, nausea: 1, fatigue: 2, fever: 98.4, createdAt: new Date(), ...overrides };
}

describe("assessRisk (combined rules + model)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("escalates a rules-only YELLOW to RED when the model probability is high (Denise Guidry case)", async () => {
    // Real Denise Guidry seed shape: a moderate trend that rules alone
    // grade YELLOW, but the trained model — seeing the same trend plus a
    // same-day moderate-pain flag — pushes to RED. We mock the model layer
    // here to assert risk.ts's escalation LOGIC specifically (rather than
    // depending on the trained model's exact output, which is covered by
    // riskModel.test.ts separately).
    vi.doMock("@/lib/riskModel", () => ({
      predictRiskProbability: () => 0.96,
      MODEL_THRESHOLD: 0.5,
    }));
    const { assessRisk } = await import("@/lib/risk");

    const history = [
      day({ pain: 2, nausea: 2 }),
      day({ pain: 2, nausea: 3 }),
      day({ pain: 3, nausea: 3 }),
      day({ pain: 3, nausea: 2 }),
      day({ pain: 4, nausea: 3 }),
      day({ pain: 7, nausea: 4 }), // trend delta = 7 - avg(4,3) = 3.5 -> rules say YELLOW
    ];

    const result = assessRisk(history);
    expect(result.level).toBe("RED");
    expect(result.modelProb).toBe(0.96);
    expect(result.reasons.some((r) => r.includes("Model probability high"))).toBe(true);
    // The original rule-based reason should still be present, not replaced.
    expect(result.reasons.some((r) => r.includes("Sustained symptom escalation"))).toBe(true);
  });

  it("escalates a rules-only GREEN to YELLOW when the model flags an emerging pattern", async () => {
    vi.doMock("@/lib/riskModel", () => ({
      predictRiskProbability: () => 0.6,
      MODEL_THRESHOLD: 0.5,
    }));
    const { assessRisk } = await import("@/lib/risk");

    const result = assessRisk([day({ pain: 1, nausea: 1 })]); // rules alone: GREEN
    expect(result.level).toBe("YELLOW");
    expect(result.reasons.some((r) => r.includes("Model flagged an emerging risk pattern"))).toBe(true);
  });

  it("never downgrades a rule-triggered RED, even when the model probability is low", async () => {
    vi.doMock("@/lib/riskModel", () => ({
      predictRiskProbability: () => 0.01,
      MODEL_THRESHOLD: 0.5,
    }));
    const { assessRisk } = await import("@/lib/risk");

    const result = assessRisk([day({ fever: 101 })]); // hard RED trigger: neutropenic fever
    expect(result.level).toBe("RED");
    expect(result.modelProb).toBe(0.01);
    // The low model probability should be recorded, but not used to soften the level.
    expect(result.reasons.some((r) => r.includes("neutropenic fever"))).toBe(true);
  });

  it("leaves a rules-only GREEN as GREEN when the model probability is also low", async () => {
    vi.doMock("@/lib/riskModel", () => ({
      predictRiskProbability: () => 0.1,
      MODEL_THRESHOLD: 0.5,
    }));
    const { assessRisk } = await import("@/lib/risk");

    const result = assessRisk([day({ pain: 1, nausea: 1 })]);
    expect(result.level).toBe("GREEN");
    expect(result.reasons).toEqual([]);
  });

  it("does not escalate YELLOW to RED when the model probability is below the escalation threshold", async () => {
    vi.doMock("@/lib/riskModel", () => ({
      predictRiskProbability: () => 0.6, // >=0.5 (already YELLOW-worthy) but <0.75 (RED escalation threshold)
      MODEL_THRESHOLD: 0.5,
    }));
    const { assessRisk } = await import("@/lib/risk");

    const result = assessRisk([day({ pain: 5 })]); // rules: YELLOW via moderate threshold
    expect(result.level).toBe("YELLOW");
  });
});
