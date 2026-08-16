import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient } from "../helpers/db";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, generateSoapNote: vi.fn() };
});

import { generateSoapNote } from "@/lib/ai";
import { POST as generatePOST } from "@/app/api/ai/soap-note/route";
import { POST as reviewPOST } from "@/app/api/ai/soap-note/[id]/review/route";

function jsonRequest(url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", {}));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown patientId", async () => {
    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: "does-not-exist" }));
    expect(res.status).toBe(404);
  });

  it("generates and PERSISTS a note as a first-class record, always starting DRAFT", async () => {
    const patient = await seedTestPatient({ phone: "+19995553001" });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fullText).toBe(fakeNote.fullText);
    expect(body.status).toBe("DRAFT");
    expect(body.reviewedAt).toBeNull();
    expect(body.id).toBeTruthy();

    const stored = await prisma.soapNote.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.status).toBe("DRAFT");
    expect(stored.patientId).toBe(patient.id);
  });

  it("persists a note even for a patient with NO open alert — decoupled from RiskAlert lifecycle", async () => {
    const patient = await seedTestPatient({ phone: "+19995553002" });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));
    expect(res.status).toBe(200);

    const count = await prisma.soapNote.count({ where: { patientId: patient.id } });
    expect(count).toBe(1);
  });

  it("computes LIMITED confidence for a patient with fewer than 3 check-ins", async () => {
    const patient = await seedTestPatient({ phone: "+19995553003" });
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 2, nausea: 2, fatigue: 2, fever: 98.4, source: "PATIENT_SMS" },
    });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));
    const body = await res.json();
    expect(body.confidenceLevel).toBe("LIMITED");
    expect(body.confidenceReasons.length).toBeGreaterThan(0);
  });

  it("computes LIMITED confidence when half or more of the check-ins were AI-parsed freeform text", async () => {
    const patient = await seedTestPatient({ phone: "+19995553004" });
    for (let i = 0; i < 3; i++) {
      await prisma.symptomLog.create({
        data: { patientId: patient.id, pain: 2, nausea: 2, fatigue: 2, fever: 98.4, source: "PATIENT_SMS", parsedByAi: true },
      });
    }
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));
    const body = await res.json();
    expect(body.confidenceLevel).toBe("LIMITED");
  });

  it("computes HIGH confidence for 3+ structured check-ins", async () => {
    const patient = await seedTestPatient({ phone: "+19995553005" });
    for (let i = 0; i < 5; i++) {
      await prisma.symptomLog.create({
        data: { patientId: patient.id, pain: 2, nausea: 2, fatigue: 2, fever: 98.4, source: "PATIENT_SMS", parsedByAi: false },
      });
    }
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));
    const body = await res.json();
    expect(body.confidenceLevel).toBe("HIGH");
    expect(body.confidenceReasons).toEqual([]);
  });

  it("passes the patient's active alert reasons and recent logs into the generator", async () => {
    const patient = await seedTestPatient({ phone: "+19995553006" });
    await prisma.symptomLog.create({
      data: { patientId: patient.id, pain: 8, nausea: 6, fatigue: 7, fever: 101, source: "PATIENT_SMS" },
    });
    await prisma.riskAlert.create({
      data: { patientId: patient.id, level: "RED", reasons: JSON.stringify(["Severe pain (8/10)"]), status: "OPEN" },
    });
    vi.mocked(generateSoapNote).mockResolvedValueOnce(fakeNote);

    await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));

    const callArg = vi.mocked(generateSoapNote).mock.calls[0][0];
    expect(callArg.activeAlertReasons).toEqual(["Severe pain (8/10)"]);
    expect(callArg.recentLogs).toHaveLength(1);
    expect(callArg.recentLogs[0]).toMatchObject({ pain: 8, nausea: 6, fatigue: 7, fever: 101 });
  });

  it("returns 500 (not a crash) when generation fails, and does not persist anything", async () => {
    const patient = await seedTestPatient({ phone: "+19995553007" });
    vi.mocked(generateSoapNote).mockRejectedValueOnce(new Error("Groq timeout"));

    const res = await generatePOST(jsonRequest("http://localhost/api/ai/soap-note", { patientId: patient.id }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(await prisma.soapNote.count({ where: { patientId: patient.id } })).toBe(0);
  });
});

describe("POST /api/ai/soap-note/[id]/review", () => {
  it("returns 404 for an unknown note id", async () => {
    const res = await reviewPOST(jsonRequest("http://localhost/api/ai/soap-note/x/review"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("marks a DRAFT note as REVIEWED and sets reviewedAt — the only way status changes", async () => {
    const patient = await seedTestPatient({ phone: "+19995553008" });
    const note = await prisma.soapNote.create({
      data: {
        patientId: patient.id,
        subjective: "s",
        objective: "o",
        assessment: "a",
        plan: "p",
        fullText: "S: s\n\nO: o\n\nA: a\n\nP: p",
        confidenceLevel: "HIGH",
        confidenceReasons: "[]",
        status: "DRAFT",
      },
    });
    expect(note.status).toBe("DRAFT");
    expect(note.reviewedAt).toBeNull();

    const res = await reviewPOST(jsonRequest("http://localhost/api/ai/soap-note/x/review"), {
      params: Promise.resolve({ id: note.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("REVIEWED");
    expect(body.reviewedAt).toBeTruthy();

    const stored = await prisma.soapNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(stored.status).toBe("REVIEWED");
    expect(stored.reviewedAt).not.toBeNull();
  });
});
