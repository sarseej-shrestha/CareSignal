// Real content, not invented for this demo. The message text, risk numbers,
// reasons, SOAP note, and FHIR shape below are pulled directly from
// CareSignal's actual seeded scenarios (lib/seedData.ts) and from real
// output the running app produced against those scenarios: an actual
// /api/demo/trigger response (risk score, reasons) and an actual
// Groq-generated SOAP note for this exact patient and message. This file
// only replays that real output client-side, since GitHub Pages has no
// server, database, or API keys to call live.

const DEMO_DATA = {
  patient: {
    firstName: "Denise",
    lastName: "Guidry",
    phone: "985-555-0144",
    cancerType: "Non-small cell lung cancer",
    chemoCycle: "Cycle 4 of 6",
    parish: "Terrebonne",
    message:
      "feeling a lot worse today, pain's up a lot and I'm just wiped out, no fever though",
    pain: 7,
    nausea: 4,
    fatigue: 6,
    fever: 98.7,
  },

  symptomsDetected: [
    "Severe pain (7/10)",
    "Elevated nausea (4/10)",
    "Significant fatigue (6/10)",
    "No fever reported",
  ],

  risk: {
    rulesOnlyLevel: "YELLOW",
    level: "RED",
    score: 0.96,
    reasons: [
      "Sustained symptom escalation, pain up 3.5 points vs. prior 2-day average",
      "Moderate pain (7/10)",
      "Model probability high (p=0.96), escalating trend flag",
    ],
  },

  soapNote: {
    subjective:
      "Denise reports worsening pain, now 7/10, along with increasing nausea (4/10) and fatigue (6/10) over the past day. She denies fever or other new symptoms.",
    objective:
      "Pain scores rose from 2-3/10 five days ago to 7/10 today. Nausea increased from 2-3/10 to 4/10. Fatigue rose from 4-5/10 to 6/10. Recorded temperatures remain afebrile (98.3-98.7°F). The CareSignal model flags RED risk (probability 0.96) with a 36% 7-day hospitalization forecast.",
    assessment:
      "The symptom trajectory corresponds to Grade 3 pain, Grade 2 nausea, and Grade 3 fatigue per PRO-CTCAE, without fever (below the 100.4°F neutropenic fever threshold). Combined with the high model probability and sustained escalation alert, Denise is at elevated risk for hospitalization.",
    plan:
      "Consider a prompt nurse-initiated outreach to reassess pain management and explore escalation of analgesics. Recommend reviewing recent labs and possibly ordering a CBC to rule out neutropenia. Suggest discussing supportive care measures for nausea and fatigue. Evaluate the need for urgent clinical evaluation given the RED risk status.",
  },

  caregiver: {
    firstName: "Angela",
    lastName: "Trahan",
    relationship: "Daughter",
    patientFirstName: "Ruth",
    patientLastName: "Trahan",
    earlierMessage:
      "I don't know how much longer I can keep doing this on top of my own job. I'm exhausted.",
    earlierTimestamp: "2 days ago",
    finalMessage: "A little better today but still really overwhelmed.",
    reasons: [
      "Caregiver coping score 2/5 (“overwhelmed”), 3 of last 3 check-ins at or below threshold",
      "Caregiver check-in flags exhaustion and burnout risk",
    ],
  },

  hospitalization: {
    score: 0.52,
    hasRecentHistory: true,
    factors: [
      "Caregiver burden alert in the past 7 days",
      "Sustained elevated daily risk across the week",
    ],
  },

  fhir: {
    resourceType: "Bundle",
    type: "collection",
    timestamp: "2026-08-24T14:32:00.000Z",
    entry: [
      {
        fullUrl: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21",
        resource: {
          resourceType: "Patient",
          id: "guidry-70144",
          identifier: [{ system: "http://caresignal.example/mrn", value: "OCH-70144" }],
          name: [{ text: "Denise Guidry", family: "Guidry", given: ["Denise"] }],
          telecom: [{ system: "phone", value: "985-555-0144" }],
          communication: [{ language: { coding: [{ system: "urn:ietf:bcp:47", code: "en" }] } }],
          address: [{ district: "Terrebonne Parish", state: "LA", country: "US" }],
        },
      },
      {
        fullUrl: "urn:uuid:3a9d5f10-6c44-4b8e-8e2a-5f0c9b2d7a44",
        resource: {
          resourceType: "Condition",
          id: "condition-guidry-70144",
          clinicalStatus: {
            coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }],
          },
          code: { text: "Non-small cell lung cancer" },
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          note: [{ text: "Treatment stage: Cycle 4 of 6" }],
        },
      },
      {
        fullUrl: "urn:uuid:1c7e2b90-4f3d-4a8c-9d1e-6b2a0f8c3e55",
        resource: {
          resourceType: "Observation",
          id: "obs-pain-guidry-final",
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }] }],
          code: { coding: [{ system: "http://loinc.org", code: "72514-3", display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported" }] },
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          effectiveDateTime: "2026-08-24T13:05:00.000Z",
          valueQuantity: { value: 7, unit: "score", system: "http://unitsofmeasure.org", code: "{score}" },
        },
      },
      {
        fullUrl: "urn:uuid:6e4a1d20-8b5c-4f2e-a3d6-9c1b7e0f4a66",
        resource: {
          resourceType: "Observation",
          id: "obs-nausea-guidry-final",
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }] }],
          code: { coding: [{ system: "http://caresignal.example/local-codes", code: "nausea-severity-0-10", display: "Nausea severity, 0-10 self-reported (local code, no verified matching LOINC code found)" }] },
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          effectiveDateTime: "2026-08-24T13:05:00.000Z",
          valueQuantity: { value: 4, unit: "score", system: "http://unitsofmeasure.org", code: "{score}" },
        },
      },
      {
        fullUrl: "urn:uuid:9d2f6a30-1e7b-4c9d-b4e7-2a0f8c3d5b77",
        resource: {
          resourceType: "Observation",
          id: "obs-fatigue-guidry-final",
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }] }],
          code: { coding: [{ system: "http://loinc.org", code: "72349-4", display: "Level of fatigue [Reported]" }] },
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          effectiveDateTime: "2026-08-24T13:05:00.000Z",
          valueQuantity: { value: 6, unit: "score", system: "http://unitsofmeasure.org", code: "{score}" },
        },
      },
      {
        fullUrl: "urn:uuid:2b8e4c50-3f9a-4d1b-8c5e-7a1f0b2d9c88",
        resource: {
          resourceType: "Observation",
          id: "obs-temp-guidry-final",
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }] }],
          code: { coding: [{ system: "http://loinc.org", code: "8310-5", display: "Body temperature" }] },
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          effectiveDateTime: "2026-08-24T13:05:00.000Z",
          valueQuantity: { value: 98.7, unit: "degF", system: "http://unitsofmeasure.org", code: "[degF]" },
        },
      },
      {
        fullUrl: "urn:uuid:4c9f7d60-2a8b-4e3c-9d6f-1b2a0e8c4d99",
        resource: {
          resourceType: "RiskAssessment",
          id: "riskassessment-guidry-final",
          status: "final",
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          occurrenceDateTime: "2026-08-24T13:05:00.000Z",
          prediction: [
            {
              outcome: { text: "Symptom escalation requiring clinical attention" },
              qualitativeRisk: { coding: [{ system: "http://caresignal.example/local-codes", code: "RED", display: "RED" }] },
              probabilityDecimal: 0.96,
              rationale: "Sustained symptom escalation, pain up 3.5 points vs. prior 2-day average; Moderate pain (7/10); Model probability high (p=0.96), escalating trend flag",
            },
          ],
          note: [{ text: "Generated by CareSignal's two-layer risk engine (interpretable rules + a trained classifier). Not a clinically validated risk score." }],
        },
      },
      {
        fullUrl: "urn:uuid:7a1e3f70-5b9c-4a2d-8e3f-0c1b2a9d5e00",
        resource: {
          resourceType: "RiskAssessment",
          id: "hosp-risk-guidry",
          status: "final",
          subject: { reference: "urn:uuid:8f2c1e6a-2b0a-4e2f-9b3a-1d7c6a0e1f21" },
          occurrenceDateTime: "2026-08-24T13:05:00.000Z",
          prediction: [{ outcome: { text: "Hospitalization within 7 days" }, probabilityDecimal: 0.36 }],
          note: [{ text: "Separate model from the daily symptom RiskAssessment above, a 7-day rolling forecast, not a same-day severity flag." }],
        },
      },
    ],
  },
};
