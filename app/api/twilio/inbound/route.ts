import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { parseCaregiverMessageText, parsePatientSymptomText } from "@/lib/ai";
import {
  findSenderByPhone,
  parseStructuredCaregiverCheckin,
  parseStructuredSymptoms,
  recordCaregiverLog,
  recordSafetyAlert,
  recordSymptomLog,
  type Sender,
} from "@/lib/inbound";
import type { RiskAssessment } from "@/lib/risk";
import { normalizeLang, t, type Lang } from "@/lib/i18n";
import { checkSafetyGate } from "@/lib/safetyGate";
import type { TreatmentFrequency } from "@/lib/transportationResources";

// Twilio computes its request signature against the exact public URL it
// POSTed to (the webhook URL configured in the Twilio console) — https,
// public host, path, and query string. `req.url` reflects the request as
// Next.js's own server sees it, which behind a reverse proxy (ngrok
// locally, Railway's own proxy in production) is NOT the same string: it
// keeps the app's own bind host (e.g. "localhost:3000") even when it does
// pick up "https" from X-Forwarded-Proto. Signing against a different URL
// than Twilio used makes validateRequest() fail deterministically for
// every legitimate request, not just an edge case — this reconstructs the
// actual public URL from the standard forwarding headers every proxy in
// front of this app sets. This doesn't weaken validation: an attacker
// still can't produce a valid X-Twilio-Signature for a URL of their
// choosing without the real auth token, so trusting these headers here
// only fixes what URL is being validated against, not whether the
// signature itself is checked.
function publicRequestUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

