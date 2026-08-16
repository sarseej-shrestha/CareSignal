import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFhirBundle } from "@/lib/fhirExport";
import { resetDb, seedTestPatient, seedTestCaregiver } from "../helpers/db";

beforeEach(resetDb);
afterEach(resetDb);

describe("buildFhirBundle", () => {
  it("returns null for an unknown patient id", async () => {
    expect(await buildFhirBundle("does-not-exist")).toBeNull();
  });

  it("produces a small but well-formed bundle for a brand-new patient with no logs, alerts, or caregiver — not empty or malformed", async () => {
    const patient = await seedTestPatient();
    const bundle = await buildFhirBundle(patient.id);

    expect(bundle).not.toBeNull();
    expect(bundle!.resourceType).toBe("Bundle");
    // Patient + Condition + the always-present hospitalization RiskAssessment
    // (score 0, since there's no history to elevate it) — nothing else, since
    // there's genuinely nothing else to report yet.
    const resources = bundle!.entry.map((e) => e.resource);
    expect(resources.map((r: any) => r.resourceType).sort()).toEqual(["Condition", "Patient", "RiskAssessment"]);
    expect(resources.filter((r: any) => r.resourceType === "Observation")).toHaveLength(0);
    expect(resources.filter((r: any) => r.resourceType === "Flag")).toHaveLength(0);

    const hospRisk = resources.find((r: any) => r.id.startsWith("hosp-risk-")) as any;
    expect(hospRisk.prediction[0].probabilityDecimal).toBe(0);

    // Every entry still has a valid fullUrl even in this minimal case.
    for (const entry of bundle!.entry as any[]) {
      expect(entry.fullUrl).toMatch(/^urn:uuid:/);
    }
  });

  it("falls back to 'en' for an invalid/garbage preferredLanguage value instead of embedding it raw", async () => {
    const patient = await seedTestPatient({ preferredLanguage: "not-a-real-language-code" });
    const bundle = await buildFhirBundle(patient.id);

    const patientResource = bundle!.entry.map((e) => e.resource).find((r: any) => r.resourceType === "Patient") as any;
    expect(patientResource.communication[0].language.coding[0].code).toBe("en");
  });

  it("includes a Patient and Condition resource with correct identifiers", async () => {
    const patient = await seedTestPatient({ mrn: "MRN-1", firstName: "Ada", lastName: "Lovelace", cancerType: "Leukemia" });
    const bundle = await buildFhirBundle(patient.id);

    const resources = bundle!.entry.map((e) => e.resource);
    const patientResource = resources.find((r: any) => r.resourceType === "Patient") as any;
    const conditionResource = resources.find((r: any) => r.resourceType === "Condition") as any;

    expect(patientResource.id).toBe(patient.id);
    expect(patientResource.identifier[0]).toEqual({ system: "http://caresignal.example/mrn", value: "MRN-1" });
    expect(patientResource.name[0].family).toBe("Lovelace");
    expect(conditionResource.code.text).toBe("Leukemia");
  });

  it("produces one Observation per symptom per log, using the verified LOINC codes for pain/fatigue/temperature", async () => {
    const patient = await seedTestPatient();
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 5, nausea: 3, fatigue: 6, fever: 99.1, source: "PATIENT_SMS" },
    });

    const bundle = await buildFhirBundle(patient.id);
    const observations = bundle!.entry.map((e) => e.resource).filter((r: any) => r.resourceType === "Observation") as any[];

    expect(observations).toHaveLength(4); // pain, nausea, fatigue, temperature

    const pain = observations.find((o) => o.code.coding[0].code === "72514-3");
    expect(pain.code.coding[0].system).toBe("http://loinc.org");
    expect(pain.valueQuantity.value).toBe(5);

    const temp = observations.find((o) => o.code.coding[0].code === "8310-5");
    expect(temp.valueQuantity.value).toBe(99.1);
    expect(temp.valueQuantity.unit).toBe("degF");

    // Nausea has no verified matching LOINC code — must use the explicit local code, not a guessed LOINC number.
    const nausea = observations.find((o) => o.valueQuantity.value === 3);
    expect(nausea.code.coding[0].system).toBe("http://caresignal.example/local-codes");
  });

  it("only includes the trailing 7 logs, not full history", async () => {
    const patient = await seedTestPatient();
    for (let i = 0; i < 10; i++) {
      await prisma.symptomLog.create({
        data: { patientId: patient.id, pain: 1, nausea: 1, fatigue: 1, fever: 98.4, source: "PATIENT_SMS" },
      });
    }
    const bundle = await buildFhirBundle(patient.id);
    const observations = bundle!.entry.map((e) => e.resource).filter((r: any) => r.resourceType === "Observation");
    expect(observations).toHaveLength(7 * 4); // 7 logs x 4 symptoms each
  });

  it("includes a RiskAssessment for each open clinical alert, with reasons as the rationale", async () => {
    const patient = await seedTestPatient();
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: JSON.stringify(["Fever 101°F"]), modelProb: 0.9, status: "OPEN" },
    });
    // A RESOLVED alert should not appear.
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "YELLOW", reasons: JSON.stringify(["old"]), status: "RESOLVED" },
    });

    const bundle = await buildFhirBundle(patient.id);
    const riskAssessments = bundle!.entry.map((e) => e.resource).filter((r: any) => r.resourceType === "RiskAssessment") as any[];

    // 1 for the open clinical alert + 1 for the hospitalization forecast (always present, separate model).
    expect(riskAssessments).toHaveLength(2);
    const dailyRisk = riskAssessments.find((r) => r.id.startsWith("riskassessment-"));
    expect(dailyRisk.prediction[0].rationale).toBe("Fever 101°F");
    expect(dailyRisk.prediction[0].probabilityDecimal).toBe(0.9);

    const hospRisk = riskAssessments.find((r) => r.id.startsWith("hosp-risk-"));
    expect(hospRisk.prediction[0].outcome.text).toBe("Hospitalization within 7 days");
    expect(hospRisk.id.length).toBeLessThanOrEqual(64); // FHIR resource id limit — this one was 68 chars before the fix
  });

  it("includes a Flag resource only when a CAREGIVER_BURDEN alert exists", async () => {
    const patient = await seedTestPatient();
    await seedTestCaregiver(patient.id);

    const withoutBurden = await buildFhirBundle(patient.id);
    expect(withoutBurden!.entry.some((e: any) => e.resource.resourceType === "Flag")).toBe(false);

    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "CAREGIVER_BURDEN", reasons: JSON.stringify(["Coping score 1/5"]), status: "OPEN" },
    });

    const withBurden = await buildFhirBundle(patient.id);
    const flag = withBurden!.entry.map((e) => e.resource).find((r: any) => r.resourceType === "Flag") as any;
    expect(flag).toBeDefined();
    expect(flag.code.text).toContain("Coping score 1/5");
  });

  // These two lock in the specific defects the real HAPI FHIR validator
  // found (see docs/fhir-validation-results.md) so they can't silently
  // regress.
  it("gives every entry a fullUrl, and every cross-reference resolves to a fullUrl actually present in the bundle", async () => {
    const patient = await seedTestPatient();
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 3, nausea: 3, fatigue: 3, fever: 98.5, source: "PATIENT_SMS" },
    });

    const bundle = await buildFhirBundle(patient.id);
    const fullUrls = new Set(bundle!.entry.map((e: any) => e.fullUrl));

    for (const entry of bundle!.entry as any[]) {
      expect(entry.fullUrl).toBeTruthy();
      const subjectRef = entry.resource.subject?.reference;
      if (subjectRef) expect(fullUrls.has(subjectRef)).toBe(true);
    }
  });

  it("never includes a Bundle.total — invalid per FHIR's bdl-1 constraint for a 'collection' type bundle", async () => {
    const patient = await seedTestPatient();
    const bundle = await buildFhirBundle(patient.id);
    expect(bundle!.type).toBe("collection");
    expect(bundle).not.toHaveProperty("total");
  });
});
