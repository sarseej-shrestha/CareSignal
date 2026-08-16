import { describe, expect, it } from "vitest";
import { normalizeLang, t } from "@/lib/i18n";

describe("normalizeLang", () => {
  it("passes through 'fr'", () => {
    expect(normalizeLang("fr")).toBe("fr");
  });
  it("passes through 'en'", () => {
    expect(normalizeLang("en")).toBe("en");
  });
  it("defaults to 'en' for null/undefined/unknown values", () => {
    expect(normalizeLang(null)).toBe("en");
    expect(normalizeLang(undefined)).toBe("en");
    expect(normalizeLang("es")).toBe("en");
    expect(normalizeLang("")).toBe("en");
  });
});

describe("t", () => {
  it("returns the English message for 'en'", () => {
    expect(t("ackGreen", "en")).toMatch(/Thanks/);
  });

  it("returns a different, French message for 'fr'", () => {
    const en = t("ackGreen", "en");
    const fr = t("ackGreen", "fr");
    expect(fr).not.toBe(en);
    expect(fr).toMatch(/Merci/);
  });

  it("substitutes {{params}} in both languages", () => {
    expect(t("caregiverRelayPrefix", "en", { name: "Alex" })).toContain("Alex's behalf");
    expect(t("caregiverRelayPrefix", "fr", { name: "Alex" })).toContain("au nom de Alex");
  });

  it("every message key has both an en and fr translation", async () => {
    // Reach into the module's every exported key indirectly by checking a
    // representative sample of keys used by the webhook route — a missing
    // translation would silently fall back to English (t()'s designed
    // behavior), so this test's real job is making sure fr isn't just an
    // empty string or accidentally identical to en for any of them.
    const keys = [
      "ackRed",
      "ackYellow",
      "ackGreen",
      "genericLogged",
      "patientParseFailed",
      "caregiverBurdenFlaggedStructured",
      "caregiverCopingLoggedStructured",
      "caregiverBurdenNote",
      "clarifyingQuestion",
      "caregiverParseFailed",
      "emptyBody",
      "unrecognizedNumber",
      "genericFallback",
    ] as const;
    for (const key of keys) {
      const en = t(key, "en");
      const fr = t(key, "fr");
      expect(en.length).toBeGreaterThan(0);
      expect(fr.length).toBeGreaterThan(0);
      expect(fr).not.toBe(en);
    }
  });
});
