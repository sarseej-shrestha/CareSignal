import { describe, expect, it } from "vitest";
import { getTransportationSuggestion } from "@/lib/transportationResources";

describe("getTransportationSuggestion", () => {
  it("surfaces a suggestion for a weekly-treatment patient in a known parish", () => {
    const result = getTransportationSuggestion({ parish: "Terrebonne", treatmentFrequency: "weekly" });
    expect(result).not.toBeNull();
    expect(result!.resources[0].name).toContain("Terrebonne Council on Aging");
  });

  it("surfaces a suggestion for an every-2-weeks patient", () => {
    const result = getTransportationSuggestion({ parish: "Lafourche", treatmentFrequency: "every_2_weeks" });
    expect(result).not.toBeNull();
    expect(result!.resources[0].name).toContain("Lafourche Council on Aging");
  });

  it("does not surface a suggestion for every-3-weeks — not frequent enough to be a recurring barrier", () => {
    const result = getTransportationSuggestion({ parish: "Terrebonne", treatmentFrequency: "every_3_weeks" });
    expect(result).toBeNull();
  });

  it("does not surface a suggestion for monthly treatment", () => {
    const result = getTransportationSuggestion({ parish: "Lafourche", treatmentFrequency: "monthly" });
    expect(result).toBeNull();
  });

  it("returns null for a parish with no known local resource, even at high frequency", () => {
    const result = getTransportationSuggestion({ parish: "Orleans", treatmentFrequency: "weekly" });
    expect(result).toBeNull();
  });

  it("always includes the universal resources (ACS Road To Recovery, Medicaid NEMT, LA 211) alongside the parish-specific one", () => {
    const result = getTransportationSuggestion({ parish: "Terrebonne", treatmentFrequency: "weekly" });
    const names = result!.resources.map((r) => r.name);
    expect(names.some((n) => n.includes("Road To Recovery"))).toBe(true);
    expect(names.some((n) => n.includes("Medicaid"))).toBe(true);
    expect(names.some((n) => n.includes("211"))).toBe(true);
  });

  it("gives every resource a non-empty phone and detail", () => {
    const result = getTransportationSuggestion({ parish: "Lafourche", treatmentFrequency: "weekly" });
    for (const r of result!.resources) {
      expect(r.phone.length).toBeGreaterThan(0);
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });
});
