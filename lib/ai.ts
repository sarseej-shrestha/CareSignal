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
import { NEED_CATEGORIES, isNeedCategory, type NeedCategory } from "./needCategory";

const MODEL = "openai/gpt-oss-120b";

// A live pitch can't afford a hung request — the Twilio webhook needs to
// answer well within Twilio's own ~15s timeout, or the sender gets a carrier
// error with none of our friendlier fallback messaging. 8s leaves headroom
// for the rest of the request; maxRetries:1 (not the SDK's default of 2)
// keeps a transient failure from silently doubling that wait.
const REQUEST_TIMEOUT_MS = 8_000;
// gpt-oss-120b is a reasoning model — its completion includes hidden
// "reasoning" tokens spent before it writes the final JSON, and those count
// against this budget too. A tight cap (400 was tried and broke a working
// case: the model got cut off mid-object, missing the required `summary`
// field, which Groq itself then rejects as a schema-validation error) risks
// truncating valid output more often than it prevents a runaway response.
// 2000 is generous headroom for this schema's complexity while still being
// a real ceiling against a genuinely stuck/looping generation.
const MAX_COMPLETION_TOKENS = 2000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set — freeform SMS parsing requires it.");
    }
    client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return client;
}

// Runtime clamp applied to every model output as defense-in-depth on top of
// the JSON-schema bounds below — cheap insurance against a provider that
// enforces schema constraints loosely, or a future schema change that
// forgets a bound. Never let unvalidated model output reach the database.
function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value)));
}

function clampFever(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 98.6;
  return Math.max(90, Math.min(110, value));
}

