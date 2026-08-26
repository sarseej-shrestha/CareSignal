import { describe, expect, it } from "vitest";
import { computeClinicalSnapshot, type SnapshotLog } from "@/lib/clinicalSnapshot";

const fmt = (d: Date) => d.toISOString().slice(0, 10);

function log(daysAgo: number, overrides: Partial<SnapshotLog> = {}): SnapshotLog {
  return {
    pain: 2,
    nausea: 2,
    fatigue: 3,
    fever: 98.4,
    createdAt: new Date(2026, 0, 10 - daysAgo),
    rawSmsText: null,
    source: "PATIENT_SMS",
    parsedByAi: false,
    ...overrides,
  };
}

describe("computeClinicalSnapshot", () => {
  it("returns null for no logs", () => {
    expect(computeClinicalSnapshot([], fmt)).toBeNull();
  });

  it("returns null deltas (no baseline) with only one log", () => {
    const result = computeClinicalSnapshot([log(0, { rawSmsText: "hi" })], fmt);
    expect(result?.deltas).toBeNull();
    expect(result?.latestRawText).toBe("hi");
  });

  it("computes real deltas against the average of the prior two days", () => {
    const logs = [log(2, { pain: 2 }), log(1, { pain: 2 }), log(0, { pain: 6 })];
    const result = computeClinicalSnapshot(logs, fmt);
    expect(result?.deltas?.pain).toBeCloseTo(4);
  });

  it("carries through the latest log's source/parsedByAi/raw text", () => {
    const logs = [log(1), log(0, { rawSmsText: "feeling worse", source: "CAREGIVER_SMS", parsedByAi: true })];
    const result = computeClinicalSnapshot(logs, fmt);
    expect(result?.latestRawText).toBe("feeling worse");
    expect(result?.latestSource).toBe("CAREGIVER_SMS");
    expect(result?.parsedByAi).toBe(true);
  });

  it("does not mutate or require more than the trailing 3 logs for delta math", () => {
    const logs = [log(4, { pain: 9 }), log(3, { pain: 9 }), log(2, { pain: 1 }), log(1, { pain: 1 }), log(0, { pain: 3 })];
    const result = computeClinicalSnapshot(logs, fmt);
    // baseline = avg(pain@2, pain@1) = avg(1,1) = 1; latest pain@0 = 3 -> delta 2
    expect(result?.deltas?.pain).toBeCloseTo(2);
  });
});
