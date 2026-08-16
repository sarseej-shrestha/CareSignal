import { Bus } from "lucide-react";

// A triggered SUGGESTION, not a booking flow — no scheduling, no form, just
// a pointer to the right kind of resource, tied to the patient's actual
// parish (not generic "rural Louisiana" copy). Only mentions Louisiana 211
// by name since that's a real, verifiable statewide referral line; anything
// more specific (an org's phone number, hours, eligibility rules) would be
// unverified detail this project shouldn't present as fact.
const PARISH_NOTE: Record<string, string> = {
  Terrebonne: "Terrebonne Parish has a Council on Aging that provides medical transportation for eligible residents.",
  Lafourche: "Lafourche Parish has a Council on Aging that provides medical transportation for eligible residents.",
};

export function SdohActionCard({ parish }: { parish: string }) {
  const note = PARISH_NOTE[parish];

  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <Bus className="size-4" />
        Suggested resource: transportation assistance
      </div>
      <p className="text-xs text-muted-foreground">
        {note ? `${note} ` : ""}
        For {parish} Parish medical transportation options, contact{" "}
        <strong className="text-foreground">211 (Louisiana 211)</strong> — a statewide referral line for
        transportation, financial, and other support services — or connect the patient with their care coordinator.
      </p>
    </div>
  );
}
