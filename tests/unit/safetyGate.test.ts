import { describe, expect, it } from "vitest";
import { checkSafetyGate } from "@/lib/safetyGate";

describe("checkSafetyGate", () => {
  it("triggers on explicit high-risk language", () => {
    const result = checkSafetyGate("I don't want to live anymore, I've been thinking about ending my life");
    expect(result.triggered).toBe(true);
    expect(result.reason).not.toBeNull();
  });

  it("triggers on a direct self-harm statement", () => {
    expect(checkSafetyGate("I've been thinking about hurting myself").triggered).toBe(true);
  });

  it("triggers on third-person relay (e.g. a caregiver reporting on the patient)", () => {
    expect(checkSafetyGate("she said she wants to end her life").triggered).toBe(true);
  });

  it("does NOT trigger on ordinary emotional distress", () => {
    expect(checkSafetyGate("I'm scared and overwhelmed").triggered).toBe(false);
    expect(checkSafetyGate("My husband is exhausted, we're struggling").triggered).toBe(false);
  });

  it("does NOT trigger on normal clinical messages", () => {
    expect(checkSafetyGate("7,6,8,101.3").triggered).toBe(false);
    expect(checkSafetyGate("feeling a lot worse today, pain's up a lot").triggered).toBe(false);
  });

  it("does NOT trigger on false-positive-sensitive idiomatic wording", () => {
    expect(checkSafetyGate("this nausea is killing me").triggered).toBe(false);
    expect(checkSafetyGate("This treatment is killing me, it's so exhausting").triggered).toBe(false);
    expect(checkSafetyGate("I could just die of embarrassment").triggered).toBe(false);
  });

  it("does NOT trigger on empty or whitespace-only text", () => {
    expect(checkSafetyGate("").triggered).toBe(false);
    expect(checkSafetyGate("   ").triggered).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(checkSafetyGate("I WANT TO DIE").triggered).toBe(true);
  });

  // Semifinal red-team fix: this list was English-only — verified live that
  // French/Spanish crisis language fell straight through to an ordinary
  // EMOTIONAL classification. These pin the zero-dependency regex floor;
  // lib/ai.ts's crisisLanguageDetected field is the second, LLM-based layer
  // for phrasing these patterns don't cover (see tests/integration/webhook.test.ts).
  it("triggers on French crisis language", () => {
    expect(checkSafetyGate("Je veux mourir, je n'en peux plus").triggered).toBe(true);
    expect(checkSafetyGate("j'en ai marre, je n'en peux plus").triggered).toBe(true);
    expect(checkSafetyGate("je veux me suicider").triggered).toBe(true);
  });

  it("triggers on Spanish crisis language, with or without accents", () => {
    expect(checkSafetyGate("Quiero morir, ya no puedo más").triggered).toBe(true);
    expect(checkSafetyGate("Quiero morir, ya no puedo mas").triggered).toBe(true);
    expect(checkSafetyGate("quiero suicidarme").triggered).toBe(true);
  });

  it("does NOT trigger on ordinary French/Spanish symptom or emotional messages", () => {
    expect(checkSafetyGate("J'ai beaucoup de douleur aujourd'hui, environ 7 sur 10").triggered).toBe(false);
    expect(checkSafetyGate("Tengo mucho dolor hoy, un 7 de 10").triggered).toBe(false);
    expect(checkSafetyGate("J'ai peur et je suis très inquiète pour mon traitement").triggered).toBe(false);
    expect(checkSafetyGate("Tengo miedo y estoy muy preocupada por mi tratamiento").triggered).toBe(false);
  });
});