function clampCoping(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

export interface ParsedPatientSymptoms {
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  feverMentioned: boolean;
  summary: string;
  // Routing label only — NOT a clinical decision. The LLM identifies what
  // kind of need this message represents; lib/needCategory.ts's deterministic
  // routing decides what happens with that label. Optional so existing
  // callers/tests that predate this field keep working unmodified — see
  // recordSymptomLog's default in lib/inbound.ts.
  needCategory?: NeedCategory;
  hasAdditionalNeeds?: boolean;
  // Semifinal red-team fix: lib/safetyGate.ts's deterministic regex list is
  // English/French/Spanish but necessarily finite — it can't catch every
  // paraphrase or indirect phrasing. This field lets the model, which
  // already understands crisis language across all three languages
  // (verified live during the audit — French/Spanish suicidal-ideation
  // messages were correctly summarized as such, just never acted on),
  // flag it explicitly instead of that recognition being silently
  // discarded into an ordinary EMOTIONAL classification. This is a SECOND,
  // redundant layer on top of the regex gate, not a replacement — the
  // regex gate still runs first and unconditionally, with zero LLM
  // dependency. Optional so pre-existing callers/tests default safely to
  // false rather than crashing on a missing field.
  crisisLanguageDetected?: boolean;
}

const PATIENT_SYMPTOM_SCHEMA = {
  type: "object",
  properties: {
    pain: { type: "integer", minimum: 0, maximum: 10 },
    nausea: { type: "integer", minimum: 0, maximum: 10 },
    fatigue: { type: "integer", minimum: 0, maximum: 10 },
    feverF: {
      type: ["number", "null"],
      minimum: 90,
      maximum: 110,
      description: "Temperature in Fahrenheit if mentioned, else null. Plausible human range only.",
    },
    feverMentioned: { type: "boolean" },
    summary: { type: "string", description: "One short clinical-style paraphrase of what the patient reported." },
    needCategory: {
      type: "string",
      enum: [...NEED_CATEGORIES],
      description:
        "The PRIMARY kind of need this message represents. CLINICAL if it describes a physical symptom (even a mild one, even alongside other needs). LOGISTICAL for appointments/transportation/scheduling problems. EMOTIONAL for fear/distress/overwhelm with no physical symptom described. FINANCIAL for cost/coverage/affordability problems. ROUTINE for a simple check-in with nothing notable. UNCERTAIN if you genuinely cannot tell — do not guess.",
    },
    hasAdditionalNeeds: {
      type: "boolean",
      description: "True if the message ALSO touches a second, different kind of need beyond the primary needCategory.",
    },
    crisisLanguageDetected: {
      type: "boolean",
      description:
        "True if the message expresses any indication of suicidal ideation, self-harm, or wanting to die/not wanting to be alive — in ANY language, including indirect or paraphrased expressions, not just explicit statements. This is a safety flag for immediate human routing, not a diagnosis. When genuinely uncertain, prefer true (a human reviewing a false alarm costs little; missing a real one does not).",
    },
  },
  required: [
    "pain",
    "nausea",
    "fatigue",
    "feverF",
    "feverMentioned",
    "summary",
    "needCategory",
    "hasAdditionalNeeds",
    "crisisLanguageDetected",
  ],
  additionalProperties: false,
} as const;

const PATIENT_SYSTEM_PROMPT = `You are a clinical intake assistant for CareSignal, an oncology symptom-monitoring
system. A cancer patient undergoing chemotherapy has sent a freeform text message describing how they feel today.

Extract PRO-CTCAE-style severity scores on a 0-10 scale (0 = none, 10 = worst imaginable) for pain, nausea, and
fatigue, inferring reasonable values from the patient's own words even if they didn't use numbers. If a symptom
isn't mentioned at all, assume it is unchanged/mild and score it low (0-2), not zero by default — use judgment.
If a temperature or fever is mentioned, extract it in Fahrenheit; if the patient explicitly says "no fever," set
feverF to 98.6 and feverMentioned to true. If fever is not discussed at all, set feverF to 98.6 and feverMentioned
to false. Never invent a high fever the patient didn't describe.

Also classify needCategory: the primary KIND of need this message represents (CLINICAL, LOGISTICAL, EMOTIONAL,
FINANCIAL, ROUTINE, or UNCERTAIN — see field description). This is a routing label, not a diagnosis or a clinical
decision — you are identifying what the message is about, not deciding what should happen. If the patient
describes ANY physical symptom, even mild, choose CLINICAL even if they also mention something else (set
hasAdditionalNeeds to true in that case). Prefer UNCERTAIN over guessing when the message is genuinely ambiguous.

Also set crisisLanguageDetected to true if the message expresses ANY indication of suicidal ideation, self-harm, or
not wanting to be alive/wanting to die — however it's phrased, directly or indirectly, in whatever language. This is
independent of needCategory (it can be true alongside any category) and independent of how confident you are about
the rest of the message — flag it even if everything else about the message is unclear.

The patient's message may be written in English, French, or Spanish (CareSignal serves a Louisiana population that
includes French and Spanish speakers). Extract the same fields regardless of the message's language, including
crisis-language detection — watch for it equally in all three languages. Always write the "summary" field in
English, since it's read by the English-speaking clinical care team.`;

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
    max_tokens: MAX_COMPLETION_TOKENS,
  });

  const raw = completion.choices[0]?.message?.content;
  // Can happen if the completion gets cut off by max_tokens before finishing
  // the JSON object, or the provider returns an empty choice — either way
  // there's nothing to parse, so fail loudly here rather than passing
  // `undefined` into JSON.parse and getting a confusing SyntaxError instead.
  if (!raw) throw new Error("Model returned no content for patient symptom parsing.");
  const parsed = JSON.parse(raw);

  return {
    pain: clampScore(parsed.pain),
    nausea: clampScore(parsed.nausea),
    fatigue: clampScore(parsed.fatigue),
    fever: clampFever(parsed.feverF),
    feverMentioned: parsed.feverMentioned,
    summary: parsed.summary,
    // Defense-in-depth, same spirit as clampScore/clampFever above: never
    // let an unrecognized value from the model reach the database — fall
    // back to UNCERTAIN rather than trust an unvalidated string.
    needCategory: isNeedCategory(parsed.needCategory) ? parsed.needCategory : "UNCERTAIN",
    hasAdditionalNeeds: Boolean(parsed.hasAdditionalNeeds),
    crisisLanguageDetected: Boolean(parsed.crisisLanguageDetected),
  };
}

