import { describe, expect, it } from "vitest";
import { evaluateRules, type DailySymptoms } from "@/lib/riskEngine";

function day(overrides: Partial<DailySymptoms> = {}): DailySymptoms {
  return { pain: 1, nausea: 1, fatigue: 2, fever: 98.4, createdAt: new Date(), ...overrides };
}

describe("evaluateRules", () => {
  it("returns GREEN with no reasons for an empty history", () => {
    const result = evaluateRules([]);
    expect(result.level).toBe("GREEN");
    expect(result.reasons).toEqual([]);
  });

  it("returns GREEN for a single mild day with no prior history", () => {
    const result = evaluateRules([day()]);
    expect(result.level).toBe("GREEN");
  });

  describe("neutropenic fever threshold (100.4°F)", () => {
    it("does NOT fire at exactly 100.3°F", () => {
      const result = evaluateRules([day({ fever: 100.3 })]);
      expect(result.level).toBe("GREEN");
    });

    it("fires RED at exactly 100.4°F (boundary is inclusive)", () => {
      const result = evaluateRules([day({ fever: 100.4 })]);
      expect(result.level).toBe("RED");
      expect(result.reasons.some((r) => r.includes("neutropenic fever"))).toBe(true);
    });

    it("fires RED above threshold", () => {
      const result = evaluateRules([day({ fever: 103 })]);
      expect(result.level).toBe("RED");
    });
  });

  describe("severe pain/nausea threshold (>=8)", () => {
    it("does NOT fire at pain=7", () => {
      const result = evaluateRules([day({ pain: 7 })]);
      expect(result.level).not.toBe("RED");
    });

    it("fires RED at exactly pain=8", () => {
      const result = evaluateRules([day({ pain: 8 })]);
      expect(result.level).toBe("RED");
      expect(result.reasons.some((r) => r.includes("Severe pain"))).toBe(true);
    });

    it("fires RED at exactly nausea=8", () => {
      const result = evaluateRules([day({ nausea: 8 })]);
      expect(result.level).toBe("RED");
      expect(result.reasons.some((r) => r.includes("Severe nausea"))).toBe(true);
    });

    it("fires RED for both pain and nausea >=8, with both reasons listed", () => {
      const result = evaluateRules([day({ pain: 9, nausea: 8 })]);
      expect(result.level).toBe("RED");
      expect(result.reasons.some((r) => r.includes("Severe pain"))).toBe(true);
      expect(result.reasons.some((r) => r.includes("Severe nausea"))).toBe(true);
    });
  });

  describe("3-day trend escalation (delta >= 3 vs prior 2-day avg)", () => {
    it("does NOT fire when the delta is 2.9", () => {
      // prior avg = (2+2)/2 = 2; today = 4.9 -> delta 2.9
      const history = [day({ pain: 2 }), day({ pain: 2 }), day({ pain: 4.9 })];
      const result = evaluateRules(history);
      expect(result.reasons.some((r) => r.includes("Sustained symptom escalation"))).toBe(false);
    });

    it("fires YELLOW at exactly delta = 3", () => {
      // prior avg = (2+2)/2 = 2; today = 5 -> delta 3
      const history = [day({ pain: 2 }), day({ pain: 2 }), day({ pain: 5 })];
      const result = evaluateRules(history);
      expect(result.level).toBe("YELLOW");
      expect(result.reasons.some((r) => r.includes("Sustained symptom escalation") && r.includes("pain"))).toBe(true);
    });

    it("fires for nausea trend independently of pain trend", () => {
      const history = [day({ nausea: 1 }), day({ nausea: 1 }), day({ nausea: 5 })];
      const result = evaluateRules(history);
      expect(result.level).toBe("YELLOW");
      expect(result.reasons.some((r) => r.includes("nausea"))).toBe(true);
    });

    it("does not evaluate a trend with fewer than 1 prior day", () => {
      const history = [day({ pain: 9 })]; // no prior days at all
      const result = evaluateRules(history);
      // Should still hit the severe-pain hard trigger, but no trend reason (no prior data to compare).
      expect(result.reasons.some((r) => r.includes("Sustained symptom escalation"))).toBe(false);
    });
  });

  describe("moderate single-day thresholds", () => {
    it("does NOT fire at pain=4", () => {
      const result = evaluateRules([day({ pain: 4 })]);
      expect(result.level).toBe("GREEN");
    });

    it("fires YELLOW at exactly pain=5", () => {
      const result = evaluateRules([day({ pain: 5 })]);
      expect(result.level).toBe("YELLOW");
      expect(result.reasons.some((r) => r.includes("Moderate pain"))).toBe(true);
    });

    it("fires YELLOW at exactly nausea=5", () => {
      const result = evaluateRules([day({ nausea: 5 })]);
      expect(result.level).toBe("YELLOW");
    });

    it("does NOT fire fatigue at 6", () => {
      const result = evaluateRules([day({ fatigue: 6 })]);
      expect(result.level).toBe("GREEN");
    });

    it("fires YELLOW at exactly fatigue=7", () => {
      const result = evaluateRules([day({ fatigue: 7 })]);
      expect(result.level).toBe("YELLOW");
      expect(result.reasons.some((r) => r.includes("High fatigue"))).toBe(true);
    });

    it("does not add moderate reasons once a RED trigger has already fired", () => {
      // pain=8 fires RED (severe); pain is also >=5 (moderate threshold) but
      // the moderate check should be skipped once RED is already reached.
      const result = evaluateRules([day({ pain: 8 })]);
      expect(result.level).toBe("RED");
      expect(result.reasons.some((r) => r.includes("Moderate pain"))).toBe(false);
    });
  });

  it("severity ranks RED above YELLOW: a RED-triggering fever wins over a same-day moderate-pain reading", () => {
    // Moderate pain (5, would be YELLOW alone) AND fever (RED) on the same
    // day -> overall level is RED, driven by the fever reason (the
    // moderate-pain reason is intentionally suppressed once RED has
    // already fired — see the dedicated test for that above).
    const result = evaluateRules([day({ pain: 5, fever: 101 })]);
    expect(result.level).toBe("RED");
    expect(result.reasons.some((r) => r.includes("neutropenic fever"))).toBe(true);
  });
});
