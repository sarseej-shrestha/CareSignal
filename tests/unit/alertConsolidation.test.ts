import { describe, expect, it } from "vitest";
import { consolidateNotification, sortByConsolidatedPriority, HOSP_ALERT_THRESHOLD } from "@/lib/alertConsolidation";

function patient(riskStatus: "GREEN" | "YELLOW" | "RED", riskScore: number, hospitalizationRiskScore: number) {
  return { riskStatus, riskScore, hospitalizationRiskScore };
}

describe("consolidateNotification", () => {
  it("tags DUAL_RED when daily is RED and hospitalization risk is elevated", () => {
    const result = consolidateNotification(patient("RED", 0.9, HOSP_ALERT_THRESHOLD + 0.01));
    expect(result.tier).toBe("DUAL_RED");
  });

  it("tags plain RED when daily is RED but hospitalization risk is below threshold", () => {
    const result = consolidateNotification(patient("RED", 0.9, HOSP_ALERT_THRESHOLD - 0.01));
    expect(result.tier).toBe("RED");
  });

  it("tags DUAL_YELLOW when daily is YELLOW and hospitalization risk is elevated (the Ruth Trahan case)", () => {
    const result = consolidateNotification(patient("YELLOW", 0.68, 0.517));
    expect(result.tier).toBe("DUAL_YELLOW");
  });

  it("tags HOSP_WATCH when daily is GREEN but hospitalization risk alone is elevated", () => {
    const result = consolidateNotification(patient("GREEN", 0.1, HOSP_ALERT_THRESHOLD + 0.05));
    expect(result.tier).toBe("HOSP_WATCH");
  });

  it("tags NONE when neither signal is elevated", () => {
    const result = consolidateNotification(patient("GREEN", 0.05, 0.2));
    expect(result.tier).toBe("NONE");
  });

  it("uses >= (inclusive) at the exact threshold boundary", () => {
    const result = consolidateNotification(patient("GREEN", 0, HOSP_ALERT_THRESHOLD));
    expect(result.hospitalizationElevated).toBe(true);
    expect(result.tier).toBe("HOSP_WATCH");
  });
});

describe("sortByConsolidatedPriority", () => {
  it("orders DUAL_RED > RED > DUAL_YELLOW > YELLOW > HOSP_WATCH > NONE", () => {
    const patients = [
      { name: "none", ...patient("GREEN", 0.05, 0.1) },
      { name: "hospWatch", ...patient("GREEN", 0.05, 0.6) },
      { name: "yellow", ...patient("YELLOW", 0.4, 0.1) },
      { name: "dualYellow", ...patient("YELLOW", 0.4, 0.6) },
      { name: "red", ...patient("RED", 0.9, 0.1) },
      { name: "dualRed", ...patient("RED", 0.9, 0.6) },
    ];
    const sorted = sortByConsolidatedPriority(patients).map((p) => p.name);
    expect(sorted).toEqual(["dualRed", "red", "dualYellow", "yellow", "hospWatch", "none"]);
  });

  it("matches the real seeded set: Ruth Trahan is the only dual-signal patient", () => {
    // Real values from the seeded demo data (npx tsx prisma/seed.ts).
    const seeded = [
      { name: "Ruth Trahan", ...patient("YELLOW", 0.68, 0.517) },
      { name: "Michael Naquin", ...patient("RED", 1.0, 0.463) },
      { name: "Sofía Reyes", ...patient("RED", 1.0, 0.447) },
      { name: "Denise Guidry", ...patient("RED", 0.96, 0.356) },
      { name: "James Chauvin", ...patient("GREEN", 0.18, 0.291) },
    ];
    const tiers = seeded.map((p) => ({ name: p.name, tier: consolidateNotification(p).tier }));
    expect(tiers.find((t) => t.name === "Ruth Trahan")?.tier).toBe("DUAL_YELLOW");
    expect(tiers.filter((t) => t.tier.startsWith("DUAL"))).toHaveLength(1);
  });

  it("does not mutate the input array", () => {
    const input = [{ name: "a", ...patient("RED", 0.9, 0.1) }, { name: "b", ...patient("GREEN", 0.1, 0.1) }];
    const original = JSON.parse(JSON.stringify(input));
    sortByConsolidatedPriority(input);
    expect(input).toEqual(original);
  });
});
