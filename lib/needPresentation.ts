// Presentation-only unification of the three separate alert shapes the
// backend already produces (clinical YELLOW/RED, CAREGIVER_BURDEN,
// LOGISTICAL/EMOTIONAL/FINANCIAL/UNCERTAIN/SAFETY care needs). The backend
// data model stays exactly as it is (three separate, independently-scored
// signals, on purpose — see lib/needCategory.ts, lib/risk.ts) — this only
// gives the UI one consistent shape to render them in, so a clinician sees
// one "active needs" list instead of three differently-styled boxes.

export type NeedKind = "RED" | "YELLOW" | "CAREGIVER_BURDEN" | "LOGISTICAL" | "EMOTIONAL" | "FINANCIAL" | "UNCERTAIN" | "SAFETY";

export interface UnifiedNeed {
  id: string;
  kind: NeedKind;
  reasons: string[];
  status: string;
  dateLabel?: string;
  quote?: string | null;
}

// Lower number = higher on the list. Mirrors the same clinical-safety-first
// ordering already used elsewhere (rules floor never outranked by a
// softer signal) — SAFETY and RED lead, routine/uncertain trail.
const URGENCY_RANK: Record<NeedKind, number> = {
  SAFETY: 0,
  RED: 1,
  YELLOW: 2,
  CAREGIVER_BURDEN: 3,
  LOGISTICAL: 4,
  FINANCIAL: 5,
  EMOTIONAL: 6,
  UNCERTAIN: 7,
};

export function sortNeeds(needs: UnifiedNeed[]): UnifiedNeed[] {
  return [...needs].sort((a, b) => {
    // Resolved work sinks to the bottom regardless of kind, so the visible
    // "active" list stays short.
    const aResolved = a.status === "RESOLVED" ? 1 : 0;
    const bResolved = b.status === "RESOLVED" ? 1 : 0;
    if (aResolved !== bResolved) return aResolved - bResolved;
    return URGENCY_RANK[a.kind] - URGENCY_RANK[b.kind];
  });
}

export const NEED_KIND_LABEL: Record<NeedKind, string> = {
  SAFETY: "Safety check needed",
  RED: "High risk",
  YELLOW: "Elevated risk",
  CAREGIVER_BURDEN: "Caregiver burden",
  LOGISTICAL: "Logistical need",
  EMOTIONAL: "Emotional support",
  FINANCIAL: "Financial need",
  UNCERTAIN: "Needs clarification",
};

// Left-edge accent color per kind, reusing the app's existing --viz-*
// tokens (no new colors introduced).
export const NEED_KIND_ACCENT: Record<NeedKind, string> = {
  SAFETY: "var(--viz-status-critical)",
  RED: "var(--viz-status-critical)",
  YELLOW: "var(--viz-status-warning)",
  CAREGIVER_BURDEN: "var(--viz-caregiver-burden)",
  LOGISTICAL: "var(--viz-series-fatigue)",
  FINANCIAL: "var(--viz-series-nausea)",
  EMOTIONAL: "var(--viz-caregiver-burden)",
  UNCERTAIN: "var(--viz-muted)",
};
