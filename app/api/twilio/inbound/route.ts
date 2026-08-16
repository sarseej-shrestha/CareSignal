import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { parseCaregiverMessageText, parsePatientSymptomText } from "@/lib/ai";
import {
  findSenderByPhone,
  parseStructuredCaregiverCheckin,
  parseStructuredSymptoms,
  recordCaregiverLog,
  recordSymptomLog,
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

function riskAckMessage(assessment: RiskAssessment): string {
  if (assessment.level === "RED") {
    return "Thanks for the update. Based on what you shared, a nurse from your care team will call you shortly. If you're feeling very unwell, please don't wait — call your clinic or 911.";
  }
  if (assessment.level === "YELLOW") {
    return "Thanks for the update — logged. Your care team is keeping an eye on your recent symptoms.";
  }
  return "Thanks for checking in — logged. Feel better!";
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected Twilio form-encoded webhook payload." }, { status: 400 });
  }

  const formData = await req.formData();
  const from = String(formData.get("From") ?? "").trim();
  const body = String(formData.get("Body") ?? "").trim();

  if (!from || !body) {
    return NextResponse.json({ error: "Missing From or Body." }, { status: 400 });
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

  const sender = await findSenderByPhone(from);
  if (!sender) {
    return twiml("This number isn't recognized by CareSignal. If you're a patient or caregiver, please contact your care team to get set up.");
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
      console.error("[twilio/inbound] patient freeform parse failed:", err);
      return twiml("Sorry, we couldn't understand that message. Please reply with your pain, nausea, and fatigue (0-10) and your temperature, e.g. \"4,2,6,98.6\".");
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

    if (!parsed.patientSymptoms && !parsed.caregiverCoping) {
      return twiml("Thanks for the message — we couldn't quite tell if that was about how the patient is doing or how you're doing. Could you say a bit more?");
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
