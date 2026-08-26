import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendOutboundCommunication, type Participant } from "@/lib/communications";

const MAX_BODY_LENGTH = 1600; // ~10 SMS segments — generous, still a real bound

// Clinician-initiated outbound reply. Security-critical: the recipient
// phone number is ALWAYS resolved server-side from the patientId's own
// database record — the client can select WHO (patient vs. caregiver) but
// never WHAT NUMBER. There is no code path here that accepts or trusts a
// raw phone number from the request body.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const patientId = body?.patientId;
  const participant = body?.participant;
  const text = body?.body;
  const relatedAlertId = body?.relatedAlertId ?? null;
  const sentByName = typeof body?.sentByName === "string" ? body.sentByName.trim().slice(0, 100) : null;

  if (typeof patientId !== "string") {
    return NextResponse.json({ error: "Provide { patientId: string }." }, { status: 400 });
  }
  if (participant !== "PATIENT" && participant !== "CAREGIVER") {
    return NextResponse.json({ error: 'participant must be "PATIENT" or "CAREGIVER".' }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Message body cannot be empty." }, { status: 400 });
  }
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: `Message is too long (max ${MAX_BODY_LENGTH} characters).` }, { status: 400 });
  }
  if (relatedAlertId !== null && typeof relatedAlertId !== "string") {
    return NextResponse.json({ error: "relatedAlertId must be a string if provided." }, { status: 400 });
  }

  const patient = await prisma.patient.findUnique({ where: { id: patientId }, include: { caregiver: true } });
  if (!patient) {
    return NextResponse.json({ error: "No patient found for that id." }, { status: 404 });
  }

  // Recipient resolution — the ONLY source of truth for the destination
  // phone number, always read from the record just fetched above.
  const recipientPhone = participant === "CAREGIVER" ? patient.caregiver?.phone : patient.phone;
  if (!recipientPhone) {
    return NextResponse.json({ error: "This patient has no caregiver on file to reply to." }, { status: 400 });
  }

  // A relatedAlertId must belong to THIS patient — otherwise a forged id
  // from another patient's alert could be used to advance an unrelated
  // workflow item's status via this endpoint.
  let alert: { id: string; status: string } | null = null;
  if (relatedAlertId) {
    const found = await prisma.riskAlert.findUnique({ where: { id: relatedAlertId } });
    if (!found || found.patientId !== patientId) {
      return NextResponse.json({ error: "relatedAlertId does not belong to this patient." }, { status: 400 });
    }
    alert = found;
  }

  const outcome = await sendOutboundCommunication({
    patientId,
    participant: participant as Participant,
    to: recipientPhone,
    body: text,
    sentByName,
    relatedAlertId,
  });

  // Sending a message is an ACTION, not a RESOLUTION — advance the status
  // one step (never past ACTIONED, never regress from RESOLVED) ONLY on a
  // confirmed successful send. A failed send took no real action.
  if (outcome.ok && alert && (alert.status === "OPEN" || alert.status === "REVIEWED")) {
    await prisma.riskAlert.update({ where: { id: alert.id }, data: { status: "ACTIONED" } });
  }

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error ?? "Failed to send message.", message: outcome.message }, { status: 502 });
  }

  return NextResponse.json({ message: outcome.message });
}
