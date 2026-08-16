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

## Multi-language support (French)

- `Patient.preferredLanguage` / `Caregiver.preferredLanguage` (`"en"` or `"fr"`) drive outbound SMS — every reply the webhook sends (check-in acknowledgments, clarifying questions, error messages) is looked up from `lib/i18n.ts`'s bilingual catalog in the sender's own language, not the patient's by default (a caregiver gets replies in *their* preferred language, independent of the patient's).
- Inbound freeform parsing handles French input directly — no separate French pipeline, the same `lib/ai.ts` prompts just tell the model the message may be in French and to keep field extraction language-agnostic. **This was verified live against the real model**, not assumed: correctly extracted symptom scores from French text, and — unprompted — correctly converted a Celsius temperature ("39 degrés" / "39.5 degrés") to Fahrenheit (102.2°F / 103.1°F) without being told to handle unit conversion. That's a genuinely useful, non-obvious capability worth mentioning if asked "does it handle French" — it handles more than the language.
- Seeded demo patient: Émile Thibodeaux (Lafourche Parish, `preferredLanguage: "fr"`), with a real French freeform message in his check-in history, not a placeholder.

**Honest scope note — say this proactively if multi-language comes up, don't wait to be asked:** this is *standard* French, not Louisiana Cajun French. Cajun French differs from standard French in vocabulary, some grammar, and pronunciation in ways a text channel can't fully capture, and verifying dialect-accurate phrasing was out of scope for this build. If a judge asks specifically about Cajun French: "We built standard French support and verified it works, including some things we didn't even prompt for like Celsius conversion. We did not attempt to verify Cajun French dialect authenticity — that would need review from a native speaker before we'd claim it, and we'd rather say that plainly than overclaim regional authenticity we haven't tested."

## Hospitalization-risk model — the second AI model, not a rebrand of the first

- Directly answers the brief's own language about identifying patients "at risk for... hospitalization" — a distinct model, distinct time horizon (7-day forecast vs. today's status), never merged into the RED/YELLOW/GREEN badge.
- **Concrete proof it's doing something real, not decoration:** in the seeded data, Ruth Trahan — the caregiver-burden headline case — has the *highest* hospitalization-risk score of all six patients (55%), higher than either of the two daily-RED patients. That's not scripted for the demo; it's the trained model's actual output, driven by her caregiver's burden alert. If the caregiver-burden story is your opening hook, this is the callback: "and it shows up again here, in a completely separate model, because we built the feature set to let it."
- One-line answer if asked "isn't this just the same model twice": "No — different features entirely. The daily model looks at today plus a 3-day trend. This one looks at a rolling 7-day window: cumulative alerts, fever recurrence, sustained trend severity, and caregiver burden history. It's trained separately, calibrated to a lower base rate because hospitalization is rarer than a daily escalation, and stored in its own field."

## SOAP notes, SDOH card, FHIR export — quick hits if asked

- **SOAP note generator:** one click in the patient panel turns recent check-ins + active alert reasons into a Subjective/Objective/Assessment/Plan note, copy-pasteable into an EHR. Verified live output uses real PRO-CTCAE grading language and cites the neutropenic fever threshold correctly; the Plan section is explicitly generated as suggestions ("consider," "recommend"), never directives — a nurse still decides. For a stable patient it correctly says so instead of inventing concern — worth demoing if a judge asks "does it just always sound alarming."
- **SDOH transportation card:** a triggered, parish-specific suggestion (not a booking flow) — this is about removing the "how do I even get to the clinic" barrier the brief calls out, not building a scheduling product in a hackathon.
- **FHIR-lite export:** downloads a patient's data as FHIR-shaped resources (Patient, Condition, Observation, RiskAssessment, Flag). If asked "is this really FHIR": "It uses real FHIR resource types and real, individually verified LOINC codes where a matching one exists — we checked, we didn't guess. Where no matching code exists (there's no standard 0-10 nausea-severity LOINC code), we say so explicitly and use a local code instead of making one up. It hasn't been validated against the full FHIR spec — it's a demonstration that we understand what real interoperability requires, not a certified integration."

## If asked about testing / robustness

- 93 automated tests (Vitest) — unit tests for every risk-engine rule boundary, both trained models, the AI parsing (mocked), and integration tests hitting the actual webhook logic against a real test database.
- A load test found a real concurrency bug (a stale risk-status write under rapid same-patient check-ins) — fixed it, then found that the "obvious" fix (wrapping the write in a database transaction) made things *measurably worse* under load (SQLite-specific), and reverted it with the reasoning documented in `docs/load-test-results.md`. That's a good story if asked "how do you know this holds up" — the honest answer includes a fix we tried and un-did, not just a list of things that passed.
