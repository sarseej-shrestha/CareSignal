# Pitch notes

Glanceable talking points — read right before going on, not during. Full rationale is in `docs/model-calibration.md` if a judge wants depth.

## Core framing: "not novel, but accessible"

- Daily symptom monitoring + nurse triage is a **validated intervention pattern** from published oncology research. We are not claiming to have invented remote symptom monitoring.
- The innovation is **who it reaches**: SMS-only, no app to install, no login, no data plan required. Built for the patients the original studies' apps and portals couldn't reach — rural, older, lower-bandwidth, lower-income.
- One sentence version: *"This is a proven intervention, rebuilt to actually reach the patients who need it most."*

## Why lead with caregiver burden

- Every other symptom-monitoring tool on the market monitors the **patient only**.
- Caregiver burnout is not a soft/nice-to-have metric — it's itself a **predictor of bad patient outcomes** (missed doses, delayed care-seeking, caregiver health collapse taking the support system down with it).
- The challenge brief explicitly names caregivers as a population the solution should serve — this isn't a bolted-on feature, it's a first-class second data source with its own alert type (`CAREGIVER_BURDEN`), shown separately from clinical risk on the dashboard, never folded in.
- Lead the demo with this. It's the differentiator; the symptom tracker alone is not.

## The two-layer risk engine — the proof it's real ML

- Layer 1 (rules) is the interpretable, safety-critical floor: fever ≥100.4°F, severe symptoms, 3-day trend escalation. Auditable, explainable, no black box for the hard stops.
- Layer 2 is a **trained classifier** (logistic regression, trained on 25,200 simulated patient-days, 0.78 recall / 0.68 precision held-out) — not a second set of if/else thresholds wearing an AI label.
- **Concrete demo proof it does real work:** Denise Guidry. Rules alone say YELLOW (a trend-based flag, nothing hits a hard threshold). The trained model looks at the same data and pushes it to RED (p=0.96) — a call the rules layer alone wouldn't have made. That's the model adding signal, live, in front of the judges — not decoration.

## Why Terrebonne/Lafourche specifically (not generic "rural Louisiana")

- Naming the actual parishes signals this was designed against a real geography, not a generic pitch-deck stand-in for "underserved."
- These parishes have real, well-documented healthcare access gaps (distance to Ochsner facilities, broadband/cell coverage variability, transportation burden) that a generic "rural" framing glosses over.
- It also grounds the SMS-first design decision in something concrete: this isn't "SMS because it's simple," it's "SMS because roundtrip to a smartphone app assumes bandwidth and hardware Terrebonne/Lafourche patients may not reliably have."

## Ready answers for hard questions

**"How is this different from other symptom trackers?"**
> Caregiver channel as a first-class signal, SMS-only accessibility with no app or login, and trend-based flagging (a climbing pattern over days) instead of single-reading thresholds.

**"How do you know this works?"**
> It's built on a validated intervention pattern from published research, calibrated to match those studies' real-world escalation base rates, and we've scoped an explicit pilot-validation path against retrospective Ochsner data before any real deployment — we're not claiming clinical validation today, we're claiming a defensible, honest starting point.

## Live demo (Twilio) — setup steps, requires action outside this repo

Live inbound SMS is the primary demo path, but it needs a real Twilio account — this can't be set up from inside the codebase, since it requires signing up and verifying a phone number through Twilio's own console. Steps:

