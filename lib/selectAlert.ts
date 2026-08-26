// Semifinal red-team fix: app/dashboard/page.tsx used to pick "the" clinical
// / caregiver-burden alert for a patient with a plain `.find()` over
// `alerts` ordered newest-first — which returns the single newest matching
// alert REGARDLESS of status. A RESOLVED alert created after an older,
// still-OPEN one of the same category would silently take its place, making
// the older, still-actionable alert invisible everywhere in the dashboard
// (it's never even sent to the client). Pulled out as its own small, pure,
// directly-testable function rather than fixed inline, since this exact kind
// of off-by-one-in-priority bug is easy to reintroduce silently otherwise.
//
// Deliberately narrow scope: prefers the newest NON-resolved match, falling
// back to the newest regardless of status only when nothing is open (so a
// fully-resolved patient's last alert still renders, in the resolved
// section — DashboardClient.tsx already splits active vs. resolved
// correctly). Does NOT attempt to surface multiple simultaneously-open
// alerts of different severity for the same category (e.g. an unresolved
// RED from days ago alongside a newer OPEN YELLOW) — that would need this
// field to become an array, like careNeedAlerts in page.tsx already is, a
// real data-shape change deliberately deferred rather than rushed.
export interface SelectableAlert {
  level: string;
  status: string;
  createdAt: Date | string;
}

export function selectAlert<T extends SelectableAlert>(alerts: T[], matchesLevel: (level: string) => boolean): T | null {
  const matching = alerts.filter((a) => matchesLevel(a.level));
  const open = matching.find((a) => a.status !== "RESOLVED");
  return open ?? matching[0] ?? null;
}
