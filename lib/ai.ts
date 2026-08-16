// LLM-backed freeform SMS parsing — the "this is really AI" demo beat. Two
// jobs: (1) parse a patient's freeform symptom text into structured scores,
// (2) parse a caregiver's freeform text, which might describe the patient's
// symptoms, the caregiver's own coping state, or both.
//
// Runs on Groq (OpenAI-compatible API, openai/gpt-oss-120b) rather than
// OpenAI directly — free tier, and notably doesn't train on submitted data,
// which is a better story for health-adjacent patient text than a paid
// provider would be. The `openai` SDK works unmodified against it via
// `baseURL`.
//
// Both use structured-output mode (a strict JSON schema) so the model can't
// return malformed data — the schema IS the contract, not a "please respond
// in JSON" prompt instruction.

import OpenAI from "openai";

const MODEL = "openai/gpt-oss-120b";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set — freeform SMS parsing requires it.");
    }
    client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  }
  return client;
}

export interface ParsedPatientSymptoms {
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  feverMentioned: boolean;
  summary: string;
}

const PATIENT_SYMPTOM_SCHEMA = {
  type: "object",
  properties: {
    pain: { type: "integer", minimum: 0, maximum: 10 },
    nausea: { type: "integer", minimum: 0, maximum: 10 },
    fatigue: { type: "integer", minimum: 0, maximum: 10 },
    feverF: { type: ["number", "null"], description: "Temperature in Fahrenheit if mentioned, else null." },
    feverMentioned: { type: "boolean" },
    summary: { type: "string", description: "One short clinical-style paraphrase of what the patient reported." },
  },
  required: ["pain", "nausea", "fatigue", "feverF", "feverMentioned", "summary"],
  additionalProperties: false,
} as const;

const PATIENT_SYSTEM_PROMPT = `You are a clinical intake assistant for CareSignal, an oncology symptom-monitoring
system. A cancer patient undergoing chemotherapy has sent a freeform text message describing how they feel today.

Extract PRO-CTCAE-style severity scores on a 0-10 scale (0 = none, 10 = worst imaginable) for pain, nausea, and
fatigue, inferring reasonable values from the patient's own words even if they didn't use numbers. If a symptom
isn't mentioned at all, assume it is unchanged/mild and score it low (0-2), not zero by default — use judgment.
If a temperature or fever is mentioned, extract it in Fahrenheit; if the patient explicitly says "no fever," set
feverF to 98.6 and feverMentioned to true. If fever is not discussed at all, set feverF to 98.6 and feverMentioned
to false. Never invent a high fever the patient didn't describe.`;

export async function parsePatientSymptomText(text: string): Promise<ParsedPatientSymptoms> {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: PATIENT_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "patient_symptoms", strict: true, schema: PATIENT_SYMPTOM_SCHEMA },
    },
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Model returned no content for patient symptom parsing.");
  const parsed = JSON.parse(raw);

  return {
    pain: parsed.pain,
    nausea: parsed.nausea,
    fatigue: parsed.fatigue,
    fever: parsed.feverF ?? 98.6,
    feverMentioned: parsed.feverMentioned,
    summary: parsed.summary,
  };
}

export interface ParsedCaregiverMessage {
  intent: "PATIENT_SYMPTOMS" | "CAREGIVER_COPING" | "BOTH" | "UNCLEAR";
  patientSymptoms: ParsedPatientSymptoms | null;
  caregiverCoping: { patientStatus: number; copingScore: number } | null;
  summary: string;
}

const CAREGIVER_MESSAGE_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["PATIENT_SYMPTOMS", "CAREGIVER_COPING", "BOTH", "UNCLEAR"] },
    patientSymptoms: {
      type: ["object", "null"],
      properties: {
        pain: { type: "integer", minimum: 0, maximum: 10 },
        nausea: { type: "integer", minimum: 0, maximum: 10 },
        fatigue: { type: "integer", minimum: 0, maximum: 10 },
        feverF: { type: ["number", "null"] },
        feverMentioned: { type: "boolean" },
      },
      required: ["pain", "nausea", "fatigue", "feverF", "feverMentioned"],
      additionalProperties: false,
    },
    caregiverCoping: {
      type: ["object", "null"],
      properties: {
        patientStatus: { type: "integer", minimum: 1, maximum: 5, description: "Caregiver's rating of how the patient is doing overall, 1=very poor, 5=very well." },
        copingScore: { type: "integer", minimum: 1, maximum: 5, description: "How well the caregiver is coping, 1=overwhelmed, 5=doing fine." },
      },
      required: ["patientStatus", "copingScore"],
      additionalProperties: false,
    },
    summary: { type: "string" },
  },
  required: ["intent", "patientSymptoms", "caregiverCoping", "summary"],
  additionalProperties: false,
} as const;

const CAREGIVER_SYSTEM_PROMPT = `You are a clinical intake assistant for CareSignal, an oncology symptom-monitoring
system. A cancer patient's caregiver (family member) has sent a freeform text message. Caregivers text in for two
different reasons, sometimes both at once:
1. Relaying the PATIENT's symptoms because the patient can't text themselves (pain/nausea/fatigue/fever, same
   0-10 PRO-CTCAE scale as a patient self-report; fever in Fahrenheit).
2. Reporting on THEIR OWN caregiving experience: how the patient seems to be doing overall (patientStatus, 1-5,
   caregiver's own impression) and how well THEY (the caregiver) are coping (copingScore, 1-5, where 1 means
   overwhelmed/burned out and 5 means doing fine). Watch for signs of caregiver burden — exhaustion, feeling
   unable to keep going, isolation, resentment, physical/emotional strain — even when not stated in clinical
   language, and reflect that in a low copingScore.

Decide the intent: PATIENT_SYMPTOMS if only relaying the patient's condition, CAREGIVER_COPING if only describing
their own state, BOTH if the message does both, UNCLEAR if genuinely ambiguous (in which case make your best guess
for whichever fields you can and set the other to null only if truly not addressed at all). Only fill in
patientSymptoms or caregiverCoping if that intent applies; otherwise set that field to null.`;

export async function parseCaregiverMessageText(text: string): Promise<ParsedCaregiverMessage> {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: CAREGIVER_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "caregiver_message", strict: true, schema: CAREGIVER_MESSAGE_SCHEMA },
    },
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Model returned no content for caregiver message parsing.");
  const parsed = JSON.parse(raw);

  return {
    intent: parsed.intent,
    patientSymptoms: parsed.patientSymptoms
      ? {
          pain: parsed.patientSymptoms.pain,
          nausea: parsed.patientSymptoms.nausea,
          fatigue: parsed.patientSymptoms.fatigue,
          fever: parsed.patientSymptoms.feverF ?? 98.6,
          feverMentioned: parsed.patientSymptoms.feverMentioned,
          summary: parsed.summary,
        }
      : null,
    caregiverCoping: parsed.caregiverCoping,
    summary: parsed.summary,
  };
}
