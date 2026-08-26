import { describe, expect, it } from "vitest";
import { isNeedCategory, routeForCategory, NEED_CATEGORIES } from "@/lib/needCategory";

describe("isNeedCategory", () => {
  it("accepts every defined category", () => {
    for (const c of NEED_CATEGORIES) {
      expect(isNeedCategory(c)).toBe(true);
    }
  });

  it("rejects unrecognized or malformed values", () => {
    expect(isNeedCategory("SOMETHING_ELSE")).toBe(false);
    expect(isNeedCategory("")).toBe(false);
    expect(isNeedCategory(null)).toBe(false);
    expect(isNeedCategory(undefined)).toBe(false);
    expect(isNeedCategory(42)).toBe(false);
  });
});

describe("routeForCategory", () => {
  it("marks CLINICAL as the only clinical category, routed to the existing triage pathway", () => {
    const routing = routeForCategory("CLINICAL");
    expect(routing.clinical).toBe(true);
    expect(routing.workflow).toMatch(/triage/i);
  });

  it("routes every non-clinical category as non-clinical", () => {
    for (const c of ["LOGISTICAL", "EMOTIONAL", "FINANCIAL", "ROUTINE", "UNCERTAIN"] as const) {
      expect(routeForCategory(c).clinical).toBe(false);
    }
  });

  it("gives every category a distinct, non-empty label and workflow", () => {
    const seen = new Set<string>();
    for (const c of NEED_CATEGORIES) {
      const r = routeForCategory(c);
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.workflow.length).toBeGreaterThan(0);
      expect(seen.has(r.label)).toBe(false);
      seen.add(r.label);
    }
  });
});
