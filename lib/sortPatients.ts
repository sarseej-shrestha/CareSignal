// Pulled out of app/dashboard/DashboardClient.tsx so the triage queue's
// priority ordering is unit-testable without rendering React (see
// tests/unit/sortPatients.test.ts).

export interface RiskSortable {
  riskStatus: "GREEN" | "YELLOW" | "RED";
  riskScore: number;
}

const RISK_ORDER = { RED: 0, YELLOW: 1, GREEN: 2 } as const;

/**
 * Prioritized triage order: RED before YELLOW before GREEN; within the same
 * bucket, higher model probability first. Does not mutate the input array.
 */
export function sortByRiskPriority<T extends RiskSortable>(patients: T[]): T[] {
  return [...patients].sort((a, b) => {
    const rankDiff = RISK_ORDER[a.riskStatus] - RISK_ORDER[b.riskStatus];
    if (rankDiff !== 0) return rankDiff;
    return b.riskScore - a.riskScore;
  });
}