export interface ParsedCaregiverMessage {
  intent: "PATIENT_SYMPTOMS" | "CAREGIVER_COPING" | "BOTH" | "UNCLEAR";
  patientSymptoms: ParsedPatientSymptoms | null;
  caregiverCoping: { patientStatus: number; copingScore: number } | null;
  summary: string;
  needCategory?: NeedCategory;
  hasAdditionalNeeds?: boolean;
  // Same field, same purpose as ParsedPatientSymptoms above — a caregiver's
  // own message can express crisis language about THEMSELVES (not just
  // relaying the patient's), and lib/safetyGate.ts's regex gate already
  // treats caregiver crisis language as attaching to the patient's safety
  // record (see recordSafetyAlert callers) — this is the same redundant
  // second layer for that path.
  crisisLanguageDetected?: boolean;
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
        feverF: { type: ["number", "null"], minimum: 90, maximum: 110 },
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
    needCategory: {
      type: "string",
      enum: [...NEED_CATEGORIES],
      description:
        "The PRIMARY kind of need this message represents, whether about the patient or the caregiver themselves. CLINICAL if a physical symptom is relayed. LOGISTICAL for appointments/transportation/scheduling. EMOTIONAL for fear/distress/overwhelm/burnout with no physical symptom. FINANCIAL for cost/affordability. ROUTINE for a simple check-in. UNCERTAIN if genuinely unclear — do not guess.",
    },
    hasAdditionalNeeds: {
      type: "boolean",
      description: "True if the message ALSO touches a second, different kind of need beyond the primary needCategory.",
    },
    crisisLanguageDetected: {
      type: "boolean",
      description:
        "True if the message expresses any indication of suicidal ideation, self-harm, or wanting to die/not wanting to be alive — about the PATIENT or the CAREGIVER themselves, in ANY language, including indirect or paraphrased expressions. Safety flag for immediate human routing, not a diagnosis. When genuinely uncertain, prefer true.",
    },
  },
  required: [
    "intent",
    "patientSymptoms",
    "caregiverCoping",
    "summary",
    "needCategory",
    "hasAdditionalNeeds",
    "crisisLanguageDetected",
  ],
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
patientSymptoms or caregiverCoping if that intent applies; otherwise set that field to null.

Also classify needCategory: the primary KIND of need this message represents (CLINICAL, LOGISTICAL, EMOTIONAL,
FINANCIAL, ROUTINE, or UNCERTAIN — see field description), whether it's about the patient or the caregiver. This
is a routing label, not a diagnosis or a clinical decision. If any physical symptom is relayed, choose CLINICAL
even if the message also touches something else (set hasAdditionalNeeds to true in that case). Prefer UNCERTAIN
over guessing.

Also set crisisLanguageDetected to true if the message expresses ANY indication of suicidal ideation, self-harm, or
not wanting to be alive/wanting to die — about the PATIENT or about the CAREGIVER themselves, however it's phrased,
directly or indirectly, in whatever language. This is independent of needCategory and independent of intent — flag
it regardless of which of PATIENT_SYMPTOMS/CAREGIVER_COPING/BOTH/UNCLEAR applies.

The caregiver's message may be written in English, French, or Spanish (CareSignal serves a Louisiana population that
includes French and Spanish speakers). Extract the same fields regardless of the message's language — watch for the
same burden/exhaustion signals and the same crisis-language signals whether expressed in English, French, or
Spanish. Always write the "summary" field in English, since it's read by the English-speaking clinical care team.`;

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
    max_tokens: MAX_COMPLETION_TOKENS,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Model returned no content for caregiver message parsing.");
  const parsed = JSON.parse(raw);

  return {
    intent: parsed.intent,
    patientSymptoms: parsed.patientSymptoms
      ? {
          pain: clampScore(parsed.patientSymptoms.pain),
          nausea: clampScore(parsed.patientSymptoms.nausea),
          fatigue: clampScore(parsed.patientSymptoms.fatigue),
          fever: clampFever(parsed.patientSymptoms.feverF),
          feverMentioned: parsed.patientSymptoms.feverMentioned,
          summary: parsed.summary,
        }
      : null,
    caregiverCoping: parsed.caregiverCoping
      ? {
          patientStatus: clampCoping(parsed.caregiverCoping.patientStatus),
          copingScore: clampCoping(parsed.caregiverCoping.copingScore),
        }
      : null,
    summary: parsed.summary,
    needCategory: isNeedCategory(parsed.needCategory) ? parsed.needCategory : "UNCERTAIN",
    hasAdditionalNeeds: Boolean(parsed.hasAdditionalNeeds),
    crisisLanguageDetected: Boolean(parsed.crisisLanguageDetected),
  };
}

