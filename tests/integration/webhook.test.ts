import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import twilio from "twilio";
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
    expect(xml).toContain("prompt medical attention"); // RED safety bounce-back

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

  it("replies in Spanish for a patient with preferredLanguage 'es'", async () => {
    const patient = await seedTestPatient({ phone: "+19995551097", preferredLanguage: "es" });
    const res = await POST(formRequest({ From: "+19995551097", To: "+1900", Body: "1,1,2,98.4" }));

    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("Gracias");
    expect(xml).not.toContain("Thanks");
    expect(xml).not.toContain("Merci");

    const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id } });
    expect(logs).toHaveLength(1);
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

// The RED safety bounce-back must fire from BOTH input paths — structured
// and freeform-AI-parsed — because once symptom values are known (from
// either path), the RED determination and this reply are 100% rules-engine
// output (lib/risk.ts), with no further LLM step that could be skipped by
// a timeout or error. These tests confirm that's actually true for both
// paths, not just the structured one already covered above.
describe("POST /api/twilio/inbound — RED safety bounce-back", () => {
  afterEach(() => {
    delete process.env.CLINIC_TRIAGE_PHONE;
  });

  it("fires on a structured RED input with the required safety content", async () => {
    await seedTestPatient({ phone: "+19995551300" });
    const res = await POST(formRequest({ From: "+19995551300", To: "+1900", Body: "7,7,8,101.5" }));
    const xml = await res.text();

    expect(xml).toContain("prompt medical attention");
    expect(xml).toContain("911");
    expect(xml).toContain("care team has also been notified");
  });

  it("fires on a freeform RED input (mocked AI parser) with the same required safety content", async () => {
    await seedTestPatient({ phone: "+19995551301" });
    vi.mocked(parsePatientSymptomText).mockResolvedValueOnce({
      pain: 8,
      nausea: 6,
      fatigue: 7,
      fever: 101.8,
      feverMentioned: true,
      summary: "severe pain and high fever",
    });

    const res = await POST(formRequest({ From: "+19995551301", To: "+1900", Body: "pain is really bad, 8 out of 10, and I have a fever" }));
    const xml = await res.text();

    expect(xml).toContain("prompt medical attention");
    expect(xml).toContain("911");
    expect(xml).toContain("care team has also been notified");
  });

  it("uses an obviously-fake placeholder when CLINIC_TRIAGE_PHONE isn't configured — never a plausible real number", async () => {
    delete process.env.CLINIC_TRIAGE_PHONE;
    await seedTestPatient({ phone: "+19995551302" });
    const res = await POST(formRequest({ From: "+19995551302", To: "+1900", Body: "7,7,8,101.5" }));
    const xml = await res.text();

    expect(xml).toContain("[clinic phone not configured]");
  });

  it("uses the configured CLINIC_TRIAGE_PHONE value when set", async () => {
    process.env.CLINIC_TRIAGE_PHONE = "(985) 555-0199";
    await seedTestPatient({ phone: "+19995551303" });
    const res = await POST(formRequest({ From: "+19995551303", To: "+1900", Body: "7,7,8,101.5" }));
    const xml = await res.text();

    expect(xml).toContain("(985) 555-0199");
    expect(xml).not.toContain("[clinic phone not configured]");
  });

  it("also fires when a caregiver relays a RED-level structured report on the patient's behalf", async () => {
    const patient = await seedTestPatient({ phone: "+19995551304" });
    await seedTestCaregiver(patient.id, { phone: "+19995551305" });
    const res = await POST(formRequest({ From: "+19995551305", To: "+1900", Body: "7,7,8,101.5" }));
    const xml = await res.text();

    expect(xml).toContain("prompt medical attention");
    expect(xml).toContain("911");
  });
});

// Every test above runs without TWILIO_AUTH_TOKEN set, which already
// exercises the "skip validation, demo mode" path on every request (all of
// them return 200 with no signature header at all). These tests cover the
// enforcement path specifically — every test file in this suite runs
// against the same process, so TWILIO_AUTH_TOKEN is explicitly unset in
// afterEach to avoid leaking into any other file's tests.
describe("POST /api/twilio/inbound — Twilio signature validation", () => {
  const WEBHOOK_URL = "http://localhost:3000/api/twilio/inbound";
  const FAKE_AUTH_TOKEN = "test-auth-token-not-real";

  afterEach(() => {
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  function signedFormRequest(fields: Record<string, string>, signature: string): NextRequest {
    const body = new URLSearchParams(fields).toString();
    return new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
      body,
    });
  }

  it("rejects a request with a missing/invalid signature (403) when TWILIO_AUTH_TOKEN is set", async () => {
    process.env.TWILIO_AUTH_TOKEN = FAKE_AUTH_TOKEN;
    await seedTestPatient({ phone: "+19995551200" });

    const res = await POST(signedFormRequest({ From: "+19995551200", To: "+1900", Body: "1,1,2,98.4" }, "not-a-real-signature"));
    expect(res.status).toBe(403);

    // Confirms rejection happens before any data is touched — an attacker
    // spoofing a phone number in the body can't write a fake symptom log.
    const logs = await prisma.symptomLog.findMany();
    expect(logs).toHaveLength(0);
  });

  it("accepts a request with a correctly computed signature when TWILIO_AUTH_TOKEN is set", async () => {
    process.env.TWILIO_AUTH_TOKEN = FAKE_AUTH_TOKEN;
    await seedTestPatient({ phone: "+19995551201" });

    const fields = { From: "+19995551201", To: "+1900", Body: "1,1,2,98.4" };
    const signature = twilio.getExpectedTwilioSignature(FAKE_AUTH_TOKEN, WEBHOOK_URL, fields);

    const res = await POST(signedFormRequest(fields, signature));
    expect(res.status).toBe(200);

    const logs = await prisma.symptomLog.findMany();
    expect(logs).toHaveLength(1);
  });
});
