# Known behaviors

Things that are correct, intentional, and verified — but non-obvious enough
from the UI or a casual read of the code that a fresh look could easily
mistake them for bugs. Found during the final robustness pass's full manual
walkthrough (fresh reseed, every dashboard feature and SMS interaction type
exercised live) and the accompanying code audit. If you hit something here
expecting different behavior, this is the place to check before assuming
it's broken.

## Caregiver burden decay is time-based, not status-based

`caregiverBurdenFlag7d` (the hospitalization model's caregiver-burden
feature) is `1` whenever a `CAREGIVER_BURDEN` `RiskAlert` was **created**
in the trailing 7 days — it does not check whether that alert is still
`OPEN`. Two consequences that can look wrong at a glance but aren't:

- A `RESOLVED` burden alert from 3 days ago still counts toward the flag.
- An `OPEN` burden alert from 9 days ago does **not** count, even though
  it's still sitting in the dashboard's alert list as open.

Verified live: seeded a caregiver's burden alert, confirmed
`caregiverBurdenFlag7d=1` and a hospitalization score of 51.7% (Ruth
Trahan's case), then backdated the alert past 7 days and re-computed —
`caregiverBurdenFlag7d` correctly dropped to `0` and the score correctly
fell to 44.1%. This is the model's intended "recency window" design (see
`lib/hospitalizationFeatures.ts`), not a bug — but it means "is this
caregiver's burden still affecting the hospitalization forecast" is a
different question from "is there still an open burden alert," and the UI
doesn't currently distinguish them.

## A brand-new patient's hospitalization score isn't zero

A patient with zero symptom-log history still gets a real, non-trivial
hospitalization-risk percentage (roughly 20-30% in practice) — this is the
trained model's learned intercept for an all-zero feature vector, not a
placeholder or an error. As of this pass, the dashboard shows an explicit
amber "Limited data — no check-ins in the past 7 days" caveat under the
percentage whenever this is the case (`hasRecentHistory: false` from
`computeHospitalizationRisk()`), so it reads as a population baseline
rather than a personalized estimate. If you see that caveat, the number
above it is real but not yet informed by this specific patient's data.

## The dashboard is always live; some exports read a cached column

`app/dashboard/page.tsx` recomputes `hospitalizationRiskScore` fresh via
`computeHospitalizationRisk()` on every server render, for every patient —
it never reads `Patient.hospitalizationRiskScore` from the database. That
stored column exists as a cache, written by `recordSymptomLog` /
`recordCaregiverLog` (`lib/inbound.ts`) after every check-in, and is read
directly by `lib/fhirExport.ts` and the SOAP note generator
(`app/api/ai/soap-note/route.ts`). Practically: the dashboard can never
show a stale hospitalization score, no matter what bug might exist in the
write path — but a FHIR export or SOAP note generated for a patient could,
if the two writer functions above ever miss a code path (this happened
once — see the caregiver-recovery recompute bug fixed earlier in this
session — and is now covered by a regression test,
`tests/integration/hospitalizationRecompute.test.ts`).

## FHIR export warning counts vary by patient — 111 isn't a universal number

`docs/fhir-validation-results.md` and earlier pitch material cite "111
remaining warnings" for the FHIR export — that figure is specific to Ruth
Trahan's bundle (the most data-rich seeded patient) and scales with entry
count, not a fixed property of the exporter. Re-validated live against two
other patients during this pass: Sofía Reyes (28 entries) came back with 95
warnings, James Chauvin (27 entries) with 93, and a synthetic zero-history
patient (3 entries) with 3. All three: **zero errors**, same four warning
categories as Ruth's bundle (dom-6 narrative, CodeSystem-unknown,
observation-performer, UCUM annotation) — conformance holds generally, the
warning *count* just isn't a single fixed number across patients.

## DEMO_MODE scenario triggers reset their target patient first

Re-triggering a demo scenario (`naquin-fever`, `guidry-divergence`,
`trahan-burden`) always wipes that specific patient's (and, for
`trahan-burden`, their caregiver's) log/alert history back to the seed
fixture's pre-final-check-in state before replaying — this is intentional
and documented in `lib/demoScenarios.ts` (idempotent, safe to re-trigger
during rehearsal). The side effect worth knowing: any live SMS testing done
against that same seeded patient's phone number in between demo triggers
gets silently wiped the next time the scenario fires. If you're doing a
mixed live-SMS-plus-demo-buttons rehearsal, use a seeded patient you're
*not* also demo-triggering to avoid confusing "did my test message not
save" with "the demo trigger reset it."

## Structured vs. freeform parsing is a hard split on message shape

A message is only ever treated as "structured" if it matches the exact
`pain,nausea,fatigue,fever` (patient) or `patientStatus,copingScore`
(caregiver) comma-separated numeric shape, with every value in a plausible
human range — everything else, including a structured-looking message with
one out-of-range number (e.g. `99,99,99,999`), falls through to freeform AI
parsing rather than being rejected outright. This is intentional (see
`lib/inbound.ts`'s range-check comment) and already covered by tests, but
worth knowing if a demo message looks like it "should" have parsed as
structured and didn't — check whether every one of its four/two numbers is
actually in range first.
