import { describe, expect, it } from "vitest";
import { sortByRiskPriority, type RiskSortable } from "@/lib/sortPatients";

interface NamedPatient extends RiskSortable {
  name: string;
}

// Mirrors the real seeded set's risk distribution (see prisma/seed.ts):
// 2 RED, 1 YELLOW, 3 GREEN, at varying model probabilities.
const knownSeededSet: NamedPatient[] = [
  { name: "Marguerite Boudreaux", riskStatus: "GREEN", riskScore: 0.07 },
  { name: "Michael Naquin", riskStatus: "RED", riskScore: 1.0 },
  { name: "Denise Guidry", riskStatus: "RED", riskScore: 0.96 },
  { name: "Anthony Pitre", riskStatus: "GREEN", riskScore: 0.05 },
  { name: "Ruth Trahan", riskStatus: "YELLOW", riskScore: 0.68 },
  { name: "James Chauvin", riskStatus: "GREEN", riskScore: 0.18 },
];

describe("sortByRiskPriority", () => {
  it("orders RED before YELLOW before GREEN, matching the known seeded set", () => {
    const sorted = sortByRiskPriority(knownSeededSet).map((p) => p.name);
    expect(sorted).toEqual([
      "Michael Naquin", // RED, p=1.00
      "Denise Guidry", // RED, p=0.96
      "Ruth Trahan", // YELLOW
      "James Chauvin", // GREEN, p=0.18
      "Marguerite Boudreaux", // GREEN, p=0.07
      "Anthony Pitre", // GREEN, p=0.05
    ]);
  });

  it("breaks ties within a risk bucket by higher model probability first", () => {
    const sorted = sortByRiskPriority([
      { name: "lower-red", riskStatus: "RED", riskScore: 0.6 },
      { name: "higher-red", riskStatus: "RED", riskScore: 0.9 },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(["higher-red", "lower-red"]);
  });

  it("does not mutate the input array", () => {
    const input = [...knownSeededSet];
    const original = [...input];
    sortByRiskPriority(input);
    expect(input).toEqual(original);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortByRiskPriority([])).toEqual([]);
  });
});
