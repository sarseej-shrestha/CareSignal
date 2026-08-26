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

  // Semifinal red-team fix: the alert count was already correctly de-duped
  // (test above), but the underlying SymptomLog kept accumulating one new
  // row per trigger — invisible in the alert assertion, but real duplicate
  // rows a nurse would see stacking up in James's timeline after repeated
  // demo rehearsals. Verified live against the dev server (3 triggers, 9
  // logs) before this fix; pinned here so it can't silently regress.
  it("is idempotent — re-triggering doesn't accumulate duplicate SymptomLog rows", async () => {
    const first = await triggerScenario("chauvin-logistical");
    const afterFirst = await prisma.symptomLog.count({ where: { patientId: first.patientId } });
    await triggerScenario("chauvin-logistical");
    await triggerScenario("chauvin-logistical");
    const afterThree = await prisma.symptomLog.count({ where: { patientId: first.patientId } });
    expect(afterThree).toBe(afterFirst);
  });

  it("throws when DEMO_MODE is not enabled", async () => {
    delete process.env.DEMO_MODE;
    await expect(triggerScenario("chauvin-logistical")).rejects.toThrow(/DEMO_MODE/);
  });
});

// Full closed-loop demo: pitre-pain-report seeds the opening message,
// pitre-pain-followup simulates the patient's reply — matching the exact
// scenario given in the task ("I've been having a lot of pain since last
// night and I'm worried." -> nurse reviews/replies -> "I'm worse now. It's
// about 8 out of 10.").
describe("triggerScenario — pitre-pain-report / pitre-pain-followup (closed-loop demo)", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.DEMO_MODE = "true";
  });

  afterEach(async () => {
    await resetDb();
    delete process.env.DEMO_MODE;
  });

  it("pitre-pain-report seeds Anthony's opening message and a real risk assessment", async () => {
    const result = await triggerScenario("pitre-pain-report");
    expect(result.patientName).toBe("Anthony Pitre");
    expect(result.riskStatus).toBeDefined();
    const log = await prisma.symptomLog.findFirst({
      where: { patientId: result.patientId },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.rawSmsText).toContain("worried");
    const comms = await prisma.communicationMessage.findMany({ where: { patientId: result.patientId } });
    expect(comms.some((c) => c.body.includes("worried"))).toBe(true);
  });

  it("pitre-pain-report is idempotent and resets any prior conversation history", async () => {
    const first = await triggerScenario("pitre-pain-report");
    const baselineLogCount = await prisma.symptomLog.count({ where: { patientId: first.patientId } });
    // Simulate a full rehearsal: reviewed + replied + a simulated patient
    // reply — then re-trigger the "start" scenario and confirm the
    // conversation history is back to a single seeded message (not
    // accumulating the rehearsal's communications) and the symptom log
    // count is back to the same baseline (not accumulating the followup).
    await prisma.communicationMessage.create({
      data: { patientId: first.patientId, participant: "PATIENT", direction: "OUTBOUND", body: "reviewed ack", status: "SENT" },
    });
    await triggerScenario("pitre-pain-followup");

    await triggerScenario("pitre-pain-report");
    const comms = await prisma.communicationMessage.findMany({ where: { patientId: first.patientId } });
    expect(comms).toHaveLength(1);
    const logs = await prisma.symptomLog.count({ where: { patientId: first.patientId } });
    expect(logs).toBe(baselineLogCount);
  });

  it("pitre-pain-followup appends the simulated reply and escalates risk without resetting prior state", async () => {
    const start = await triggerScenario("pitre-pain-report");
    // Simulate the nurse having already sent a reply in between.
    await prisma.communicationMessage.create({
      data: { patientId: start.patientId, participant: "PATIENT", direction: "OUTBOUND", body: "Can you tell us more?", status: "SENT" },
    });

    const followup = await triggerScenario("pitre-pain-followup");
    expect(followup.riskStatus).toBe("RED"); // pain=8 crosses the severe-pain rule directly
    const comms = await prisma.communicationMessage.findMany({ where: { patientId: start.patientId } });
    // The nurse's reply from before the followup must still be there —
    // triggering the followup did not reset the conversation.
    expect(comms.some((c) => c.body === "Can you tell us more?")).toBe(true);
    expect(comms.some((c) => c.body.includes("8 out of 10"))).toBe(true);
  });

  it("pitre-pain-followup is idempotent — re-triggering doesn't accumulate duplicate SymptomLog rows", async () => {
    const start = await triggerScenario("pitre-pain-report");
    await triggerScenario("pitre-pain-followup");
    const afterFirst = await prisma.symptomLog.count({ where: { patientId: start.patientId } });
    await triggerScenario("pitre-pain-followup");
    await triggerScenario("pitre-pain-followup");
    const afterThree = await prisma.symptomLog.count({ where: { patientId: start.patientId } });
    expect(afterThree).toBe(afterFirst);
  });
});
