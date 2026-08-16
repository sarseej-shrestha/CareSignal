import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { computeHospitalizationRisk } from "@/lib/hospitalizationRisk";
import { resetDb, seedTestPatient, seedTestCaregiver } from "../helpers/db";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

beforeEach(resetDb);
afterEach(resetDb);

describe("computeHospitalizationRisk", () => {
  it("returns all-zero inputs for a patient with no history", async () => {
    const patient = await seedTestPatient();
    const result = await computeHospitalizationRisk(patient.id);
    expect(result.inputs).toEqual({
      alertCount7d: 0,
      feverRecurrenceCount7d: 0,
      severeDayCount7d: 0,
      maxTrendDelta7d: 0,
      avgDailyModelProb7d: 0,
      caregiverBurdenFlag7d: 0,
    });
  });

  it("only counts alerts and logs within the trailing 7 days, not older history", async () => {
    const patient = await seedTestPatient();

    // A fever spike 10 days ago — outside the 7-day window.
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 5, nausea: 5, fatigue: 5, fever: 102, createdAt: daysAgo(10) },
    });
    // A fever spike 2 days ago — inside the window.
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 5, nausea: 5, fatigue: 5, fever: 101, createdAt: daysAgo(2) },
    });

    const result = await computeHospitalizationRisk(patient.id);
    expect(result.inputs.feverRecurrenceCount7d).toBe(1); // only the recent one
  });

  it("reflects clinical alert count from the trailing 7 days", async () => {
    const patient = await seedTestPatient();
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN", createdAt: daysAgo(1) },
    });
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "YELLOW", reasons: "[]", status: "OPEN", createdAt: daysAgo(3) },
    });
    // Outside the window — should not count.
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN", createdAt: daysAgo(9) },
    });

    const result = await computeHospitalizationRisk(patient.id);
    expect(result.inputs.alertCount7d).toBe(2);
  });

  it("sets caregiverBurdenFlag7d only when a CAREGIVER_BURDEN alert exists in the trailing 7 days", async () => {
    const patient = await seedTestPatient();
    await seedTestCaregiver(patient.id);

    const before = await computeHospitalizationRisk(patient.id);
    expect(before.inputs.caregiverBurdenFlag7d).toBe(0);

    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "CAREGIVER_BURDEN", reasons: "[]", status: "OPEN", createdAt: daysAgo(1) },
    });

    const after = await computeHospitalizationRisk(patient.id);
    expect(after.inputs.caregiverBurdenFlag7d).toBe(1);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("counts severe days (pain or nausea >= 7) within the window", async () => {
    const patient = await seedTestPatient();
    await prisma.symptomLog.create({ data: { patientId: patient.id, pain: 8, nausea: 1, fatigue: 2, fever: 98.4, createdAt: daysAgo(1) } });
    await prisma.symptomLog.create({ data: { patientId: patient.id, pain: 1, nausea: 7, fatigue: 2, fever: 98.4, createdAt: daysAgo(2) } });
    await prisma.symptomLog.create({ data: { patientId: patient.id, pain: 3, nausea: 3, fatigue: 2, fever: 98.4, createdAt: daysAgo(3) } });

    const result = await computeHospitalizationRisk(patient.id);
    expect(result.inputs.severeDayCount7d).toBe(2);
  });
});
