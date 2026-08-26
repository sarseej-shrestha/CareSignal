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
});
