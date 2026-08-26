import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient, seedTestCaregiver } from "../helpers/db";

vi.mock("@/lib/communications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communications")>();
  return { ...actual, sendOutboundCommunication: vi.fn() };
});

import { sendOutboundCommunication } from "@/lib/communications";
import { POST } from "@/app/api/alerts/[id]/status/route";

function statusRequest(status: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/alerts/x/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(sendOutboundCommunication).mockReset();
  vi.mocked(sendOutboundCommunication).mockResolvedValue({
    message: {} as never,
    ok: true,
  });
});

afterEach(async () => {
  await resetDb();
});

describe("POST /api/alerts/[id]/status", () => {
  it("updates status from OPEN to REVIEWED", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "OPEN" },
    });

    const res = await POST(statusRequest("REVIEWED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("REVIEWED");
  });

  it("updates status from REVIEWED to ACTIONED", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "REVIEWED" },
    });

    const res = await POST(statusRequest("ACTIONED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("ACTIONED");
  });

  it("updates status from ACTIONED to RESOLVED", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "EMOTIONAL", reasons: "[]", status: "ACTIONED" },
    });

    const res = await POST(statusRequest("RESOLVED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  it("updates status directly from REVIEWED to RESOLVED (resolving doesn't require ACTIONED first)", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "EMOTIONAL", reasons: "[]", status: "REVIEWED" },
    });

    const res = await POST(statusRequest("RESOLVED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  it("rejects the old ACKNOWLEDGED value — no longer valid", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "OPEN" },
    });

    const res = await POST(statusRequest("ACKNOWLEDGED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status value", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "OPEN" },
    });

    const res = await POST(statusRequest("DELETED_FOREVER"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(400);
    const unchanged = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(unchanged?.status).toBe("OPEN");
  });

  it("returns 404 for a nonexistent alert id", async () => {
    const res = await POST(statusRequest("RESOLVED"), { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });
});

// Semifinal closed-loop feature: marking OPEN -> REVIEWED sends exactly one
// review-acknowledgment SMS. This must never fire on any other transition,
// never fire twice for the same click, and must not resolve the underlying
// alert — communication is not the same thing as resolution.
describe("POST /api/alerts/[id]/status — review acknowledgment", () => {
  it("sends exactly one acknowledgment on OPEN -> REVIEWED, to the patient for a clinical alert", async () => {
    const patient = await seedTestPatient({ preferredLanguage: "es" });
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN" },
    });

    await POST(statusRequest("REVIEWED"), { params: Promise.resolve({ id: alert.id }) });

    expect(sendOutboundCommunication).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendOutboundCommunication).mock.calls[0][0];
    expect(call.participant).toBe("PATIENT");
    expect(call.to).toBe(patient.phone);
    // Uses the patient's own preferredLanguage via the existing i18n
    // infrastructure — not a new translation system.
    expect(call.body).toContain("revisado"); // Spanish reviewAcknowledgment wording
  });

  it("sends the acknowledgment to the caregiver, not the patient, for a CAREGIVER_BURDEN alert", async () => {
    const patient = await seedTestPatient();
    const caregiver = await seedTestCaregiver(patient.id, { preferredLanguage: "fr" });
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "CAREGIVER_BURDEN", reasons: "[]", status: "OPEN" },
    });

    await POST(statusRequest("REVIEWED"), { params: Promise.resolve({ id: alert.id }) });

    expect(sendOutboundCommunication).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendOutboundCommunication).mock.calls[0][0];
    expect(call.participant).toBe("CAREGIVER");
    expect(call.to).toBe(caregiver.phone);
  });

  it("does NOT send an acknowledgment on REVIEWED -> RESOLVED (only the OPEN -> REVIEWED transition qualifies)", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "REVIEWED" },
    });

    await POST(statusRequest("RESOLVED"), { params: Promise.resolve({ id: alert.id }) });
    expect(sendOutboundCommunication).not.toHaveBeenCalled();
  });

  it("does NOT send a second acknowledgment when REVIEWED is set again on an already-REVIEWED alert (duplicate-click protection)", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "LOGISTICAL", reasons: "[]", status: "REVIEWED" },
    });

    await POST(statusRequest("REVIEWED"), { params: Promise.resolve({ id: alert.id }) });
    expect(sendOutboundCommunication).not.toHaveBeenCalled();
  });

  it("does not resolve the alert as a side effect of sending the acknowledgment", async () => {
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN" },
    });

    await POST(statusRequest("REVIEWED"), { params: Promise.resolve({ id: alert.id }) });
    const updated = await prisma.riskAlert.findUnique({ where: { id: alert.id } });
    expect(updated?.status).toBe("REVIEWED");
    expect(updated?.status).not.toBe("RESOLVED");
  });

  it("still marks the alert REVIEWED even if the acknowledgment send fails (status change is independent of notification delivery)", async () => {
    vi.mocked(sendOutboundCommunication).mockResolvedValueOnce({
      message: {} as never,
      ok: false,
      error: "Twilio unavailable",
    });
    const patient = await seedTestPatient();
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: "[]", status: "OPEN" },
    });

    const res = await POST(statusRequest("REVIEWED"), { params: Promise.resolve({ id: alert.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("REVIEWED");
    expect(data.ackSent).toBe(false);
    expect(data.ackError).toContain("Twilio unavailable");
  });
});
