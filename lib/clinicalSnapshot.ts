// A single "at a glance" summary for the clinician detail panel — answers
// "what did the patient actually say, when, and how does that compare to
// their baseline" in one small block, reusing the same symptom-log data
// already fetched for the trend chart and risk engine. Deliberately not a
// new chart or a new data source: the delta math mirrors riskEngine.ts's
// own 3-day trend comparison (average of the prior two days vs today), just
// exposed here for display rather than a risk decision.

export interface SnapshotLog {
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  createdAt: Date;
  rawSmsText: string | null;
  source: string;
  parsedByAi: boolean;
}

export interface ClinicalSnapshot {
  latestDateLabel: string;
  latestRawText: string | null;
  latestSource: string;
  parsedByAi: boolean;
  // null when there isn't enough history yet (fewer than 2 prior logs) —
  // shown as "no baseline yet" rather than a misleading zero delta.
  deltas: { pain: number; nausea: number; fatigue: number; fever: number } | null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// `logs` must be chronological, oldest first, matching riskEngine.ts's own
// convention — same ordering the caller already has from the DB query.
export function computeClinicalSnapshot(
  logs: SnapshotLog[],
  formatDateLabel: (d: Date) => string
): ClinicalSnapshot | null {
  if (logs.length === 0) return null;

  const latest = logs[logs.length - 1];
  const priorTwo = logs.slice(-3, -1);

  const deltas =
    priorTwo.length > 0
      ? {
          pain: latest.pain - average(priorTwo.map((l) => l.pain)),
          nausea: latest.nausea - average(priorTwo.map((l) => l.nausea)),
          fatigue: latest.fatigue - average(priorTwo.map((l) => l.fatigue)),
          fever: latest.fever - average(priorTwo.map((l) => l.fever)),
        }
      : null;

  return {
    latestDateLabel: formatDateLabel(latest.createdAt),
    latestRawText: latest.rawSmsText,
    latestSource: latest.source,
    parsedByAi: latest.parsedByAi,
    deltas,
  };
}
