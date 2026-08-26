// Generic communication log — persistence only. Two call sites:
// 1. lib/inbound.ts's recordSymptomLog/recordSafetyAlert/recordCaregiverLog
//    call recordInboundCommunication() as an ADDITIONAL step alongside what
//    they already do. This is not a new pipeline — the safety/risk/routing
//    logic in those functions is untouched; this only mirrors the same
//    inbound text into the conversation view.
// 2. app/api/communications/send/route.ts and the review-acknowledgment
//    side effect in app/api/alerts/[id]/status/route.ts call
//    sendOutboundCommunication() for anything CareSignal sends back.
//
// DEMO_MODE is checked HERE, not by callers — see sendOutboundCommunication.
// This mirrors the same "skip the external dependency, do everything else
// for real" precedent already established by the inbound webhook (skips
// Twilio signature validation when TWILIO_AUTH_TOKEN is unset) and by
// lib/demoScenarios.ts (skips Groq by using pre-computed values). A
// clinician clicking "Send" or "Mark reviewed" against a seeded demo
// patient's non-Twilio-verified fake number must not fail — but the
// database writes, status transitions, and everything else stay real.

import { prisma } from "./db";
import { sendSms } from "./twilioClient";

export type Participant = "PATIENT" | "CAREGIVER";

function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

// Never throws — a missing conversation-log row must not take down actual
// clinical recording, which has already succeeded by the time this runs
// (see call sites in lib/inbound.ts, all called after the real write).
export async function recordInboundCommunication(params: {
  patientId: string;
  participant: Participant;
  body: string | null | undefined;
  relatedAlertId?: string | null;
}): Promise<void> {
  if (!params.body) return;
  try {
    await prisma.communicationMessage.create({
      data: {
        patientId: params.patientId,
        participant: params.participant,
        direction: "INBOUND",
        body: params.body,
        status: "RECEIVED",
        relatedAlertId: params.relatedAlertId ?? null,
      },
    });
  } catch (err) {
    console.error("[communications] failed to record inbound message (non-fatal):", err);
  }
}

export interface SendOutcome {
  message: Awaited<ReturnType<typeof prisma.communicationMessage.create>>;
  ok: boolean;
  error?: string;
}

// The only place an OUTBOUND CommunicationMessage is ever created. Never
// records status "SENT" unless Twilio actually accepted the message (or,
// in DEMO_MODE, unless the simulated path ran) — a caught Twilio failure is
// recorded as "FAILED", never silently dropped and never reported as sent.
export async function sendOutboundCommunication(params: {
  patientId: string;
  participant: Participant;
  to: string;
  body: string;
  sentByName?: string | null;
  relatedAlertId?: string | null;
}): Promise<SendOutcome> {
  if (isDemoModeEnabled()) {
    // No Twilio call at all — see file header. twilioSid stays null on
    // purpose: it's honest that no real Twilio message exists, not a fake
    // SID that would look real in an audit trail.
    const message = await prisma.communicationMessage.create({
      data: {
        patientId: params.patientId,
        participant: params.participant,
        direction: "OUTBOUND",
        body: params.body,
        status: "SENT",
        sentByName: params.sentByName || null,
        relatedAlertId: params.relatedAlertId ?? null,
      },
    });
    return { message, ok: true };
  }

  try {
    const { sid } = await sendSms(params.to, params.body);
    const message = await prisma.communicationMessage.create({
      data: {
        patientId: params.patientId,
        participant: params.participant,
        direction: "OUTBOUND",
        body: params.body,
        status: "SENT",
        sentByName: params.sentByName || null,
        relatedAlertId: params.relatedAlertId ?? null,
        twilioSid: sid,
      },
    });
    return { message, ok: true };
  } catch (err) {
    console.error("[communications] outbound send failed:", err);
    const message = await prisma.communicationMessage.create({
      data: {
        patientId: params.patientId,
        participant: params.participant,
        direction: "OUTBOUND",
        body: params.body,
        status: "FAILED",
        sentByName: params.sentByName || null,
        relatedAlertId: params.relatedAlertId ?? null,
      },
    });
    return { message, ok: false, error: err instanceof Error ? err.message : "Failed to send message." };
  }
}
