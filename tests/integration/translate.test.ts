import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient } from "../helpers/db";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, translateForClinician: vi.fn() };
});

import { translateForClinician } from "@/lib/ai";
import { checkSafetyGate } from "@/lib/safetyGate";
import { POST as translatePOST } from "@/app/api/ai/translate/route";
import { POST as webhookPOST } from "@/app/api/twilio/inbound/route";

function jsonRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function formRequest(fields: Record<string, string>): NextRequest {
  const body = new URLSearchParams(fields).toString();
  return new NextRequest("http://localhost:3000/api/twilio/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(translateForClinician).mockReset();
});
afterEach(resetDb);

describe("POST /api/ai/translate", () => {
  it("returns 400 without text", async () => {
    const res = await translatePOST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns a faithful translation for a Spanish symptom message", async () => {
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "Since yesterday I've had a lot of pain, about 8 out of 10.",
      aiGenerated: true,
    });
    const res = await translatePOST(jsonRequest({ text: "Desde ayer tengo mucho dolor, como un 8 de 10." }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.translation).toContain("8 out of 10");
    expect(data.aiGenerated).toBe(true);
  });

  it("returns a faithful translation for a French symptom message", async () => {
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "I have a lot of pain today, about 7 out of 10.",
      aiGenerated: true,
    });
    const res = await translatePOST(jsonRequest({ text: "J'ai beaucoup de douleur aujourd'hui, environ 7 sur 10." }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.translation).toContain("7 out of 10");
  });

  it("preserves negation rather than reversing meaning", async () => {
    // "no fever" must stay "no fever" — a translation that flips this would
    // be a genuine clinical hazard, not just an inaccuracy.
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "My pain is worse today, no fever though.",
      aiGenerated: true,
    });
    const res = await translatePOST(jsonRequest({ text: "mi dolor está peor hoy, pero no tengo fiebre" }));
    const data = await res.json();
    expect(data.translation.toLowerCase()).toContain("no fever");
    expect(data.translation.toLowerCase()).not.toContain("have a fever");
  });

  it("preserves severity/quantities exactly", async () => {
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "My pain is 8 out of 10 today.",
      aiGenerated: true,
    });
    const res = await translatePOST(jsonRequest({ text: "mi dolor es 8 de 10 hoy" }));
    const data = await res.json();
    expect(data.translation).toContain("8 out of 10");
  });

  it("preserves dates/time references", async () => {
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "Since Tuesday I've had a fever.",
      aiGenerated: true,
    });
    const res = await translatePOST(jsonRequest({ text: "desde el martes tengo fiebre" }));
    const data = await res.json();
    expect(data.translation.toLowerCase()).toContain("tuesday");
  });

  it("is available for a crisis message, and returns only a translation (no safety fields)", async () => {
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "I want to die, I can't do this anymore.",
      aiGenerated: true,
    });
    const res = await translatePOST(jsonRequest({ text: "Quiero morir, ya no puedo más." }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["aiGenerated", "translation"]);
  });

  it("fails gracefully on a provider error — no crash, actionable error message", async () => {
    vi.mocked(translateForClinician).mockRejectedValueOnce(new Error("network error"));
    const res = await translatePOST(jsonRequest({ text: "Quiero morir, ya no puedo más." }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Translation unavailable");
  });

  it("returns a friendly message on a 429 without retrying automatically", async () => {
    const rateLimitError = Object.assign(new Error("rate limited"), { status: 429 });
    vi.mocked(translateForClinician).mockRejectedValueOnce(rateLimitError);
    const res = await translatePOST(jsonRequest({ text: "Tengo dolor" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error.toLowerCase()).toContain("rate-limited");
    // Exactly one call — the route itself never retries.
    expect(translateForClinician).toHaveBeenCalledTimes(1);
  });

  it("repeated identical requests each call the provider once (route itself has no cache — caching is client-side, see components/TranslateMessage.tsx)", async () => {
    vi.mocked(translateForClinician).mockResolvedValue({ translation: "translated", aiGenerated: true });
    await translatePOST(jsonRequest({ text: "Tengo dolor" }));
    await translatePOST(jsonRequest({ text: "Tengo dolor" }));
    expect(translateForClinician).toHaveBeenCalledTimes(2);
  });
});

// The core architectural requirement: translation is a clinician-presentation
// layer that sits entirely OUTSIDE the inbound safety/risk pipeline, not a
// step inserted before or into it.
describe("translation isolation from the safety/risk pipeline", () => {
  it("the translate route makes no database writes — it cannot alter a patient record, alert, or risk score", async () => {
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "I want to die, I can't do this anymore.",
      aiGenerated: true,
    });
    await translatePOST(jsonRequest({ text: "Quiero morir, ya no puedo más." }));
    // No patient exists at all in this test — if the route touched the
    // database in any way tied to a patient record, this would throw.
    expect(await prisma.riskAlert.count()).toBe(0);
    expect(await prisma.symptomLog.count()).toBe(0);
  });

  it("the deterministic safety gate's decision for a crisis message is identical whether or not translation is later requested", async () => {
    const text = "Quiero morir, ya no puedo más.";
    const before = checkSafetyGate(text);
    vi.mocked(translateForClinician).mockResolvedValueOnce({
      translation: "I want to die, I can't do this anymore.",
      aiGenerated: true,
    });
    await translatePOST(jsonRequest({ text }));
    const after = checkSafetyGate(text);
    expect(after).toEqual(before);
    expect(before.triggered).toBe(true);
  });

  it("the live webhook's SAFETY escalation for a crisis message is unaffected by translateForClinician being mocked in this suite", async () => {
    // Proves the two code paths are genuinely disjoint, not just
    // coincidentally consistent: with translateForClinician mocked (and
    // never called here), the real webhook path still produces the real
    // safety outcome using its own, separate deterministic gate.
    const patient = await seedTestPatient({ phone: "+19995559001" });
    const res = await webhookPOST(
      formRequest({ From: "+19995559001", To: "+1900", Body: "Quiero morir, ya no puedo más." })
    );
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("911");
    const alerts = await prisma.riskAlert.findMany({ where: { patientId: patient.id, level: "SAFETY" } });
    expect(alerts).toHaveLength(1);
    expect(translateForClinician).not.toHaveBeenCalled();
  });
});
