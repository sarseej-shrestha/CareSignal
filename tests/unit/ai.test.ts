import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above imports by Vitest; referencing a
// `mock`-prefixed variable declared at module scope is the documented safe
// pattern for that hoisting. This lets every test control exactly what the
// "Groq API" returns without a real network call or API key.
const mockCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) {}
  }
  return { default: MockOpenAI };
});

function chatResponse(contentObj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(contentObj) } }] };
}

beforeEach(() => {
  mockCreate.mockReset();
  process.env.GROQ_API_KEY = "test-key";
});

describe("parsePatientSymptomText", () => {
  it("extracts a clear symptom report correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        pain: 2,
        nausea: 6,
        fatigue: 8,
        feverF: null,
        feverMentioned: true,
        summary: "Severe fatigue, moderate nausea, no fever.",
      })
    );
    const { parsePatientSymptomText } = await import("@/lib/ai");
    const result = await parsePatientSymptomText("feeling really wiped out, stomach's been bad, no fever though");

    expect(result.pain).toBe(2);
    expect(result.nausea).toBe(6);
    expect(result.fatigue).toBe(8);
    expect(result.fever).toBe(98.6); // null feverF -> defaults to 98.6
    expect(result.feverMentioned).toBe(true);
  });

  it("clamps out-of-range scores defensively, even if the model violates its own schema", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        pain: 15, // schema caps this at 10 — simulating a provider that doesn't fully enforce it
        nausea: -3,
        fatigue: 5,
        feverF: 250, // implausible
        feverMentioned: true,
        summary: "garbage in",
      })
    );
    const { parsePatientSymptomText } = await import("@/lib/ai");
    const result = await parsePatientSymptomText("whatever");

    expect(result.pain).toBe(10);
    expect(result.nausea).toBe(0);
    expect(result.fever).toBe(110); // clamped to the 90-110 plausible range
  });

  it("throws when the model returns no content", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: {} }] });
    const { parsePatientSymptomText } = await import("@/lib/ai");
    await expect(parsePatientSymptomText("hello")).rejects.toThrow(/no content/i);
  });

  it("propagates an API error (e.g. timeout) rather than swallowing it", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Request timed out"));
    const { parsePatientSymptomText } = await import("@/lib/ai");
    await expect(parsePatientSymptomText("hello")).rejects.toThrow(/timed out/i);
  });
});

describe("parseCaregiverMessageText", () => {
  it("extracts a coping-only message correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        intent: "CAREGIVER_COPING",
        patientSymptoms: null,
        caregiverCoping: { patientStatus: 3, copingScore: 1 },
        summary: "Caregiver reports exhaustion and overwhelm.",
      })
    );
    const { parseCaregiverMessageText } = await import("@/lib/ai");
    const result = await parseCaregiverMessageText("I don't know how much longer I can keep doing this. I'm exhausted.");

    expect(result.intent).toBe("CAREGIVER_COPING");
    expect(result.patientSymptoms).toBeNull();
    expect(result.caregiverCoping).toEqual({ patientStatus: 3, copingScore: 1 });
  });

  it("extracts a patient-relay message correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        intent: "PATIENT_SYMPTOMS",
        patientSymptoms: { pain: 3, nausea: 5, fatigue: 9, feverF: null, feverMentioned: true },
        caregiverCoping: null,
        summary: "Patient reports pain 3, nausea, severe fatigue, no fever.",
      })
    );
    const { parseCaregiverMessageText } = await import("@/lib/ai");
    const result = await parseCaregiverMessageText("he says pain is about a 3, still nauseous, wiped out, no fever");

    expect(result.intent).toBe("PATIENT_SYMPTOMS");
    expect(result.patientSymptoms).toMatchObject({ pain: 3, nausea: 5, fatigue: 9 });
    expect(result.caregiverCoping).toBeNull();
  });

  it("handles the known ambiguous edge case gracefully — both fields null, no throw", async () => {
    // Observed in real testing (see docs/pitch-notes.md): the model
    // occasionally can't confidently classify a caregiver message and
    // returns neither field. The webhook route asks a clarifying question
    // in this case (tested in the integration suite) — at this layer, the
    // contract we need is just: this returns a valid, well-typed result,
    // it does not throw and does not fabricate data.
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        intent: "UNCLEAR",
        patientSymptoms: null,
        caregiverCoping: null,
        summary: "Message intent unclear.",
      })
    );
    const { parseCaregiverMessageText } = await import("@/lib/ai");
    const result = await parseCaregiverMessageText("thinking of you");

    expect(result.intent).toBe("UNCLEAR");
    expect(result.patientSymptoms).toBeNull();
    expect(result.caregiverCoping).toBeNull();
  });

  it("clamps caregiver coping scores to the 1-5 range", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        intent: "CAREGIVER_COPING",
        patientSymptoms: null,
        caregiverCoping: { patientStatus: 0, copingScore: 9 },
        summary: "x",
      })
    );
    const { parseCaregiverMessageText } = await import("@/lib/ai");
    const result = await parseCaregiverMessageText("whatever");

    expect(result.caregiverCoping).toEqual({ patientStatus: 1, copingScore: 5 });
  });
});

describe("generateSoapNote", () => {
  const baseContext = {
    patientName: "Jane Doe",
    cancerType: "Breast cancer",
    chemoCycle: "Cycle 2 of 6",
    riskStatus: "RED" as const,
    riskScore: 0.95,
    hospitalizationRiskScore: 0.4,
    activeAlertReasons: ["Fever 101.3°F ≥ 100.4°F — potential neutropenic fever"],
    recentLogs: [{ daysAgo: 0, pain: 7, nausea: 6, fatigue: 8, fever: 101.3, source: "PATIENT_SMS" }],
    caregiverBurdenNote: null,
  };

  it("returns the four SOAP sections plus a combined fullText", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        subjective: "Patient reports worsening pain and fever.",
        objective: "Pain 7/10, fever 101.3°F.",
        assessment: "Possible neutropenic fever, Grade 3 pain.",
        plan: "Consider urgent evaluation.",
      })
    );
    const { generateSoapNote } = await import("@/lib/ai");
    const note = await generateSoapNote(baseContext);

    expect(note.subjective).toContain("worsening pain");
    expect(note.objective).toContain("101.3");
    expect(note.assessment).toContain("neutropenic");
    expect(note.plan).toContain("Consider");
    expect(note.fullText).toContain("S: Patient reports worsening pain and fever.");
    expect(note.fullText).toContain("P: Consider urgent evaluation.");
  });

  it("throws when the model returns no content", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: {} }] });
    const { generateSoapNote } = await import("@/lib/ai");
    await expect(generateSoapNote(baseContext)).rejects.toThrow(/no content/i);
  });

  it("propagates an API error rather than swallowing it", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Groq timeout"));
    const { generateSoapNote } = await import("@/lib/ai");
    await expect(generateSoapNote(baseContext)).rejects.toThrow(/timeout/i);
  });
});
