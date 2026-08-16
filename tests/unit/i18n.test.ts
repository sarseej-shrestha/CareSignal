import { describe, expect, it } from "vitest";
import { normalizeLang, t } from "@/lib/i18n";

describe("normalizeLang", () => {
  it("passes through 'fr'", () => {
    expect(normalizeLang("fr")).toBe("fr");
  });
  it("passes through 'en'", () => {
    expect(normalizeLang("en")).toBe("en");
  });
  it("passes through 'es'", () => {
    expect(normalizeLang("es")).toBe("es");
  });
  it("defaults to 'en' for null/undefined/unknown values", () => {
    expect(normalizeLang(null)).toBe("en");
    expect(normalizeLang(undefined)).toBe("en");
    expect(normalizeLang("de")).toBe("en");
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

  it("returns a different, Spanish message for 'es'", () => {
    const en = t("ackGreen", "en");
    const es = t("ackGreen", "es");
    expect(es).not.toBe(en);
    expect(es).toMatch(/Gracias/);
  });

  it("substitutes {{params}} in all three languages", () => {
    expect(t("caregiverRelayPrefix", "en", { name: "Alex" })).toContain("Alex's behalf");
    expect(t("caregiverRelayPrefix", "fr", { name: "Alex" })).toContain("au nom de Alex");
    expect(t("caregiverRelayPrefix", "es", { name: "Alex" })).toContain("nombre de Alex");
  });

  it("every message key has en, fr, AND es translations, each distinct", async () => {
    // A missing translation would silently fall back to English (t()'s
    // designed behavior), so this test's real job is making sure fr/es
    // aren't empty strings or accidentally identical to en for any key.
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
      const es = t(key, "es");
      expect(en.length).toBeGreaterThan(0);
      expect(fr.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      expect(fr).not.toBe(en);
      expect(es).not.toBe(en);
      expect(es).not.toBe(fr);
    }
  });
});
