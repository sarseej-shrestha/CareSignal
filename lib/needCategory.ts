// Need classification — the deterministic routing layer that sits AFTER
// LLM interpretation (lib/ai.ts). The LLM identifies what kind of need a
// freeform message represents; this module owns what happens next. Routing
// is intentionally plain code, not another AI decision, so it's testable
// and explainable — the LLM never chooses where something goes, only what
// it is.

export const NEED_CATEGORIES = ["CLINICAL", "LOGISTICAL", "EMOTIONAL", "FINANCIAL", "ROUTINE", "UNCERTAIN"] as const;
export type NeedCategory = (typeof NEED_CATEGORIES)[number];

export function isNeedCategory(value: unknown): value is NeedCategory {
  return typeof value === "string" && (NEED_CATEGORIES as readonly string[]).includes(value);
}

export interface NeedRouting {
  label: string;
  workflow: string;
  clinical: boolean;
}

// One deterministic mapping, not a multi-label system — a message with
// more than one apparent need still gets exactly one primary category
// from the LLM (see hasAdditionalNeeds in lib/ai.ts's schemas), and that
// category alone decides where it's routed. CLINICAL keeps going through
// the existing risk-engine pathway untouched; everything else is new
// routing surface for the non-clinical queue (see components/ui and the
// dashboard change that consumes this).
const ROUTING: Record<NeedCategory, NeedRouting> = {
  CLINICAL: { label: "Clinical", workflow: "Clinical risk pathway (existing triage queue)", clinical: true },
  LOGISTICAL: { label: "Logistical", workflow: "Navigation / SDOH follow-up", clinical: false },
  EMOTIONAL: { label: "Emotional support", workflow: "Human review — supportive care", clinical: false },
  FINANCIAL: { label: "Financial", workflow: "Financial/resource support follow-up", clinical: false },
  ROUTINE: { label: "Routine", workflow: "Acknowledged, no action required", clinical: false },
  UNCERTAIN: { label: "Uncertain", workflow: "Human review — needs clarification", clinical: false },
};

export function routeForCategory(category: NeedCategory): NeedRouting {
  return ROUTING[category];
}
