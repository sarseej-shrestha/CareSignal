import { describe, expect, it } from "vitest";
import { formatSoapNoteForExport } from "@/lib/soapNoteFormat";

describe("formatSoapNoteForExport", () => {
  it("prepends a draft-warning header for an unreviewed note", () => {
    const formatted = formatSoapNoteForExport({ fullText: "S: x", status: "DRAFT", reviewedAt: null });
    expect(formatted).toMatch(/^\[AI-GENERATED DRAFT — REQUIRES CLINICIAN REVIEW/);
    expect(formatted).toContain("S: x");
  });

  it("prepends a reviewed-confirmation header for a reviewed note, with the timestamp", () => {
    const reviewedAt = "2026-01-01T12:00:00.000Z";
    const formatted = formatSoapNoteForExport({ fullText: "S: x", status: "REVIEWED", reviewedAt });
    expect(formatted).toMatch(/^\[Reviewed by clinician/);
    expect(formatted).not.toMatch(/DRAFT/);
    expect(formatted).toContain("S: x");
  });

  it("never omits the header even without a reviewedAt timestamp on a reviewed note", () => {
    const formatted = formatSoapNoteForExport({ fullText: "S: x", status: "REVIEWED", reviewedAt: null });
    expect(formatted).toMatch(/^\[Reviewed by clinician\]/);
  });
});