// --- SOAP note generation ---
// Synthesizes a patient's recent check-in history and active alert reasons
// into a structured SOAP note (Subjective / Objective / Assessment / Plan) —
// a standard clinical documentation format — for a nurse to review and
// copy/adapt into the EHR. This is a documentation aid, not an autonomous
// clinical decision: the Plan section is phrased as suggestions for the
// care team to consider, not orders.

export interface SoapNoteContext {
  patientName: string;
  cancerType: string;
  chemoCycle: string;
  riskStatus: "GREEN" | "YELLOW" | "RED";
  riskScore: number;
  hospitalizationRiskScore: number;
  activeAlertReasons: string[];
  recentLogs: { daysAgo: number; pain: number; nausea: number; fatigue: number; fever: number; source: string }[];
  caregiverBurdenNote: string | null;
}

export interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  fullText: string;
}

const SOAP_NOTE_SCHEMA = {
  type: "object",
  properties: {
    subjective: { type: "string", description: "What the patient/caregiver reported, in their own words/paraphrase — symptoms, timeline, concerns." },
    objective: { type: "string", description: "Measurable data: the logged pain/nausea/fatigue/fever values and trend over the recent check-ins, and the current risk model outputs." },
    assessment: { type: "string", description: "Clinical interpretation: what the data pattern suggests, referencing PRO-CTCAE grading and the neutropenic fever threshold (100.4°F) where relevant." },
    plan: { type: "string", description: "Suggested next steps for the care team to consider (e.g., callback, labs, symptom management guidance) — phrased as suggestions, not orders, since a nurse reviews this before acting." },
  },
  required: ["subjective", "objective", "assessment", "plan"],
  additionalProperties: false,
} as const;

const SOAP_NOTE_SYSTEM_PROMPT = `You are a clinical documentation assistant for CareSignal, an oncology remote symptom-monitoring
system. Given a patient's recent SMS check-in history and any active risk-alert reasons, write a SOAP note
(Subjective, Objective, Assessment, Plan) summarizing the situation for the oncology nurse reviewing it.

Conventions: use PRO-CTCAE-style grading language (e.g., "Grade 2 nausea") where symptom scores support it, cite
the 100.4°F neutropenic fever threshold explicitly if fever is relevant, and keep each section concise (2-4
sentences) — this is a quick clinical summary, not a full chart note. The Plan section must be phrased as
suggestions for the nurse to weigh ("consider," "recommend"), never as directives, since a licensed clinician
reviews and decides before anything happens. If the data is unremarkable, say so plainly rather than inventing
concern that isn't supported by the numbers.`;

export async function generateSoapNote(context: SoapNoteContext): Promise<SoapNote> {
  const openai = getClient();

  const logLines = context.recentLogs
    .map((l) => `  ${l.daysAgo === 0 ? "today" : `${l.daysAgo}d ago`} (${l.source}): pain ${l.pain}/10, nausea ${l.nausea}/10, fatigue ${l.fatigue}/10, fever ${l.fever.toFixed(1)}°F`)
    .join("\n");

  const userContent = `Patient: ${context.patientName}
Diagnosis: ${context.cancerType}, ${context.chemoCycle}
Current daily risk status: ${context.riskStatus} (model probability ${context.riskScore.toFixed(2)})
7-day hospitalization-risk forecast: ${(context.hospitalizationRiskScore * 100).toFixed(0)}%

Recent check-ins (most recent last):
${logLines || "  (no check-ins on file)"}

Active clinical alert reasons:
${context.activeAlertReasons.length ? context.activeAlertReasons.map((r) => `  - ${r}`).join("\n") : "  (none open)"}

${context.caregiverBurdenNote ? `Caregiver note: ${context.caregiverBurdenNote}` : ""}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SOAP_NOTE_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "soap_note", strict: true, schema: SOAP_NOTE_SCHEMA },
    },
    temperature: 0.2,
    max_tokens: MAX_COMPLETION_TOKENS,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Model returned no content for SOAP note generation.");
  const parsed = JSON.parse(raw);

  const fullText = `S: ${parsed.subjective}\n\nO: ${parsed.objective}\n\nA: ${parsed.assessment}\n\nP: ${parsed.plan}`;

  return {
    subjective: parsed.subjective,
    objective: parsed.objective,
    assessment: parsed.assessment,
    plan: parsed.plan,
    fullText,
  };
}
