import { describe, expect, it } from "vitest";
import { simulateIndependentTimeline } from "@/lib/independentPatientSimulator";

describe("simulateIndependentTimeline", () => {
  it("is deterministic for a given seed", () => {
    const a = simulateIndependentTimeline(42, 20);
    const b = simulateIndependentTimeline(42, 20);
    expect(a).toEqual(b);
  });

  it("produces a different timeline for a different seed", () => {
    const a = simulateIndependentTimeline(1, 20);
    const b = simulateIndependentTimeline(2, 20);
    expect(a.days).not.toEqual(b.days);
  });

  it("returns exactly numDays days, each with values in plausible ranges", () => {
    const { days } = simulateIndependentTimeline(7, 30);
    expect(days).toHaveLength(30);
    for (const d of days) {
      expect(d.pain).toBeGreaterThanOrEqual(0);
      expect(d.pain).toBeLessThanOrEqual(10);
      expect(d.nausea).toBeGreaterThanOrEqual(0);
      expect(d.nausea).toBeLessThanOrEqual(10);
      expect(d.fatigue).toBeGreaterThanOrEqual(0);
      expect(d.fatigue).toBeLessThanOrEqual(10);
      expect(d.fever).toBeGreaterThanOrEqual(96.5);
      expect(d.fever).toBeLessThanOrEqual(105);
      expect(d.copingScore).toBeGreaterThanOrEqual(1);
      expect(d.copingScore).toBeLessThanOrEqual(5);
    }
  });

  it("hospitalizedOnsetDay, when present, is a valid index within the timeline", () => {
    // Run many seeds so at least some produce a hospitalization event.
    let sawOnset = false;
    for (let seed = 0; seed < 200; seed++) {
      const { days, hospitalizedOnsetDay } = simulateIndependentTimeline(seed, 35);
      if (hospitalizedOnsetDay !== null) {
        sawOnset = true;
        expect(hospitalizedOnsetDay).toBeGreaterThanOrEqual(0);
        expect(hospitalizedOnsetDay).toBeLessThan(days.length);
      }
    }
    expect(sawOnset).toBe(true);
  });

  it("produces a hospitalization rate in a plausible range across many patients (not ~0%, not ~100%)", () => {
    let hospitalized = 0;
    const n = 500;
    for (let seed = 0; seed < n; seed++) {
      const { hospitalizedOnsetDay } = simulateIndependentTimeline(seed * 97, 35);
      if (hospitalizedOnsetDay !== null) hospitalized++;
    }
    const rate = hospitalized / n;
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.6);
  });
});
