import { Bus } from "lucide-react";
import { getTransportationSuggestion, type TreatmentFrequency } from "@/lib/transportationResources";

// A triggered SUGGESTION, not a booking flow — no scheduling, no form, just
// pointers to real, individually verified local resources (see
// lib/transportationResources.ts for what was actually checked and where).
// Renders nothing unless the patient's treatment frequency makes
// transportation a RECURRING barrier — see that file's trigger-logic note.
// A parish match alone is no longer enough to surface this.
export function SdohActionCard({
  parish,
  treatmentFrequency,
}: {
  parish: string;
  treatmentFrequency: TreatmentFrequency;
}) {
  const suggestion = getTransportationSuggestion({ parish, treatmentFrequency });
  if (!suggestion) return null;

  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <Bus className="size-4" />
        Suggested resource: transportation assistance
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{suggestion.reason}</p>
      <ul className="space-y-2">
        {suggestion.resources.map((r) => (
          <li key={r.name} className="text-xs text-muted-foreground">
            <div>
              <strong className="text-foreground">{r.name}</strong> — {r.phone}
            </div>
            {r.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