1. **Create a Twilio account** at twilio.com (a free trial account works — it comes with trial credit and one auto-assigned Twilio phone number).
2. **Verify the phone number(s) you'll text FROM during the demo** as caller IDs: Twilio Console → Phone Numbers → Manage → Verified Caller IDs → add your (or a demo phone's) real number, then confirm via the code Twilio texts/calls to it. **A trial account can only exchange SMS with verified numbers** — texting from an unverified phone gets silently ignored by Twilio, not an error CareSignal would ever see.
3. **Point the Twilio number's webhook at this app**: Twilio Console → Phone Numbers → your number → Messaging → "A message comes in" → set to `https://<your-deployed-or-tunneled-url>/api/twilio/inbound`, HTTP POST. Running locally, this needs a public tunnel (e.g. `ngrok http 3000`) since Twilio can't reach `localhost`.
4. **Set the three Twilio env vars** in `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (both from the Twilio Console dashboard), `TWILIO_PHONE_NUMBER` (the number from step 1, E.164 format). Leaving `TWILIO_AUTH_TOKEN` unset makes the webhook skip signature validation (fine for local dev, not for anything public-facing — see the comment in `app/api/twilio/inbound/route.ts`).
5. **Swap a seeded patient's fake phone number for your real verified one** — the seeded numbers (`+19855550142` etc.) are fake and Twilio will never see traffic to/from them. Run:
   ```
   npx tsx scripts/set-live-demo-number.ts <mrn> <yourVerifiedPhoneE164> [caregiverPhoneE164]
   ```
   e.g. `npx tsx scripts/set-live-demo-number.ts OCH-70143 +19855551234` — see the script for the full patient MRN list. Text `pain,nausea,fatigue,fever` (e.g. `3,2,4,99.1`) or a freeform sentence to the Twilio number from that verified phone to confirm the round trip.

**Verified phone numbers actually used for the live demo should be recorded here once step 5 is done, so the pitch team knows which number(s) to text from** — replace this line with the real MRN → verified-phone mapping once set up (do not commit real personal phone numbers to a public repo; use this line as a private note or a placeholder like "ask [team member] for the demo phone").

## Demo fallback mode (break glass only)

Live SMS through Twilio + Groq is the primary demo path — use it. This is only for if venue wifi dies, the Twilio trial account hits a limit, or Groq is slow/down mid-pitch. It reproduces the exact same dashboard end state a live SMS would have produced (same risk engine, same alert pathway) with zero external dependency.

**Where:** a "Demo fallback (DEMO_MODE)" panel sits right below the header on `/dashboard`, with one button per scenario — but only if `.env` has `DEMO_MODE="true"` (it does by default for the hackathon build). Click a button, it triggers in ~1 second, dashboard updates automatically.

**If the dashboard panel isn't visible or the browser is having its own issues**, run it from a terminal instead:
```
cd ~/CareSignal
npx tsx scripts/demo-trigger.ts naquin-fever        # fever escalation → RED
npx tsx scripts/demo-trigger.ts guidry-divergence   # rules=YELLOW, model=RED
npx tsx scripts/demo-trigger.ts trahan-burden       # caregiver burden flag
```
Then just refresh the dashboard tab.

**Safe to re-trigger** — each one resets its patient first, so clicking twice doesn't double up or break anything. Good to run once before you go on, just to confirm it's warm.

## Multi-language support (French and Spanish)

- `Patient.preferredLanguage` / `Caregiver.preferredLanguage` (`"en"`, `"fr"`, or `"es"`) drive outbound SMS — every reply the webhook sends is looked up from `lib/i18n.ts`'s trilingual catalog in the sender's own language, not the patient's by default (a caregiver gets replies in *their* preferred language, independent of the patient's).
- **Spanish was added deliberately, not just for parity with French** — Louisiana's largest non-English-speaking population is Spanish-speaking, not French-speaking, so this is the higher-reach language addition, and it got the same depth: outbound replies, inbound freeform parsing, and a seeded demo patient (Sofía Reyes, Terrebonne Parish, `preferredLanguage: "es"`).
- Inbound freeform parsing handles French and Spanish input directly — no separate pipeline per language, the same `lib/ai.ts` prompts just tell the model the message may be in any of the three and to keep field extraction language-agnostic. **Verified live against the real model for both languages**, not assumed: correct symptom extraction, correct caregiver-burden classification, and — unprompted, in both languages — correct Celsius-to-Fahrenheit conversion (French: 39°C → 102.2°F; Spanish: 39.5°C → 103.1°F) without being told to handle unit conversion. That's a genuinely useful, non-obvious capability worth mentioning if asked "does it handle French/Spanish" — it handles more than the language.
- SOAP notes are unaffected by patient language by design — they're generated from structured data (scores, alert reasons), not raw SMS text, and always written in English for the clinical team. Worth having ready if asked "what about the SOAP note for a Spanish-speaking patient": "Same note, same language — it's built from the structured symptom data, not the original text, so there's nothing language-specific to handle there."

Both languages are *standard* French and *standard* Spanish, not any regional dialect (not Louisiana Cajun French; not any specific Spanish-speaking region's variant) — verifying dialect-accurate phrasing was out of scope. Say this proactively if asked, rather than waiting to be caught: "We verified standard French and Spanish work, including some things we didn't even prompt for like Celsius conversion. We didn't attempt to verify dialect-specific authenticity for either language — that would need review from a native speaker of the relevant variant before we'd claim it."

## Hospitalization-risk model — the second AI model, not a rebrand of the first

- Directly answers the brief's own language about identifying patients "at risk for... hospitalization" — a distinct model, distinct time horizon (7-day forecast vs. today's status), never merged into the RED/YELLOW/GREEN badge.
- **Concrete proof it's doing something real, not decoration:** in the seeded data, Ruth Trahan — the caregiver-burden headline case — has the *highest* hospitalization-risk score of all six patients (52%), higher than either of the two daily-RED patients. That's not scripted for the demo; it's the trained model's actual output, driven by her caregiver's burden alert — and it held up after the hospitalization model was retrained on a fully independent data simulator (different code, different randomization, no shared assumptions with the daily model) specifically to make sure this wasn't a coincidence of the two models sharing the same underlying assumptions. See `docs/model-calibration.md`'s "Addressing training-data circularity" section for the full story, including what changed (recall got honestly weaker) when the shared assumptions were removed. If the caregiver-burden story is your opening hook, this is the callback: "and it shows up again here, in a completely separate — and independently validated — model, because we built the feature set to let it."
- One-line answer if asked "isn't this just the same model twice": "No — different features entirely. The daily model looks at today plus a 3-day trend. This one looks at a rolling 7-day window: cumulative alerts, fever recurrence, sustained trend severity, and caregiver burden history. It's trained separately, calibrated to a lower base rate because hospitalization is rarer than a daily escalation, and stored in its own field."

## SOAP notes, SDOH card, FHIR export — quick hits if asked

- **SOAP note generator:** one click in the patient panel turns recent check-ins + active alert reasons into a Subjective/Objective/Assessment/Plan note, copy-pasteable into an EHR. Verified live output uses real PRO-CTCAE grading language and cites the neutropenic fever threshold correctly; the Plan section is explicitly generated as suggestions ("consider," "recommend"), never directives — a nurse still decides. For a stable patient it correctly says so instead of inventing concern — worth demoing if a judge asks "does it just always sound alarming."

## SOAP note safety architecture — the near-certain "how do you handle LLM-written clinical content" question

Every generated note is its own persisted database record (`SoapNote`, not a field bolted onto something else) that **starts `DRAFT` and can only become `REVIEWED` through one explicit endpoint** (`app/api/ai/soap-note/[id]/review`) — there is no code path anywhere that creates a note already marked reviewed. This isn't just a UI disclaimer line:

- **A visible, structural draft state, not a footnote:** the dashboard shows an amber "AI-GENERATED DRAFT — REQUIRES CLINICIAN REVIEW" banner with an explicit "Mark reviewed" action for every unreviewed note; once reviewed, that flips to a distinct green "Reviewed [timestamp]" state. The status is a real database field, so it survives a page reload — it's not just React state that resets.
- **The draft/reviewed status travels with the text, not just the screen:** the "Copy" button never copies the raw note — it always runs through `lib/soapNoteFormat.ts`, which prepends the current status as a header (`[AI-GENERATED DRAFT...]` or `[Reviewed by clinician at <time>]`) computed fresh at copy-time, not baked in when the note was generated. Paste it into an EHR before reviewing it, and the disclaimer pastes with it.
- **A deterministic confidence signal, not the model grading itself:** `lib/soapNoteConfidence.ts` flags a note `LIMITED` confidence (with the specific reason shown) when it's built from fewer than 3 check-ins, or when half or more of the underlying check-ins came from freeform-text AI parsing rather than structured numeric replies — both computed in plain code from real data, not asked of the LLM. Verified live against the real model: a single-check-in patient correctly comes back `LIMITED` ("Based on only 1 check-in — limited history to establish a trend"), a 7-check-in structured-data patient correctly comes back `HIGH`.

One-line answer if asked directly: "Every note is a draft by default, at the database level, not just in the UI — and the review status travels with the text wherever it's copied. The model doesn't get to say how confident it is; we compute that separately from how much real data it had to work with."
- **SDOH transportation card:** a triggered suggestion (not a booking flow) pointing to real, individually researched local resources — Terrebonne Council on Aging, Lafourche Council on Aging, American Cancer Society Road To Recovery, Louisiana Medicaid NEMT, and LA 211 — each with a phone number, real eligibility rule, cost, and scheduling window checked against that organization's own site, not generic copy. It only surfaces for patients on a frequent treatment schedule (weekly or every-2-weeks dosing) — transportation is a recurring barrier at that cadence, not a one-off, so a parish match alone no longer triggers it; an every-3-weeks patient doesn't get the suggestion auto-surfaced (see `lib/transportationResources.ts`). This is about removing the "how do I even get to the clinic" barrier the brief calls out, not building a scheduling product in a hackathon.
- **FHIR-lite export:** downloads a patient's data as FHIR-shaped resources (Patient, Condition, Observation, RiskAssessment, Flag). If asked "is this really FHIR": "It uses real FHIR resource types and real, individually verified LOINC codes where a matching one exists — we checked, we didn't guess. Where no matching code exists (there's no standard 0-10 nausea-severity LOINC code), we say so explicitly and use a local code instead of making one up. And we didn't just assume it's valid — we ran it through HL7's own reference validator (the public HAPI FHIR server) four times as we found and fixed real structural bugs (missing fullUrls, bad reference formats, an invalid Bundle.total field). The current version comes back with zero errors — genuinely FHIR-conformant, not just FHIR-shaped — with 111 remaining warnings, all cosmetic best-practice recommendations (missing narrative text, missing performer, our local nausea code being unregistered) rather than validity blockers. Full round-by-round results are in `docs/fhir-validation-results.md`. It's not a certified EHR integration — that's a separate formal process — but it's real, verified conformance, not a guess."

## Nurse workload — "have you thought about alert volume"

This is real pitch material, not an afterthought — most monitoring-tool pitches get asked "won't this just flood the nurse with alerts" and don't have a computed answer ready.

- Daily clinical risk and 7-day hospitalization risk are now consolidated into **one notification per patient** (`lib/alertConsolidation.ts`), not two separate queue items — the dashboard queue shows a "+ 7-day risk" tag on a patient's existing row when both signals are elevated, instead of a second row.
- **Computed, not guessed:** for a 75-patient panel (middle of a realistic 50-100 range), a nurse reviews an estimated **~20 consolidated notifications per day**, about a quarter of which are the higher-priority dual-signal case. That's a real ~20% reduction versus treating the two signals separately (25.6 → 20.4 items/day at that panel size). Full numbers and method in `docs/alert-volume-analysis.md`.
- **Found and fixed a real calibration mistake while building this**, worth mentioning if asked how confident to be in the number: the hospitalization-alert threshold was first set by eyeballing the seeded demo patients' scores (0.35 looked reasonable against those 7). Checked against the full simulated population instead, and that threshold fired on ~60% of all patient-days — useless as an "elevated" signal. Fixed by pinning it to the model's own trained decision boundary instead of a hand-picked number. Say this if asked "how do you know your alert threshold is right": "We checked it against more than the demo data, and the first number we picked was wrong by a lot — worth knowing before deployment, not after."

## If asked about testing / robustness

- 93 automated tests (Vitest) — unit tests for every risk-engine rule boundary, both trained models, the AI parsing (mocked), and integration tests hitting the actual webhook logic against a real test database.
- A load test found a real concurrency bug (a stale risk-status write under rapid same-patient check-ins) — fixed it, then found that the "obvious" fix (wrapping the write in a database transaction) made things *measurably worse* under load (SQLite-specific), and reverted it with the reasoning documented in `docs/load-test-results.md`. That's a good story if asked "how do you know this holds up" — the honest answer includes a fix we tried and un-did, not just a list of things that passed.
