import { TrendingUp } from "lucide-react";

// Deliberately NOT a RiskBadge (GREEN/YELLOW/RED) — this is a different
// model, a different time horizon (7-day forecast vs. today), and a
// different claim (a probability, not a status bucket). Rendered as a
// magnitude (sequential blue ramp), not a status color, so it can't be
// visually confused with the daily clinical risk badge.
export function HospitalizationRiskPanel({
  score,
  factors,
  hasRecentHistory,
}: {
  score: number;
  factors: string[];
  hasRecentHistory: boolean;
}) {
  const pct = Math.round(score * 100);

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <TrendingUp className="size-4 text-[var(--viz-series-fever)]" />
          7-day hospitalization risk forecast
        </div>
        <span className="tabular-nums text-sm font-semibold text-[var(--viz-series-fever)]">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--viz-series-fever)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Separate from today&apos;s clinical risk above — a rolling estimate of hospitalization within the next 7
        days, not a same-day symptom flag.
      </p>
      {!hasRecentHistory && (
        // Computed from real data (zero symptom logs in the trailing 7-day
        // window), not the model self-assessing — same pattern as the SOAP
        // note's LIMITED confidence signal. Without this, a brand-new
        // patient shows a bare, precise-looking percentage (the model's
        // learned intercept for an all-zero feature vector) with no visual
        // distinction from a personalized estimate built on real history.
        <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-500">
          Limited data — no check-ins in the past 7 days. This is the model&apos;s baseline for no recent history, not
          a personalized estimate yet.
        </p>
      )}
      {factors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
          {factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
