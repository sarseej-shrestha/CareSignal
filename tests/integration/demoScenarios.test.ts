import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";
import { triggerScenario } from "@/lib/demoScenarios";

// lib/demoScenarios.ts had no test coverage at all before this file — this
// covers only the new chauvin-logistical scenario added alongside the
// need-classification/routing work; the three pre-existing scenarios
// remain untested (pre-existing gap, out of scope here).
describe("triggerScenario — chauvin-logistical", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.DEMO_MODE = "true";
  });

  afterEach(async () => {
    await resetDb();
    delete process.env.DEMO_MODE;
  });

  it("creates a LOGISTICAL alert for James Chauvin without touching his clinical risk", async () => {
    const result = await triggerScenario("chauvin-logistical");
    expect(result.patientName).toBe("James Chauvin");
    expect(result.careNeedCategory).toBe("LOGISTICAL");
    expect(result.careNeedReasons?.length).toBeGreaterThan(0);

    const patient = await prisma.patient.findUnique({ where: { id: result.patientId } });
    const alerts = await prisma.riskAlert.findMany({ where: { patientId: result.patientId } });
    expect(alerts.some((a) => a.level === "LOGISTICAL")).toBe(true);
    expect(alerts.some((a) => a.level === "YELLOW" || a.level === "RED")).toBe(false);
    expect(patient?.treatmentFrequency).toBe("weekly");
  });

  it("includes the treatment-interruption note, since James is on a weekly schedule", async () => {
    const result = await triggerScenario("chauvin-logistical");
    expect(result.careNeedReasons?.some((r) => r.toLowerCase().includes("interrupt"))).toBe(true);
  });

  it("is idempotent — re-triggering doesn't create duplicate LOGISTICAL alerts", async () => {
    const first = await triggerScenario("chauvin-logistical");
    await triggerScenario("chauvin-logistical");
    const alerts = await prisma.riskAlert.findMany({ where: { patientId: first.patientId, level: "LOGISTICAL" } });
    expect(alerts).toHaveLength(1);
  });

  it("throws when DEMO_MODE is not enabled", async () => {
    delete process.env.DEMO_MODE;
    await expect(triggerScenario("chauvin-logistical")).rejects.toThrow(/DEMO_MODE/);
  });
});
