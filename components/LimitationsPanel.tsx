"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";

// Visible on the dashboard by default, not buried behind a settings menu
// or a separate route — a judge (or a real clinician) shouldn't have to
// go looking for what this tool doesn't claim to be. Collapsible only to
// avoid it competing for space with the triage queue on repeat visits;
// starts open. Kept deliberately short — five plain-language bullets, not
// a legal disclaimer wall — see docs/pitch-notes.md for the longer,
// spoken version of each of these points.
const LIMITATIONS = [
  "Not clinically validated against real patient outcomes.",
  "Not a diagnostic tool. Flags patterns for clinical review, does not determine diagnosis or treatment.",
  "Not a replacement for a clinician's judgment.",
  "Built and trained on simulated data, calibrated to published research patterns.",
  "Requires clinical workflow integration before any real deployment.",
];

export function LimitationsPanel() {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border border-dashed p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ShieldAlert className="size-3.5" />
          What CareSignal does not claim
        </span>
        {open ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {LIMITATIONS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
