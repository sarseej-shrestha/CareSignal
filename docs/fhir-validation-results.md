# FHIR validation results

CareSignal's EHR export (`lib/fhirExport.ts`, `GET /api/ehr/export/[patientId]`)
produces a FHIR R4 `Bundle` (Patient, Condition, Observation×N, RiskAssessment×N,
Flag). This document records what happened when that bundle was actually run
through a real, independent FHIR validator — not just assumed correct.

**Validator used**: HL7's public reference server, HAPI FHIR
(`POST https://hapi.fhir.org/baseR4/Bundle/$validate`, `Content-Type: application/fhir+json`).
This is the same validation engine (`org.hl7.fhir.validation`) behind HL7's
official FHIR validator CLI, run as a hosted service — a legitimate, widely-used
independent check, not a toy.

**Test subject**: Ruth Trahan (seeded demo patient, MRN OCH-70146), chosen
because her record has the fullest combination of resource types (open
clinical alert, hospitalization risk score, 7 days of symptom logs) of any
seeded patient, exercising every code path in the export.

## Round-by-round results

| Round | Errors | Warnings | What changed before this round |
|---|---|---|---|
| 1 | 131 | 111 | Original code — no `fullUrl` on any bundle entry |
| 2 | 32 | 111 | Added `fullUrl: urn:uuid:{descriptive-id}` per entry, removed invalid `Bundle.total`, shortened an over-length resource id |
| 3 | 33 | 111 | Switched `fullUrl` to `ResourceType/id` relative-reference form |
| 4 | **0** | 111 | Switched `fullUrl` to genuine `urn:uuid:{randomUUID()}` values, independent of each resource's own descriptive `.id` |

Warning count never moved — all 111 are the same four best-practice
categories in every round (see below), unrelated to the errors being fixed.

### Round 1 — 131 errors: no fullUrl at all

The original export built `entry` as `{ resource }` with no `fullUrl` field.
Consequences, all real validator findings:

- Every `Bundle.entry` missing `fullUrl` (one error per entry).
- Every `subject.reference` (e.g. `"Patient/abc123"`) consequently unresolvable
  — the validator can't confirm a relative reference resolves to anything in
  the bundle without a `fullUrl` to resolve it against.
- `Bundle.total` was present on a `type: "collection"` bundle — invalid per
  FHIR's `bdl-1` invariant (`total` is only allowed on `searchset`/`history`
  bundles).
- The hospitalization `RiskAssessment` id, `riskassessment-hospitalization-{uuid}`,
  was 68 characters — over FHIR's 64-character resource `.id` limit.

**Fix attempt**: added `fullUrl: urn:uuid:${id}` using each resource's own
descriptive id as the "uuid" value (e.g. `urn:uuid:condition-abc123`); removed
`total`; shortened the hospitalization RiskAssessment id to `hosp-risk-{patientId}`
(46 chars).

### Round 2 — 32 errors: fullUrl present, but not a valid UUID

Down from 131, but every remaining error was a variant of "UUIDs must be
valid and lowercase" — because `urn:uuid:condition-abc123` etc. aren't
RFC 4122 UUIDs. The `urn:uuid:` scheme requires the part after the colon to
actually BE a UUID; a descriptive string prefixed onto a real UUID (or, in
this case, not even containing one) fails format validation.

**Fix attempt**: switched to `Patient/{id}`-style relative references
(`ResourceType/id`) for both `fullUrl` and every cross-reference, reasoning —
incorrectly, as round 3 showed — that this would sidestep the UUID format
requirement entirely by not using `urn:uuid:` at all.

### Round 3 — 33 errors: fullUrl must be an absolute URI

