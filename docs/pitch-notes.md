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
