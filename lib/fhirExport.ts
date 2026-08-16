// FHIR-lite export — structures a patient's recent symptom logs and risk
// alerts as simplified, FHIR R4-SHAPED resources (Patient, Condition,
// Observation, RiskAssessment, Flag).
//
// Honest scope: this is a demonstration of interoperability THINKING, not a
// certified FHIR integration. It has NOT been validated against the FHIR R4
// specification, a real implementation guide (e.g. US Core), or a FHIR
// validator — resource shapes are illustrative and simplified (e.g. no
// `meta.profile`, no full terminology binding). Where a code is used, it is
// either a real, verified LOINC code (checked against loinc.org — see the
// comments below) or an explicitly local, made-up code, never presented as
// something it isn't.
//
// Verified LOINC codes used here:
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

import { prisma } from "./db";

const LOCAL_SYSTEM = "http://caresignal.example/local-codes";

const PAIN_CODE = { system: "http://loinc.org", code: "72514-3", display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported" };
const FATIGUE_CODE = { system: "http://loinc.org", code: "72349-4", display: "Level of fatigue [Reported] (approximate match — see lib/fhirExport.ts)" };
const TEMPERATURE_CODE = { system: "http://loinc.org", code: "8310-5", display: "Body temperature" };
const NAUSEA_CODE = { system: LOCAL_SYSTEM, code: "nausea-severity-0-10", display: "Nausea severity, 0-10 self-reported (local code — no verified matching LOINC code found)" };

function observation(params: {
  id: string;
  patientId: string;
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
    subject: { reference: `Patient/${params.patientId}` },
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
    subject: { reference: `Patient/${patient.id}` },
    note: [{ text: `Treatment stage: ${patient.chemoCycle}` }],
  };

  const observations = patient.symptomLogs.flatMap((log) => {
    const effectiveDateTime = log.createdAt.toISOString();
    return [
      observation({ id: `obs-pain-${log.id}`, patientId: patient.id, code: PAIN_CODE, value: log.pain, unit: "score", ucumCode: "{score}", effectiveDateTime }),
      observation({ id: `obs-nausea-${log.id}`, patientId: patient.id, code: NAUSEA_CODE, value: log.nausea, unit: "score", ucumCode: "{score}", effectiveDateTime }),
      observation({ id: `obs-fatigue-${log.id}`, patientId: patient.id, code: FATIGUE_CODE, value: log.fatigue, unit: "score", ucumCode: "{score}", effectiveDateTime }),
      observation({ id: `obs-temp-${log.id}`, patientId: patient.id, code: TEMPERATURE_CODE, value: log.fever, unit: "degF", ucumCode: "[degF]", effectiveDateTime }),
    ];
  });

  const clinicalAlerts = patient.alerts.filter((a) => a.level === "YELLOW" || a.level === "RED");
  const riskAssessments = clinicalAlerts.map((alert) => ({
    resourceType: "RiskAssessment",
    id: `riskassessment-${alert.id}`,
    status: "final",
    subject: { reference: `Patient/${patient.id}` },
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
  // dashboard itself maintains (see lib/hospitalizationRisk.ts).
  const hospitalizationRiskAssessment = {
    resourceType: "RiskAssessment",
    id: `riskassessment-hospitalization-${patient.id}`,
    status: "final",
    subject: { reference: `Patient/${patient.id}` },
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
  const flags = burdenAlert
    ? [
        {
          resourceType: "Flag",
          id: `flag-caregiver-burden-${burdenAlert.id}`,
          status: "active",
          category: [
            { coding: [{ system: "http://terminology.hl7.org/CodeSystem/flag-category", code: "safety", display: "Safety" }] },
          ],
          code: { text: `Caregiver burden signal (distinct from patient clinical risk): ${(JSON.parse(burdenAlert.reasons) as string[]).join("; ")}` },
          subject: { reference: `Patient/${patient.id}` },
          period: { start: burdenAlert.createdAt.toISOString() },
        },
      ]
    : [];

  const entries = [
    patientResource,
    conditionResource,
    ...observations,
    ...riskAssessments,
    hospitalizationRiskAssessment,
    ...flags,
  ];

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries.map((resource) => ({ resource })),
  };
}