function twiml(message: string): NextResponse {
  const response = new twilio.twiml.MessagingResponse();
  response.message(message);
  return new NextResponse(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

// Never a real number hardcoded in source — resolved from CLINIC_TRIAGE_PHONE
// (see .env.example) at send time. Left unset, this placeholder is
// deliberately obvious rather than a plausible-looking fake number someone
// could mistake for a real triage line and actually call.
const UNCONFIGURED_CLINIC_PHONE_PLACEHOLDER = "[clinic phone not configured]";

function clinicTriagePhone(): string {
  const configured = process.env.CLINIC_TRIAGE_PHONE?.trim();
  return configured || UNCONFIGURED_CLINIC_PHONE_PLACEHOLDER;
}

function riskAckMessage(assessment: RiskAssessment, lang: Lang): string {
  if (assessment.level === "RED") return t("ackRed", lang, { clinicPhone: clinicTriagePhone() });
  if (assessment.level === "YELLOW") return t("ackYellow", lang);
  return t("ackGreen", lang);
}

function senderLang(sender: Sender): Lang {
  return sender.type === "PATIENT" ? normalizeLang(sender.patient.preferredLanguage) : normalizeLang(sender.caregiver.preferredLanguage);
}

// Handles one already-identified sender's message, in their preferred
// language. Split out from POST() so the top-level handler can wrap it in
// one broad safety-net try/catch (see below) without that catch swallowing
// the more specific, better-worded error handling already inside here for
// the freeform-AI-parsing calls.
async function handleMessage(sender: Sender, body: string, lang: Lang): Promise<NextResponse> {
  // Deterministic crisis-language check — runs on the raw text before any
  // LLM interpretation or structured/freeform branching, for both sender
  // types. This must fire regardless of what the AI parser would have done
  // with the same text (see lib/safetyGate.ts). Always attaches to the
  // PATIENT's own record, even when a caregiver sent the message.
  const safety = checkSafetyGate(body);
  if (safety.triggered) {
    await recordSafetyAlert({ patientId: sender.patient.id, rawSmsText: body, reason: safety.reason! });
    return twiml(t("safetyGate", lang, { clinicPhone: clinicTriagePhone() }));
  }

  if (sender.type === "PATIENT") {
    const structured = parseStructuredSymptoms(body);
    if (structured) {
      const assessment = await recordSymptomLog({
        patientId: sender.patient.id,
        ...structured,
        source: "PATIENT_SMS",
        rawSmsText: body,
        parsedByAi: false,
      });
      return twiml(riskAckMessage(assessment, lang));
    }

    try {
      const parsed = await parsePatientSymptomText(body);
      const assessment = await recordSymptomLog({
        patientId: sender.patient.id,
        pain: parsed.pain,
        nausea: parsed.nausea,
        fatigue: parsed.fatigue,
        fever: parsed.fever,
        source: "PATIENT_SMS",
        rawSmsText: body,
        parsedByAi: true,
        needCategory: parsed.needCategory,
        treatmentFrequency: sender.patient.treatmentFrequency as TreatmentFrequency,
      });
      return twiml(riskAckMessage(assessment, lang));
    } catch (err) {
      // Covers both a Groq error/timeout (network issue, rate limit, the
      // REQUEST_TIMEOUT_MS budget in lib/ai.ts running out) and a malformed
      // model response — either way the patient gets a specific, actionable
      // reply instead of silence, and can immediately retry with the
      // structured format as a workaround.
      console.error("[twilio/inbound] patient freeform parse failed:", err);
      return twiml(t("patientParseFailed", lang));
    }
  }

  // Caregiver sender — could be relaying the patient's symptoms, reporting
  // their own coping state, or both.
  const structuredSymptoms = parseStructuredSymptoms(body);
  if (structuredSymptoms) {
    const assessment = await recordSymptomLog({
      patientId: sender.patient.id,
      ...structuredSymptoms,
      source: "CAREGIVER_SMS",
      rawSmsText: body,
      parsedByAi: false,
    });
    return twiml(t("caregiverRelayPrefix", lang, { name: sender.patient.firstName }) + riskAckMessage(assessment, lang));
  }

  const structuredCoping = parseStructuredCaregiverCheckin(body);
  if (structuredCoping) {
    const { burdenFlagged } = await recordCaregiverLog({
      caregiverId: sender.caregiver.id,
      patientId: sender.patient.id,
      ...structuredCoping,
      rawSmsText: body,
    });
    return twiml(t(burdenFlagged ? "caregiverBurdenFlaggedStructured" : "caregiverCopingLoggedStructured", lang));
  }

  try {
    const parsed = await parseCaregiverMessageText(body);
    let burdenFlagged = false;
    let assessment: RiskAssessment | null = null;

    if (parsed.patientSymptoms) {
      assessment = await recordSymptomLog({
        patientId: sender.patient.id,
        pain: parsed.patientSymptoms.pain,
        nausea: parsed.patientSymptoms.nausea,
        fatigue: parsed.patientSymptoms.fatigue,
        fever: parsed.patientSymptoms.fever,
        source: "CAREGIVER_SMS",
        rawSmsText: body,
        parsedByAi: true,
        needCategory: parsed.needCategory,
        treatmentFrequency: sender.patient.treatmentFrequency as TreatmentFrequency,
      });
    }

    if (parsed.caregiverCoping) {
      const result = await recordCaregiverLog({
        caregiverId: sender.caregiver.id,
        patientId: sender.patient.id,
        patientStatus: parsed.caregiverCoping.patientStatus,
        copingScore: parsed.caregiverCoping.copingScore,
        rawSmsText: body,
      });
      burdenFlagged = result.burdenFlagged;
    }

    // Not an error — this is the model genuinely unable to tell what the
    // message was about (rare; see docs/pitch-notes.md for the observed
    // ~1-in-5 non-determinism case). Ask rather than guess wrong and log
    // fabricated data against either the patient or the caregiver.
    if (!parsed.patientSymptoms && !parsed.caregiverCoping) {
      return twiml(t("clarifyingQuestion", lang));
    }

    const parts: string[] = [];
    if (assessment) parts.push(riskAckMessage(assessment, lang));
    if (burdenFlagged) parts.push(t("caregiverBurdenNote", lang));
    if (parts.length === 0) parts.push(t("genericLogged", lang));
    return twiml(parts.join(" "));
  } catch (err) {
    console.error("[twilio/inbound] caregiver freeform parse failed:", err);
    return twiml(t("caregiverParseFailed", lang));
  }
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected Twilio form-encoded webhook payload." }, { status: 400 });
  }

  // A malformed body (truncated request, bad multipart boundary, a
  // non-Twilio caller sending garbage to this URL) throws inside
  // req.formData() itself, before we know anything about the sender — there
  // is no phone number to reply to yet, so the only graceful option is a
  // controlled 400 instead of an unhandled 500 crash trace.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    console.error("[twilio/inbound] failed to parse form-encoded body:", err);
    return NextResponse.json({ error: "Could not parse the request body." }, { status: 400 });
  }

  const from = String(formData.get("From") ?? "").trim();
  const body = String(formData.get("Body") ?? "").trim();

  // No From at all means we can't identify anyone or reply — this shouldn't
  // happen from real Twilio traffic, so a plain 400 (not a TwiML reply) is
  // fine here.
  if (!from) {
    return NextResponse.json({ error: "Missing From." }, { status: 400 });
  }

  // Twilio request signature validation — skipped when TWILIO_AUTH_TOKEN isn't
  // configured (local/demo mode without a live Twilio account), but enforced
  // whenever it is, since this endpoint writes clinical data. Runs before
  // anything else touches the request's content, including the sender
  // lookup below.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = String(value);
    });
    const valid = twilio.validateRequest(authToken, signature, publicRequestUrl(req), params);
    if (!valid) {
      return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 403 });
    }
  } else {
    console.warn("[twilio/inbound] TWILIO_AUTH_TOKEN not set — skipping signature validation (demo mode).");
  }

  // A phone number that matches neither a Patient nor a Caregiver record —
  // handled explicitly rather than falling through, since there's no patient
  // context (or language preference) to reply with. Looked up before the
  // empty-body check below so THAT reply can be localized once we know who
  // sent it.
  const sender = await findSenderByPhone(from);
  if (!sender) {
    return twiml(t("unrecognizedNumber", "en"));
  }
  const lang = senderLang(sender);

  // An empty Body (e.g. a photo-only MMS, or a blank text) DOES have a real,
  // known sender we can reply to in their own language — unlike the
  // missing-From case, this gets a friendly SMS reply rather than a raw
  // JSON error.
  if (!body) {
    return twiml(t("emptyBody", lang));
  }

  // Safety net for anything not already caught inside handleMessage() — a
  // database error, an unexpected shape in a "structured" branch, etc.
  // Twilio (and the person on the other end of the text) always gets a
  // real reply instead of a raw 500, and the actual error is still logged
  // with the sender's phone number for debugging.
  try {
    return await handleMessage(sender, body, lang);
  } catch (err) {
    console.error(`[twilio/inbound] unhandled error processing message from ${from}:`, err);
    return twiml(t("genericFallback", lang));
  }
}
