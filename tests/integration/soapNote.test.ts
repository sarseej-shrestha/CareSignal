import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient } from "../helpers/db";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, generateSoapNote: vi.fn() };
});

import { generateSoapNote } from "@/lib/ai";
import { POST } from "@/app/api/ai/soap-note/route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/ai/soap-note", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fakeNote = {
  subjective: "s",
  objective: "o",
  assessment: "a",
  plan: "p",
  fullText: "S: s\n\nO: o\n\nA: a\n\nP: p",
};

beforeEach(async () => {
  await resetDb();
  vi.mocked(generateSoapNote).mockReset();
});
afterEach(resetDb);

describe("POST /api/ai/soap-note", () => {
  it("returns 400 without a patientId", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown patientId", async () => {
    const res = await POST(jsonRequest({ patientId: "does-not-exist" }));
    expect(res.status).toBe(404);
  });

  it("generates a note and persists it on the open clinical alert", async () => {
    const patient = await seedTestPatient({ phone: "+19995553001" });
    const alert = await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: JSON.stringify(["Fever"]), status: "OPEN" },
    });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await POST(jsonRequest({ patientId: patient.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fullText).toBe(fakeNote.fullText);

    const updatedAlert = await prisma.riskAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(updatedAlert.soapNote).toBe(fakeNote.fullText);
  });

  it("still returns a note for a patient with no open alert, without persisting anywhere", async () => {
    const patient = await seedTestPatient({ phone: "+19995553002" });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await POST(jsonRequest({ patientId: patient.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fullText).toBe(fakeNote.fullText);

    const alerts = await prisma.riskAlert.findMany({ where: { patientId: patient.id } });
    expect(alerts).toHaveLength(0); // nothing to attach the note to, and nothing was created
  });

  it("passes the patient's active alert reasons and recent logs into the generator", async () => {
    const patient = await seedTestPatient({ phone: "+19995553003" });
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 8, nausea: 6, fatigue: 7, fever: 101, source: "PATIENT_SMS" },
    });
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: JSON.stringify(["Severe pain (8/10)"]), status: "OPEN" },
    });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    await POST(jsonRequest({ patientId: patient.id }));

    const callArg = vi.mocked(generateSoapNote).mock.calls[0][0];
    expect(callArg.activeAlertReasons).toEqual(["Severe pain (8/10)"]);
    expect(callArg.recentLogs).toHaveLength(1);
    expect(callArg.recentLogs[0]).toMatchObject({ pain: 8, nausea: 6, fatigue: 7, fever: 101 });
  });

  it("returns 500 (not a crash) when generation fails", async () => {
    const patient = await seedTestPatient({ phone: "+19995553004" });
    vi.mocked(generateSoapNote).mockRejectedValueOnce(new Error("Groq timeout"));

    const res = await POST(jsonRequest({ patientId: patient.id }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
