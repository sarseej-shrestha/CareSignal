import { TrendingUp } from "lucide-react";

// Deliberately NOT a RiskBadge (GREEN/YELLOW/RED) — this is a different
// model, a different time horizon (7-day forecast vs. today), and a
// different claim (a probability, not a status bucket). Rendered as a
// magnitude (sequential blue ramp), not a status color, so it can't be
// visually confused with the daily clinical risk badge.
//
// Deliberately styled and positioned as SECONDARY within the detail panel
// (dashed border, smaller type, muted color weight — same visual language
// as the SDOH suggestion card's "this is a lower-confidence tier" cue) and
// explicitly labeled "prototype estimate." The rules-based daily clinical
// risk is the most defensible number this app produces (interpretable,
// auditable hard-stop thresholds); this 7-day forecast is a genuinely
// useful second signal (see docs/model-calibration.md's caregiver-burden
// findings) but is simulated-data-trained and not clinically validated —
// it should never visually compete with the clinical risk reasons for a
// viewer's first attention. Still fully present and functional here, just
// not first.
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
    <div className="rounded-lg border border-dashed p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TrendingUp className="size-3.5 text-[var(--viz-series-fever)]" />
          7-day hospitalization risk
          <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal">Prototype estimate</span>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-[var(--viz-series-fever)]">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--viz-series-fever)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Separate from the clinical risk above — a rolling estimate of hospitalization within the next 7 days, not a
        same-day symptom flag. Trained on simulated data, not yet clinically validated — see{" "}
        <code className="text-[11px]">docs/model-calibration.md</code>.
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
