import { describe, expect, it } from "vitest";
import { selectAlert, type SelectableAlert } from "@/lib/selectAlert";

function alert(level: string, status: string, createdAt: string): SelectableAlert {
  return { level, status, createdAt };
}

const isClinical = (level: string) => level === "YELLOW" || level === "RED";

describe("selectAlert", () => {
  it("returns the newest matching alert when only one exists", () => {
    const alerts = [alert("RED", "OPEN", "2026-08-20")];
    expect(selectAlert(alerts, isClinical)?.status).toBe("OPEN");
  });

  it("returns null when nothing matches the level predicate", () => {
    const alerts = [alert("CAREGIVER_BURDEN", "OPEN", "2026-08-20")];
    expect(selectAlert(alerts, isClinical)).toBeNull();
  });

  // Semifinal red-team fix: this is the objectively-wrong case a plain
  // .find() on a newest-first array produced — a RESOLVED alert created
  // after an older, still-OPEN one silently took its place, making the
  // still-actionable alert invisible everywhere in the dashboard.
  it("prefers a still-open alert over a newer resolved one of the same category", () => {
    // Newest-first, matching how app/dashboard/page.tsx queries alerts.
    const alerts = [
      alert("YELLOW", "RESOLVED", "2026-08-22"), // newer, but resolved
      alert("RED", "OPEN", "2026-08-20"), // older, still open
    ];
    const selected = selectAlert(alerts, isClinical);
    expect(selected?.status).toBe("OPEN");
    expect(selected?.level).toBe("RED");
  });

  it("prefers a still-open alert over a newer ACKNOWLEDGED-then-resolved one", () => {
    const alerts = [
      alert("RED", "RESOLVED", "2026-08-23"),
      alert("YELLOW", "ACKNOWLEDGED", "2026-08-21"),
    ];
    const selected = selectAlert(alerts, isClinical);
    expect(selected?.status).toBe("ACKNOWLEDGED");
  });

  it("falls back to the newest alert when everything is resolved (still renders historically)", () => {
    const alerts = [
      alert("YELLOW", "RESOLVED", "2026-08-22"),
      alert("RED", "RESOLVED", "2026-08-20"),
    ];
    const selected = selectAlert(alerts, isClinical);
    expect(selected?.status).toBe("RESOLVED");
    expect(selected?.level).toBe("YELLOW"); // the newer of the two resolved alerts
  });

  it("among multiple open alerts, picks the newest (documented, deferred limitation)", () => {
    const alerts = [
      alert("YELLOW", "OPEN", "2026-08-23"), // newer, lower severity
      alert("RED", "OPEN", "2026-08-20"), // older, higher severity — not surfaced
    ];
    const selected = selectAlert(alerts, isClinical);
    expect(selected?.level).toBe("YELLOW");
  });
});
