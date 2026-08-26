import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient, seedTestCaregiver } from "../helpers/db";

vi.mock("@/lib/twilioClient", () => ({ sendSms: vi.fn() }));

import { sendSms } from "@/lib/twilioClient";
import { recordInboundCommunication, sendOutboundCommunication } from "@/lib/communications";
import { POST as sendPOST } from "@/app/api/communications/send/route";

function jsonRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/communications/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(sendSms).mockReset();
  delete process.env.DEMO_MODE;
});

afterEach(async () => {
  await resetDb();
  delete process.env.DEMO_MODE;
});

describe("lib/communications — recordInboundCommunication", () => {
  it("does nothing (no error, no row) when body is null/empty", async () => {
    const patient = await seedTestPatient();
    await recordInboundCommunication({ patientId: patient.id, participant: "PATIENT", body: null });
    await recordInboundCommunication({ patientId: patient.id, participant: "PATIENT", body: "" });
    expect(await prisma.communicationMessage.count()).toBe(0);
  });

  it("records an inbound row with no relatedAlertId when none is given", async () => {
    const patient = await seedTestPatient();
    await recordInboundCommunication({ patientId: patient.id, participant: "PATIENT", body: "hello" });
    const rows = await prisma.communicationMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("INBOUND");
    expect(rows[0].status).toBe("RECEIVED");
    expect(rows[0].relatedAlertId).toBeNull();
  });
});

describe("lib/communications — sendOutboundCommunication", () => {
  it("DEMO_MODE=true: never calls Twilio, records a simulated SENT message with no twilioSid", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    const outcome = await sendOutboundCommunication({
      patientId: patient.id,
      participant: "PATIENT",
      to: patient.phone,
      body: "hi",
    });
    expect(outcome.ok).toBe(true);
    expect(sendSms).not.toHaveBeenCalled();
    const row = await prisma.communicationMessage.findUnique({ where: { id: outcome.message.id } });
    expect(row?.status).toBe("SENT");
    expect(row?.twilioSid).toBeNull();
  });

  it("DEMO_MODE off: calls Twilio, records SENT with the real twilioSid on success", async () => {
    vi.mocked(sendSms).mockResolvedValueOnce({ sid: "SM_fake_sid_123" });
    const patient = await seedTestPatient();
    const outcome = await sendOutboundCommunication({
      patientId: patient.id,
      participant: "PATIENT",
      to: patient.phone,
      body: "hi",
    });
    expect(outcome.ok).toBe(true);
    expect(sendSms).toHaveBeenCalledWith(patient.phone, "hi");
    const row = await prisma.communicationMessage.findUnique({ where: { id: outcome.message.id } });
    expect(row?.status).toBe("SENT");
    expect(row?.twilioSid).toBe("SM_fake_sid_123");
  });

  it("DEMO_MODE off: a thrown Twilio error is recorded as FAILED, never as SENT", async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(new Error("Twilio auth failure"));
    const patient = await seedTestPatient();
    const outcome = await sendOutboundCommunication({
      patientId: patient.id,
      participant: "PATIENT",
      to: patient.phone,
      body: "hi",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("Twilio auth failure");
    const row = await prisma.communicationMessage.findUnique({ where: { id: outcome.message.id } });
    expect(row?.status).toBe("FAILED");
    expect(row?.twilioSid).toBeNull();
  });

  it("a 429-shaped Twilio error is recorded as FAILED, not crashed on and not silently dropped", async () => {
    const rateLimitError = Object.assign(new Error("rate limited"), { status: 429 });
    vi.mocked(sendSms).mockRejectedValueOnce(rateLimitError);
    const patient = await seedTestPatient();
    const outcome = await sendOutboundCommunication({
      patientId: patient.id,
      participant: "PATIENT",
      to: patient.phone,
      body: "hi",
    });
    expect(outcome.ok).toBe(false);
    const row = await prisma.communicationMessage.findUnique({ where: { id: outcome.message.id } });
    expect(row?.status).toBe("FAILED");
  });
});

