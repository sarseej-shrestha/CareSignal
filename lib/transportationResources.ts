// Real, individually researched transportation resources for the two
// parishes CareSignal serves — Terrebonne and Lafourche. Every phone
// number, eligibility rule, cost, and scheduling window below was checked
// against that organization's own website in August 2026, not guessed or
// generalized from "rural Louisiana" boilerplate:
//   - Terrebonne Council on Aging transportation page (terrebonnecoa.org)
//   - Lafourche Council on Aging services page (lafourchecoa.org)
//   - American Cancer Society's Road To Recovery program page (cancer.org)
// Louisiana Medicaid does cover non-emergency medical transportation (NEMT)
// for enrolled members, but which broker administers it has changed more
// than once recently (a 2024 bid-protest reshuffle among providers) — naming
// a specific vendor here risked being wrong by the time this is read, so
// that entry points to the Medicaid ID card / care coordinator instead of a
// named company.
//
// Trigger logic: the suggestion only surfaces for patients on a frequent
// treatment schedule (weekly or every-2-weeks dosing, both real standard
// intervals for common regimens — e.g. FOLFOX/FOLFIRINOX every 2 weeks,
// weekly bortezomib). That's when transportation becomes a REPEATED
// barrier, not a one-off. A patient on an every-3-weeks or monthly regimen
// faces the same trip far less often; auto-surfacing a suggestion for a
// low-frequency case risks the same alert-fatigue failure mode the
// consolidation work in lib/alertConsolidation.ts exists to prevent. This
// is a suggestion tool, not a gate — a nurse who knows a specific patient
// struggles with transportation regardless of frequency can always mention
// these resources by hand; the trigger only decides when to volunteer it
// automatically.

export type TreatmentFrequency = "weekly" | "every_2_weeks" | "every_3_weeks" | "monthly";

const FREQUENT_ENOUGH_TO_SURFACE: ReadonlySet<TreatmentFrequency> = new Set(["weekly", "every_2_weeks"]);

export interface TransportationResource {
  name: string;
  phone: string;
  detail: string;
}

export interface TransportationSuggestion {
  reason: string;
  resources: TransportationResource[];
}

const PARISH_RESOURCES: Record<string, TransportationResource> = {
  Terrebonne: {
    name: "Terrebonne Council on Aging — Transportation",
    phone: "(985) 868-7701",
    detail:
      "Curbside rides to medical appointments (also pharmacy/grocery) for residents 60+ (an escort is required if the patient can't travel independently); suggested $1 donation per trip. Best booked 3+ days ahead — same-day requests are sometimes possible if made by noon the day before, but not guaranteed.",
  },
  Lafourche: {
    name: "Lafourche Council on Aging — Transportation",
    phone: "(985) 532-0457",
    detail:
      "$1 one-way / $2 round-trip for residents 60+ or disabled (full fare — $18 in-town, $20 out-of-town — for others); requires 24 hours' notice. Service area covers Lafourche Parish and surrounding areas, including Terrebonne.",
  },
};

// Not parish-specific — worth surfacing alongside whichever local resource
// applies, since eligibility differs (age/disability vs. diagnosis).
const UNIVERSAL_RESOURCES: TransportationResource[] = [
  {
    name: "American Cancer Society — Road To Recovery",
    phone: "1-800-227-2345",
    detail:
      "Free volunteer-driver rides specifically for cancer-related medical appointments — no age requirement. Call as far ahead as possible; coordination typically takes several business days, and availability depends on local volunteer driver supply.",
  },
  {
    name: "Louisiana Medicaid — non-emergency medical transportation (NEMT)",
    phone: "see Medicaid ID card",
    detail:
      "A covered benefit for enrolled members getting to covered appointments. Which transportation broker administers it has changed recently, so call the number on the patient's Medicaid ID card or ask their care coordinator rather than a specific company name.",
  },
  {
    name: "Louisiana 211",
    phone: "211",
    detail: "Statewide referral line for transportation, financial, and other support services — a fallback for patients who don't fit the above eligibility rules.",
  },
];

export function getTransportationSuggestion(params: {
  parish: string;
  treatmentFrequency: TreatmentFrequency;
}): TransportationSuggestion | null {
  if (!FREQUENT_ENOUGH_TO_SURFACE.has(params.treatmentFrequency)) return null;

  const parishResource = PARISH_RESOURCES[params.parish];
  if (!parishResource) return null;

  const frequencyLabel = params.treatmentFrequency === "weekly" ? "about weekly" : "about every 2 weeks";
  return {
    reason: `This patient's treatment schedule brings them in ${frequencyLabel}, which makes transportation a recurring barrier rather than a one-off — worth raising proactively.`,
    resources: [parishResource, ...UNIVERSAL_RESOURCES],
  };
}
