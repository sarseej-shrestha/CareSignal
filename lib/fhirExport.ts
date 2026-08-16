// FHIR-lite export — structures a patient's recent symptom logs and risk
// alerts as simplified, FHIR R4-SHAPED resources (Patient, Condition,
// Observation, RiskAssessment, Flag).
//
// Honest scope: this is a demonstration of interoperability THINKING, not a
// certified FHIR integration — but it HAS been run through a real validator
// (HL7's reference HAPI FHIR server, POST /Bundle/$validate) across four
// rounds, not just assumed conformant. The first three rounds each found a
// genuine structural defect that got fixed here: every entry missing a
// fullUrl; unresolvable relative references; an invalid `total` field on a
// collection-type bundle; one resource id over FHIR's 64-char limit; and —
// found only after the first fullUrl fix was itself wrong — that
// Bundle.entry.fullUrl must be a genuine absolute URI (a real URL or a
// proper urn:uuid, not a relative "ResourceType/id" string, which is valid
// for a *reference* field but not for fullUrl itself). The fourth round,
// against this file's current code, came back with ZERO errors — 111
// warnings remain, all four are HL7 "best practice recommendation" /
// cosmetic categories (should-have-narrative, should-have-performer,
// unregistered CodeSystem for our deliberately local nausea code and for
// loinc.org itself since the public validator doesn't have LOINC loaded,
// and a UCUM human-readable-annotation caution), none of which block
// conformance. See docs/fhir-validation-results.md for the full
// round-by-round numbers and diagnostics. On that basis this bundle can
// honestly be called "FHIR-conformant" (passes structural validation) with
// disclosed, non-blocking best-practice warnings — not "FHIR-certified,"
// which would require a formal HL7/ONC certification process this project
// hasn't gone through.
//
// Verified LOINC codes used here (checked against loinc.org):
//   72514-3  Pain severity - 0-10 verbal numeric rating [Score] - Reported
//   8310-5   Body temperature
//   72349-4  Level of fatigue [Reported] (closest available 0-10-shaped
//            fatigue-severity code; LOINC's wording is "on average over the
//            past month," which doesn't exactly match a same-day 0-10
//            report — used as the closest verified fit, not a perfect one)
// No LOINC code for a same-day 0-10 NAUSEA SEVERITY score could be found and
// verified (81660-3 is nausea PRESENCE/absence, a different question) — that
// field uses an explicit local code (see NAUSEA_CODE below) rather than a
// guessed LOINC number presented as real.

import { randomUUID } from "node:crypto";
import { prisma } from "./db";

const LOCAL_SYSTEM = "http://caresignal.example/local-codes";

const PAIN_CODE = { system: "http://loinc.org", code: "72514-3", display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported" };
const FATIGUE_CODE = { system: "http://loinc.org", code: "72349-4", display: "Level of fatigue [Reported] (approximate match — see lib/fhirExport.ts)" };
const TEMPERATURE_CODE = { system: "http://loinc.org", code: "8310-5", display: "Body temperature" };
const NAUSEA_CODE = { system: LOCAL_SYSTEM, code: "nausea-severity-0-10", display: "Nausea severity, 0-10 self-reported (local code — no verified matching LOINC code found)" };

// Every entry gets a fresh urn:uuid: fullUrl, independent of the resource's
// own descriptive `.id` (e.g. "obs-pain-{uuid}") — fullUrl and id are
// different FHIR concepts: id is the resource's own local identifier
// (allows readable, non-UUID strings), fullUrl is the bundle entry's
// identity (must be a genuine absolute URI). Conflating them was the
// second validation failure found here.
function newFullUrl(): string {
  return `urn:uuid:${randomUUID()}`;
}

function observation(params: {
  id: string;
  subjectRef: { reference: string };
  code: { system: string; code: string; display: string };
  value: number;
  unit: string;
  ucumCode: string;
  effectiveDateTime: string;
}) {
  return {
    resourceType: "Observation",
    id: params.id,
    status: "final",
    category: [
      {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }],
      },
    ],
    code: { coding: [params.code] },
    subject: params.subjectRef,
    effectiveDateTime: params.effectiveDateTime,
    valueQuantity: { value: params.value, unit: params.unit, system: "http://unitsofmeasure.org", code: params.ucumCode },
  };
}

