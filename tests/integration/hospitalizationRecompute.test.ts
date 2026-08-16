// Regression coverage for a real shipped bug: recordCaregiverLog() had an
// early return on the "coping is fine" branch that exited before
// computeHospitalizationRisk() ever ran, so a caregiver's coping score
// IMPROVING never updated the patient's stored hospitalizationRiskScore —
// only a bad coping score (which stays inside the burden-flagged branch)
// did. A test that only checks the CaregiverLog row was created would NOT
// have caught this — the write that mattered was the one to
// Patient.hospitalizationRiskScore, not CaregiverLog.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recordCaregiverLog } from "@/lib/inbound";
import { computeHospitalizationRisk } from "@/lib/hospitalizationRisk";
import { resetDb, seedTestPatient, seedTestCaregiver } from "../helpers/db";

beforeEach(resetDb);
afterEach(resetDb);

describe("recordCaregiverLog — hospitalizationRiskScore recompute", () => {
  it("recomputes and persists hospitalizationRiskScore on a high-coping (non-burden) log, not just on the burden-flagged branch", async () => {
    const patient = await seedTestPatient();
    const caregiver = await seedTestCaregiver(patient.id);

    // Build up real low-coping history so the stored score is genuinely
    // elevated by a CAREGIVER_BURDEN alert — this branch was never buggy,
    // but the regression needs real elevated state to start from.
    for (let i = 0; i < 3; i++) {
      await recordCaregiverLog({
        caregiverId: caregiver.id,
        patientId: patient.id,
        patientStatus: 3,
        copingScore: 1,
      });
    }

    const elevated = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    const elevatedRecompute = await computeHospitalizationRisk(patient.id);
    expect(elevatedRecompute.inputs.caregiverBurdenFlag7d).toBe(1);
    expect(elevated.hospitalizationRiskScore).toBeCloseTo(elevatedRecompute.score, 10);

    // Simulate a stale stored score — the observable symptom of the bug.
    // Note: we do NOT rely on "the score changes after the next log" as the
    // signal, because caregiverBurdenFlag7d is windowed by the burden
    // alert's createdAt (see lib/hospitalizationFeatures.ts), not by
    // current coping status — it won't roll off within this test, so a
    // CORRECT recompute right after can legitimately reproduce the exact
    // same number. Writing an impossible sentinel (outside a model
    // probability's [0,1] range) makes "did the recompute actually run and
    // overwrite this" unambiguous regardless of what the real feature
    // values happen to be.
    await prisma.patient.update({ where: { id: patient.id }, data: { hospitalizationRiskScore: -1 } });

    // The regression case: a GOOD coping score — the exact branch that used
    // to return before ever reaching the recompute.
    const result = await recordCaregiverLog({
      caregiverId: caregiver.id,
      patientId: patient.id,
      patientStatus: 5,
      copingScore: 5,
    });
    expect(result.burdenFlagged).toBe(false);

    const after = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(after.hospitalizationRiskScore).not.toBe(-1);

    const freshRecompute = await computeHospitalizationRisk(patient.id);
    expect(after.hospitalizationRiskScore).toBeCloseTo(freshRecompute.score, 10);
  });
});