One worse than round 2 (a bundle-level aggregate message plus the per-entry
ones). Every entry now failed with: *"The fullUrl must be an absolute URL
(not 'Patient/...')"*. This is the actual FHIR rule: `Bundle.entry.fullUrl`
must be a genuine absolute URI — either a real dereferenceable URL or a
properly-formatted `urn:uuid:<UUID>`. Relative `ResourceType/id` strings are
valid for a `.reference` field (which resolves relative to the bundle) but
explicitly NOT valid for `fullUrl` itself, which is a different FHIR concept
(the entry's own absolute identity, not a pointer to something else).

**Fix**: generate a genuine `urn:uuid:${randomUUID()}` per bundle entry —
one fixed value for the Patient resource (reused everywhere else references
it, since Patient is the only cross-referenced resource in this bundle), and
an independent fresh one for every other resource (Condition, each
Observation, each RiskAssessment, the Flag), since nothing in the bundle
references those. Resource `.id` (the readable, descriptive string like
`obs-pain-{logId}`) is left untouched — `.id` and `.fullUrl` are different
fields with different rules, and conflating them is what caused rounds 2 and 3.

### Round 4 — 0 errors, 111 warnings (current, final)

Ran against the current code (`lib/fhirExport.ts` as of this commit). Zero
errors or fatal issues. 111 warnings remain, unchanged in count and category
from every prior round:

| Count | Category | Why it's not fixed |
|---|---|---|
| 33 | `dom-6`: "A resource should have narrative" | Best-practice recommendation to include human-readable HTML narrative per resource. Cosmetic — FHIR explicitly marks this as "should," not "shall." Would require generating redundant HTML summaries of data already structured elsewhere in each resource; not worth the complexity for a hackathon-scope export. |
| 29 | "CodeSystem is unknown and can't be validated" | Applies to both `http://loinc.org` (the public validator doesn't have the LOINC terminology loaded — an external-validator limitation, not our defect) and `http://caresignal.example/local-codes` (expected and correct — it's a deliberately local, unregistered code system, used specifically because no verified LOINC code exists for same-day 0-10 nausea severity; see `lib/fhirExport.ts` header). |
| 28 | "In general, all observations should have a performer" | Best-practice recommendation that Observations name who/what recorded them. Our Observations come from patient-reported SMS symptom logs — `Observation.performer` would technically be the patient themselves, which FHIR does support, but we haven't wired that in since it's not required for structural validity. |
| 21 | UCUM `{score}` human-readable-annotation caution | We use `{score}` as the UCUM unit for pain/nausea/fatigue 0-10 self-reported scores, since there's no real physical unit for a subjective severity rating. FHIR/UCUM flags curly-brace annotations because they're ignored during unit comparison/conversion — expected and correct for a unitless, non-comparable score, not a defect. |

None of these four categories are conformance blockers — they're HL7's own
"best practice" tier, distinct from validation errors. This is why round 4
correctly reads as "0 errors" rather than "0 issues."

## What this means for the claims made elsewhere in this repo

FHIR conformance, in HL7's own terms, means passing structural/invariant
validation — no errors. This bundle now does that, independently confirmed
against HL7's reference validator, not just hand-checked against the spec
text. So it's accurate to call this export **"FHIR-conformant"** (with
disclosed, non-blocking best-practice warnings) — a step up from the more
hedged "FHIR-structured" language used earlier in this project while the
`fullUrl` defects were still being fixed.

It is **not** accurate to call this "FHIR-certified" or "production EHR
integration-ready" — certification is a separate formal HL7/ONC process this
project hasn't gone through, and a real integration would need
`Observation.performer`, narrative text, and a registered code system for the
local nausea code, none of which block conformance but all of which a real
deployment would want.

## Reproducing this

```bash
# 1. Start the dev server and seed the DB (already done in normal dev flow)
npx tsx prisma/seed.ts
npx next dev

# 2. Pull a patient's bundle (Ruth Trahan's id shown here; find any patient's
#    id via `sqlite3 prisma/dev.db "SELECT id, firstName, lastName FROM Patient;"`)
curl -s "http://localhost:3000/api/ehr/export/<patientId>" -o /tmp/bundle.json

# 3. Submit it to the real HAPI FHIR validator
curl -s -X POST "https://hapi.fhir.org/baseR4/Bundle/\$validate" \
  -H "Content-Type: application/fhir+json" \
  --data-binary @/tmp/bundle.json -o /tmp/result.json

# 4. Inspect the OperationOutcome
python3 -c "
import json
d = json.load(open('/tmp/result.json'))
from collections import Counter
print(Counter(i['severity'] for i in d.get('issue', [])))
"
```