export async function buildFhirBundle(patientId: string) {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      symptomLogs: { orderBy: { createdAt: "desc" }, take: 7 },
      alerts: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!patient) return null;

  // The Patient is the only resource anything else in this bundle
  // references, so its fullUrl needs to be known up front and reused —
  // every other resource's fullUrl is independent, since nothing points at
  // an Observation/Condition/RiskAssessment/Flag from elsewhere in the bundle.
  const patientFullUrl = newFullUrl();
  const subjectRef = { reference: patientFullUrl };

  const patientResource = {
    resourceType: "Patient",
    id: patient.id,
    identifier: [{ system: "http://caresignal.example/mrn", value: patient.mrn }],
    name: [{ text: `${patient.firstName} ${patient.lastName}`, family: patient.lastName, given: [patient.firstName] }],
    telecom: [{ system: "phone", value: patient.phone }],
    communication: [{ language: { coding: [{ system: "urn:ietf:bcp:47", code: patient.preferredLanguage }] } }],
    address: [{ district: `${patient.parish} Parish`, state: "LA", country: "US" }],
  };

  const conditionResource = {
    resourceType: "Condition",
    id: `condition-${patient.id}`,
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }],
    },
    code: { text: patient.cancerType },
    subject: subjectRef,
    note: [{ text: `Treatment stage: ${patient.chemoCycle}` }],
  };

  const observationResources = patient.symptomLogs.flatMap((log) => {
    const effectiveDateTime = log.createdAt.toISOString();
    return [
      observation({ id: `obs-pain-${log.id}`, subjectRef, code: PAIN_CODE, value: log.pain, unit: "score", ucumCode: "{score}", effectiveDateTime }),
      observation({ id: `obs-nausea-${log.id}`, subjectRef, code: NAUSEA_CODE, value: log.nausea, unit: "score", ucumCode: "{score}", effectiveDateTime }),
      observation({ id: `obs-fatigue-${log.id}`, subjectRef, code: FATIGUE_CODE, value: log.fatigue, unit: "score", ucumCode: "{score}", effectiveDateTime }),
      observation({ id: `obs-temp-${log.id}`, subjectRef, code: TEMPERATURE_CODE, value: log.fever, unit: "degF", ucumCode: "[degF]", effectiveDateTime }),
    ];
  });

  const clinicalAlerts = patient.alerts.filter((a) => a.level === "YELLOW" || a.level === "RED");
  const riskAssessmentResources = clinicalAlerts.map((alert) => ({
    resourceType: "RiskAssessment",
    id: `riskassessment-${alert.id}`,
    status: "final",
    subject: subjectRef,
    occurrenceDateTime: alert.createdAt.toISOString(),
    prediction: [
      {
        outcome: { text: "Symptom escalation requiring clinical attention" },
        qualitativeRisk: { coding: [{ system: LOCAL_SYSTEM, code: alert.level, display: alert.level }] },
        ...(alert.modelProb != null ? { probabilityDecimal: alert.modelProb } : {}),
        rationale: (JSON.parse(alert.reasons) as string[]).join("; "),
      },
    ],
    note: [
      {
        text: "Generated by CareSignal's two-layer risk engine (interpretable rules + a trained classifier) — see docs/model-calibration.md. Not a clinically validated risk score.",
      },
    ],
  }));

  // A separate, second RiskAssessment for the hospitalization forecast —
  // deliberately not merged with the daily risk assessments above, mirroring
  // the same "different model, different time horizon" separation the
  // dashboard itself maintains (see lib/hospitalizationRisk.ts). Id kept
  // short (well under FHIR's 64-char resource id limit — the original
  // "riskassessment-hospitalization-{uuid}" scheme was 68 chars and the
  // validator rejected it outright).
  const hospitalizationRiskResource = {
    resourceType: "RiskAssessment",
    id: `hosp-risk-${patient.id}`,
    status: "final",
    subject: subjectRef,
    occurrenceDateTime: new Date().toISOString(),
    prediction: [
      {
        outcome: { text: "Hospitalization within 7 days" },
        probabilityDecimal: patient.hospitalizationRiskScore,
      },
    ],
    note: [
      {
        text: "Separate model from the daily symptom RiskAssessment(s) above — a 7-day rolling forecast, not a same-day severity flag. See docs/model-calibration.md.",
      },
    ],
  };

  const burdenAlert = patient.alerts.find((a) => a.level === "CAREGIVER_BURDEN");
  const flagResources = burdenAlert
    ? [
        {
          resourceType: "Flag",
          id: `flag-caregiver-burden-${burdenAlert.id}`,
          status: "active",
          category: [
            { coding: [{ system: "http://terminology.hl7.org/CodeSystem/flag-category", code: "safety", display: "Safety" }] },
          ],
          code: { text: `Caregiver burden signal (distinct from patient clinical risk): ${(JSON.parse(burdenAlert.reasons) as string[]).join("; ")}` },
          subject: subjectRef,
          period: { start: burdenAlert.createdAt.toISOString() },
        },
      ]
    : [];

  const otherResources = [
    conditionResource,
    ...observationResources,
    ...riskAssessmentResources,
    hospitalizationRiskResource,
    ...flagResources,
  ];

  return {
    resourceType: "Bundle",
    // type: "collection" (not "searchset"/"history") means Bundle.total
    // must NOT be present — FHIR's bdl-1 invariant. An earlier version
    // included a `total` count here, which the validator correctly
    // rejected; entry count is available as `entry.length` without needing
    // a dedicated field.
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: [
      { fullUrl: patientFullUrl, resource: patientResource },
      ...otherResources.map((resource) => ({ fullUrl: newFullUrl(), resource })),
    ],
  };
}
