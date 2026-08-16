import { describe, expect, it } from "vitest";
import { assessSoapNoteConfidence } from "@/lib/soapNoteConfidence";

describe("assessSoapNoteConfidence", () => {
  it("is HIGH for 3+ structured (non-AI-parsed) logs", () => {
    const result = assessSoapNoteConfidence({ logCount: 5, aiParsedLogCount: 0 });
    expect(result.level).toBe("HIGH");
    expect(result.reasons).toEqual([]);
  });

  it("is LIMITED for fewer than 3 logs", () => {
    const result = assessSoapNoteConfidence({ logCount: 2, aiParsedLogCount: 0 });
    expect(result.level).toBe("LIMITED");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("is LIMITED with a distinct reason for zero logs", () => {
    const result = assessSoapNoteConfidence({ logCount: 0, aiParsedLogCount: 0 });
    expect(result.level).toBe("LIMITED");
    expect(result.reasons[0]).toMatch(/no check-in history/i);
  });

  it("is LIMITED when half or more of the logs were AI-parsed, even with plenty of history", () => {
    const result = assessSoapNoteConfidence({ logCount: 6, aiParsedLogCount: 3 });
    expect(result.level).toBe("LIMITED");
    expect(result.reasons.some((r) => r.includes("freeform"))).toBe(true);
  });

  it("is HIGH when fewer than half the logs were AI-parsed and history is sufficient", () => {
    const result = assessSoapNoteConfidence({ logCount: 6, aiParsedLogCount: 2 });
    expect(result.level).toBe("HIGH");
  });

  it("can report both reasons at once", () => {
    const result = assessSoapNoteConfidence({ logCount: 1, aiParsedLogCount: 1 });
    expect(result.level).toBe("LIMITED");
    expect(result.reasons.length).toBe(2);
  });
});
