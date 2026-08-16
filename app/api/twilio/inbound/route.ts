import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { parseCaregiverMessageText, parsePatientSymptomText } from "@/lib/ai";
import {
  findSenderByPhone,
  parseStructuredCaregiverCheckin,
  parseStructuredSymptoms,
  recordCaregiverLog,
  recordSymptomLog,
  type Sender,
} from "@/lib/inbound";
import type { RiskAssessment } from "@/lib/risk";

function twiml(message: string): NextResponse {
  const response = new twilio.twiml.MessagingResponse();
  response.message(message);
  return new NextResponse(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

const GENERIC_FALLBACK_MESSAGE =
  "Sorry, something went wrong logging that on our end — it wasn't saved. Please try texting again in a few minutes, or call your clinic if this is urgent.";

function riskAckMessage(assessment: RiskAssessment): string {
  if (assessment.level === "RED") {
    return "Thanks for the update. Based on what you shared, a nurse from your care team will call you shortly. If you're feeling very unwell, please don't wait — call your clinic or 911.";
  }
  if (assessment.level === "YELLOW") {
    return "Thanks for the update — logged. Your care team is keeping an eye on your recent symptoms.";
  }
  return "Thanks for checking in — logged. Feel better!";
}

// Handles one already-identified sender's message. Split out from POST() so
// the top-level handler can wrap it in one broad safety-net try/catch (see
// below) without that catch swallowing the more specific, better-worded
// error handling already inside here for the freeform-AI-parsing calls.
async function handleMessage(sender: Sender, body: string): Promise<NextResponse> {
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
      return twiml(riskAckMessage(assessment));
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
      });
      return twiml(riskAckMessage(assessment));
    } catch (err) {
      // Covers both a Groq error/timeout (network issue, rate limit, the
      // REQUEST_TIMEOUT_MS budget in lib/ai.ts running out) and a malformed
      // model response — either way the patient gets a specific, actionable
      // reply instead of silence, and can immediately retry with the
      // structured format as a workaround.
      console.error("[twilio/inbound] patient freeform parse failed:", err);
      return twiml(
        "Sorry, we couldn't understand that message. Please reply with your pain, nausea, and fatigue (0-10) and your temperature, e.g. \"4,2,6,98.6\"."
      );
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
    return twiml(`Thanks, logged on ${sender.patient.firstName}'s behalf. ${riskAckMessage(assessment)}`);
  }

  const structuredCoping = parseStructuredCaregiverCheckin(body);
  if (structuredCoping) {
    const { burdenFlagged } = await recordCaregiverLog({
      caregiverId: sender.caregiver.id,
      patientId: sender.patient.id,
      ...structuredCoping,
      rawSmsText: body,
    });
    return twiml(
      burdenFlagged
        ? "Thank you for sharing — caregiving is hard. We've flagged this for your care team so they can check in on you too."
        : "Thanks for checking in on how you're doing — logged."
    );
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
      return twiml(
        "Thanks for the message — we couldn't quite tell if that was about how the patient is doing or how you're doing. Could you say a bit more?"
      );
    }

    const parts: string[] = [];
    if (assessment) parts.push(riskAckMessage(assessment));
    if (burdenFlagged) parts.push("We've also flagged this for your care team to check in on you.");
    if (parts.length === 0) parts.push("Thanks for checking in — logged.");
    return twiml(parts.join(" "));
  } catch (err) {
    console.error("[twilio/inbound] caregiver freeform parse failed:", err);
    return twiml("Sorry, we couldn't understand that message. Please try again.");
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

  // An empty Body (e.g. a photo-only MMS, or a blank text) DOES have a real
  // sender we can reply to — so unlike the missing-From case, this gets a
  // friendly SMS reply rather than a raw JSON error, since the sender is a
  // patient or caregiver who will actually see it.
  if (!body) {
    return twiml("We didn't get any text in that message — could you resend with how you're feeling, e.g. \"4,2,6,98.6\" or just describe it in your own words?");
  }

  // Twilio request signature validation — skipped when TWILIO_AUTH_TOKEN isn't
  // configured (local/demo mode without a live Twilio account), but enforced
  // whenever it is, since this endpoint writes clinical data.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signature = req.headers.get("x-twilio-signature") ?? "";
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = String(value);
    });
    const valid = twilio.validateRequest(authToken, signature, req.url, params);
    if (!valid) {
      return NextResponse.json({ error: "Invalid Twilio signature." }, { status: 403 });
    }
  } else {
    console.warn("[twilio/inbound] TWILIO_AUTH_TOKEN not set — skipping signature validation (demo mode).");
  }

  // A phone number that matches neither a Patient nor a Caregiver record —
  // handled explicitly rather than falling through, since there's no patient
  // context to attach a symptom/coping log to.
  const sender = await findSenderByPhone(from);
  if (!sender) {
    return twiml(
      "This number isn't recognized by CareSignal. If you're a patient or caregiver, please contact your care team to get set up."
    );
  }

  // Safety net for anything not already caught inside handleMessage() — a
  // database error, an unexpected shape in a "structured" branch, etc.
  // Twilio (and the person on the other end of the text) always gets a
  // real reply instead of a raw 500, and the actual error is still logged
  // with the sender's phone number for debugging.
  try {
    return await handleMessage(sender, body);
  } catch (err) {
    console.error(`[twilio/inbound] unhandled error processing message from ${from}:`, err);
    return twiml(GENERIC_FALLBACK_MESSAGE);
  }
}