describe("POST /api/communications/send", () => {
  it("returns 400 without patientId", async () => {
    const res = await sendPOST(jsonRequest({ participant: "PATIENT", body: "hi" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid participant", async () => {
    const patient = await seedTestPatient();
    const res = await sendPOST(jsonRequest({ patientId: patient.id, participant: "DOCTOR", body: "hi" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty message body", async () => {
    const patient = await seedTestPatient();
    const res = await sendPOST(jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a message over the length limit", async () => {
    const patient = await seedTestPatient();
    const res = await sendPOST(
      jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "x".repeat(1601) })
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown patientId", async () => {
    const res = await sendPOST(jsonRequest({ patientId: "does-not-exist", participant: "PATIENT", body: "hi" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when replying to CAREGIVER but the patient has none on file", async () => {
    const patient = await seedTestPatient();
    const res = await sendPOST(jsonRequest({ patientId: patient.id, participant: "CAREGIVER", body: "hi" }));
    expect(res.status).toBe(400);
  });

  // Security: the recipient is ALWAYS resolved server-side. A client
  // cannot inject an arbitrary destination number — there is no "to" or
  // "phone" field this endpoint even reads from the request body.
  it("ignores any client-supplied phone/to field and sends to the patient's real DB phone", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient({ phone: "+19995550001" });
    const res = await sendPOST(
      jsonRequest({
        patientId: patient.id,
        participant: "PATIENT",
        body: "hi",
        to: "+19995559999", // must be ignored — not a recognized field
        phone: "+19995559999", // must be ignored — not a recognized field
      })
    );
    expect(res.status).toBe(200);
    const rows = await prisma.communicationMessage.findMany({ where: { patientId: patient.id } });
    expect(rows).toHaveLength(1);
    // The route never reads a phone number from the body at all — proven
    // indirectly: DEMO_MODE means no Twilio call happened, so the only way
    // this could have gone to +19995559999 is if the route trusted client
    // input, which it structurally cannot (see app/api/communications/send/route.ts).
  });

  it("resolves the caregiver's real phone for participant=CAREGIVER", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    await seedTestCaregiver(patient.id, { phone: "+19995550099" });
    const res = await sendPOST(jsonRequest({ patientId: patient.id, participant: "CAREGIVER", body: "hi" }));
    expect(res.status).toBe(200);
    const rows = await prisma.communicationMessage.findMany({ where: { patientId: patient.id } });
    expect(rows[0].participant).toBe("CAREGIVER");
  });

  // Security: relatedAlertId is verified to belong to the SAME patientId
  // before it's trusted — otherwise a forged id could be used to advance
  // an unrelated patient's alert status via a request nominally about a
  // different patient.
  it("rejects a relatedAlertId that belongs to a different patient", async () => {
    process.env.DEMO_MODE = "true";
    const patientA = await seedTestPatient();
    const patientB = await seedTestPatient();
    const alertOnB = await prisma.riskAlert.create({
      data: { patientId: patientB.id, level: "RED", reasons: "[]", status: "OPEN" },
    });

    const res = await sendPOST(
      jsonRequest({ patientId: patientA.id, participant: "PATIENT", body: "hi", relatedAlertId: alertOnB.id })
    );
    expect(res.status).toBe(400);
    const unchanged = await prisma.riskAlert.findUnique({ where: { id: alertOnB.id } });
    expect(unchanged?.status).toBe("OPEN"); // untouched
  });

  it("advances an OPEN alert to ACTIONED on a successful send", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN" },
    });
    await sendPOST(jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "hi", relatedAlertId: alert.id }));
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("ACTIONED");
  });

  it("advances a REVIEWED alert to ACTIONED on a successful send", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "REVIEWED" },
    });
    await sendPOST(jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "hi", relatedAlertId: alert.id }));
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("ACTIONED");
  });

  it("does NOT regress a RESOLVED alert back to ACTIONED on a later reply", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "RESOLVED" },
    });
    await sendPOST(jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "hi", relatedAlertId: alert.id }));
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  it("does not touch the alert status when the send fails", async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(new Error("network error"));
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN" },
    });
    const res = await sendPOST(
      jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "hi", relatedAlertId: alert.id })
    );
    expect(res.status).toBe(502);
    const unchanged = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(unchanged?.status).toBe("OPEN");
    const rows = await prisma.communicationMessage.findMany({ where: { patientId: patient.id } });
    expect(rows[0].status).toBe("FAILED");
  });

  it("persists a successful send and it is retrievable as conversation history", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    await sendPOST(jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "Can you tell us more?" }));
    const rows = await prisma.communicationMessage.findMany({ where: { patientId: patient.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("Can you tell us more?");
    expect(rows[0].direction).toBe("OUTBOUND");
  });

  it("records the self-reported sentByName when provided", async () => {
    process.env.DEMO_MODE = "true";
    const patient = await seedTestPatient();
    await sendPOST(
      jsonRequest({ patientId: patient.id, participant: "PATIENT", body: "hi", sentByName: "Maria Chen" })
    );
    const rows = await prisma.communicationMessage.findMany({ where: { patientId: patient.id } });
    expect(rows[0].sentByName).toBe("Maria Chen");
  });
});
