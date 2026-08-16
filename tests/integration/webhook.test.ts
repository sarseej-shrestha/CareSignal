import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb, seedTestPatient, seedTestCaregiver } from "../helpers/db";

vi.mock("@/lib/ai", () => ({
  parsePatientSymptomText: vi.fn(),
  parseCaregiverMessageText: vi.fn(),
}));

import { parseCaregiverMessageText, parsePatientSymptomText } from "@/lib/ai";
import { POST } from "@/app/api/twilio/inbound/route";

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
  vi.mocked(parsePatientSymptomText).mockReset();
  vi.mocked(parseCaregiverMessageText).mockReset();
});

afterEach(async () => {
  await resetDb();
});

describe("POST /api/twilio/inbound", () => {
  it("records a structured patient symptom report and returns TwiML", async () => {
    const patient = await seedTestPatient({ phone: "+19995551001" });
    const res = await POST(formRequest({ From: "+19995551001", To: "+1900", Body: "6,7,8,101.5" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const xml = await res.text();
    expect(xml).toContain("nurse from your care team"); // RED ack message

    const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ pain: 6, nausea: 7, fatigue: 8, fever: 101.5, source: "PATIENT_SMS", parsedByAi: false });

    const updated = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(updated.riskStatus).toBe("RED");
    // A fever >=100.4 + severe pain/nausea this recently should also register
    // as a real hospitalization-risk signal (fever recurrence + severe day +
    // high daily model prob all feed the 7-day rolling features) — not left
    // at its default 0.
    expect(updated.hospitalizationRiskScore).toBeGreaterThan(0);
  });

  it("replies in French for a patient with preferredLanguage 'fr'", async () => {
    const patient = await seedTestPatient({ phone: "+19995551099", preferredLanguage: "fr" });
    const res = await POST(formRequest({ From: "+19995551099", To: "+1900", Body: "1,1,2,98.4" }));

    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("Merci");
    expect(xml).not.toContain("Thanks");

    const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id } });
    expect(logs).toHaveLength(1); // language only affects the reply text, not what's recorded
  });

  it("replies in English by default when preferredLanguage is unset", async () => {
    await seedTestPatient({ phone: "+19995551098" });
    const res = await POST(formRequest({ From: "+19995551098", To: "+1900", Body: "1,1,2,98.4" }));
    const xml = await res.text();
    expect(xml).toContain("Thanks");
  });

  it("records a freeform patient symptom report via the mocked AI parser", async () => {
    const patient = await seedTestPatient({ phone: "+19995551002" });
    vi.mocked(parsePatientSymptomText).mockResolvedValueOnce({
      pain: 1,
      nausea: 1,
      fatigue: 2,
      fever: 98.4,
      feverMentioned: false,
      summary: "mild",
    });

    const res = await POST(formRequest({ From: "+19995551002", To: "+1900", Body: "feeling okay today" }));
    expect(res.status).toBe(200);

    const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ pain: 1, nausea: 1, source: "PATIENT_SMS", parsedByAi: true, rawSmsText: "feeling okay today" });
  });

  it("replies gracefully (not a crash) when the AI parser rejects", async () => {
    await seedTestPatient({ phone: "+19995551003" });
    vi.mocked(parsePatientSymptomText).mockRejectedValueOnce(new Error("Groq timeout"));

    const res = await POST(formRequest({ From: "+19995551003", To: "+1900", Body: "not feeling great" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("couldn't understand that message");
  });

  it("records a caregiver's structured relay of the patient's symptoms with CAREGIVER_SMS source", async () => {
    const patient = await seedTestPatient({ phone: "+19995551004" });
    await seedTestCaregiver(patient.id, { phone: "+19995552004" });

    const res = await POST(formRequest({ From: "+19995552004", To: "+1900", Body: "3,3,5,98.5" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(`on ${patient.firstName}'s behalf`);

    const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].source).toBe("CAREGIVER_SMS");
    expect(logs[0].parsedByAi).toBe(false);
  });

  it("records a caregiver's structured coping check-in and flags burden below the threshold", async () => {
    const patient = await seedTestPatient({ phone: "+19995551005" });
    const caregiver = await seedTestCaregiver(patient.id, { phone: "+19995552005" });

    const res = await POST(formRequest({ From: "+19995552005", To: "+1900", Body: "2,1" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("flagged this for your care team");

    const caregiverLogs = await prisma.caregiverLog.findMany({ where: { caregiverId: caregiver.id } });
    expect(caregiverLogs).toHaveLength(1);
    expect(caregiverLogs[0]).toMatchObject({ patientStatus: 2, copingScore: 1 });

    const alerts = await prisma.riskAlert.findMany({ where: { patientId: patient.id, level: "CAREGIVER_BURDEN" } });
    expect(alerts).toHaveLength(1);
  });

  it("does NOT flag burden when the caregiver's coping score is above the threshold", async () => {
    const patient = await seedTestPatient({ phone: "+19995551006" });
    const caregiver = await seedTestCaregiver(patient.id, { phone: "+19995552006" });

    const res = await POST(formRequest({ From: "+19995552006", To: "+1900", Body: "4,4" }));
    expect(res.status).toBe(200);

    const alerts = await prisma.riskAlert.findMany({ where: { patientId: patient.id, level: "CAREGIVER_BURDEN" } });
    expect(alerts).toHaveLength(0);
    const caregiverLogs = await prisma.caregiverLog.findMany({ where: { caregiverId: caregiver.id } });
    expect(caregiverLogs).toHaveLength(1);
  });

  it("routes a caregiver's freeform coping message through the AI parser and flags burden", async () => {
    const patient = await seedTestPatient({ phone: "+19995551007" });
    await seedTestCaregiver(patient.id, { phone: "+19995552007" });
    vi.mocked(parseCaregiverMessageText).mockResolvedValueOnce({
      intent: "CAREGIVER_COPING",
      patientSymptoms: null,
      caregiverCoping: { patientStatus: 3, copingScore: 1 },
      summary: "exhausted",
    });

    const res = await POST(
      formRequest({ From: "+19995552007", To: "+1900", Body: "I don't know how much longer I can do this" })
    );
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("flagged this for your care team");

    const alerts = await prisma.riskAlert.findMany({ where: { patientId: patient.id, level: "CAREGIVER_BURDEN" } });
    expect(alerts).toHaveLength(1);
  });

  it("asks a clarifying question — the known ambiguous edge case — without creating any log", async () => {
    const patient = await seedTestPatient({ phone: "+19995551008" });
    const caregiver = await seedTestCaregiver(patient.id, { phone: "+19995552008" });
    vi.mocked(parseCaregiverMessageText).mockResolvedValueOnce({
      intent: "UNCLEAR",
      patientSymptoms: null,
      caregiverCoping: null,
      summary: "unclear",
    });

    const res = await POST(formRequest({ From: "+19995552008", To: "+1900", Body: "thinking of you both" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("couldn't quite tell");

    expect(await prisma.symptomLog.count({ where: { patientId: patient.id } })).toBe(0);
    expect(await prisma.caregiverLog.count({ where: { caregiverId: caregiver.id } })).toBe(0);
  });

  it("replies gracefully to a phone number that matches neither a patient nor a caregiver", async () => {
    const res = await POST(formRequest({ From: "+19999999999", To: "+1900", Body: "hi" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("isn't recognized");
  });

  it("returns 400 (not a crash) for a malformed multipart payload", async () => {
    const req = new NextRequest("http://localhost:3000/api/twilio/inbound", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=----broken" },
      body: "this is not a valid multipart body\r\n--wrongboundary--",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/could not parse/i);
  });

  it("returns a friendly TwiML reply (not a raw error) for an empty message body", async () => {
    await seedTestPatient({ phone: "+19995551009" });
    const res = await POST(formRequest({ From: "+19995551009", To: "+1900", Body: "" }));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("didn't get any text");
  });

  it("returns 400 for a missing From field", async () => {
    const res = await POST(formRequest({ To: "+1900", Body: "hello" }));
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range structured input and falls through to AI parsing instead of writing garbage", async () => {
    const patient = await seedTestPatient({ phone: "+19995551010" });
    vi.mocked(parsePatientSymptomText).mockResolvedValueOnce({
      pain: 0,
      nausea: 0,
      fatigue: 0,
      fever: 98.6,
      feverMentioned: false,
      summary: "nonsense input, defaulted low",
    });

    const res = await POST(formRequest({ From: "+19995551010", To: "+1900", Body: "99,99,99,999" }));
    expect(res.status).toBe(200);

    const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].parsedByAi).toBe(true); // proves it went through the AI path, not the structured one
    expect(logs[0].fever).toBeLessThan(110); // never the literal "999" from the raw text
  });
});
