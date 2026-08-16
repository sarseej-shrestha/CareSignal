# Model calibration

This document explains what CareSignal's Layer 2 risk classifier was trained on, how it was calibrated, what its held-out performance means in practice, and what would need to happen before it touched a real patient. It exists to answer "how do you know this works" honestly, not to oversell a hackathon prototype.

## What the training data is

There is no public dataset of raw longitudinal chemotherapy symptom logs — for the obvious reason that this kind of data is protected health information, and no health system publishes it. So the classifier (`scripts/train-risk-model.ts`) trains on **simulated data**: 25,200 simulated patient-days drawn from 1,200 simulated patients over a 21-day window each.

The simulation isn't random noise — it's structured around three severity personas (stable, moderate, fragile), each with a different baseline symptom level and a different probability of an injected "escalation arc": a multi-day window where pain/nausea climb, or fever spikes toward the neutropenic threshold, mimicking what a real complication actually looks like day-to-day (a trend, not a single bad reading). Labels come from that arc structure plus the same hard clinical triggers the rule engine uses (fever ≥100.4°F, pain/nausea ≥8), with ~3% label noise added because real triage outcomes are noisy too — they're not a clean deterministic function of symptom scores.

## Calibration target

The simulation was tuned so the overall escalation (positive-label) rate lands at **18.5%**, inside a 15–20% target range. That range isn't arbitrary — it's grounded in the general pattern reported across published chemotherapy symptom-monitoring trials (e.g. the PRO-CTCAE-based remote monitoring literature), where somewhere on the order of 15–20% of monitored days or check-ins result in a clinically actionable escalation or triage contact. We're citing that as a general, well-established pattern in this research area, not attributing it to one specific paper — the simulation was built to be *in the right neighborhood* of real-world base rates, not to reproduce a single study's exact numbers.

## Held-out test performance

On a held-out 20% test split (never seen during training):

| Metric | Value |
|---|---|
| Precision | 0.68 |
| Recall | 0.78 |
| Accuracy | 0.89 |
| Positive rate (test set) | 18.7% |

**Recall was deliberately prioritized over precision**, via class weighting during training (the minority/escalation class is upweighted up to 6x in the loss). This is a triage flag, not a diagnosis, and the two error types are not symmetric:

- A **false positive** costs a nurse a few minutes reviewing a chart and maybe a callback that turns out to be unnecessary.
- A **false negative** means a real complication — a climbing fever, an escalating pain pattern — goes unflagged until the next check-in, or until the patient is sick enough to call in on their own.

Given that asymmetry, a model that occasionally over-flags is far cheaper than one that occasionally stays quiet when it shouldn't. 0.78 recall means the model catches roughly 4 out of 5 simulated escalation days; the 0.68 precision is the honest cost of buying that recall.

## What the false-positive rate means operationally

On the test set, of all patient-days the model flagged, about **1 in 3 (32%)** did not correspond to a true escalation-arc day (1 − precision). Put in panel terms: for a nurse managing daily check-ins across roughly 30–50 patients, the model alone would be expected to flag on the order of **6–10 check-ins per day**, of which **roughly 2–3** would be false alarms on review.

Two caveats on that number, stated plainly:
1. It's an extrapolation from a simulated 18.7% test-set positive rate onto an illustrative panel size — not a measured real-world queue volume.
2. In the actual system, the model's flag is combined with the rule engine (`lib/risk.ts`) — most model-flagged days already satisfy a rule trigger too, so the *distinct* alert volume a nurse sees is generally lower than the model's flags counted in isolation.

## Real-world validation path (not yet done)

This model has **not** been validated against real outcomes, and shouldn't be treated as clinically validated. Simulated data can approximate a plausible base rate and a plausible feature-outcome relationship; it cannot replace ground truth. Before any real deployment, the proposed path is:

1. **Retrospective pilot against real Ochsner data** — run the trained model (or retrain on real features) against historical symptom-monitoring or nursing-triage records where the actual outcome (escalation vs. not) is already known, and measure precision/recall against real labels instead of simulated ones.
2. **Recalibrate the decision threshold** using that retrospective data — the current 0.5 model threshold and the 0.5/0.75 escalation thresholds in `lib/risk.ts` were chosen for the simulation, not tuned against a real cost function for false positives vs. false negatives in an actual triage workflow.
3. **Prospective shadow mode** — run the model alongside existing nurse triage without acting on its output, comparing its flags to what nurses actually escalate, before it's allowed to influence a real workflow.

Only after that sequence would the model be a candidate for actually gating clinical attention rather than being a decision-support signal a nurse reviews alongside their own judgment.

---

## Hospitalization-risk model (7-day forecast)

A **separate model from everything above** — different question, different time horizon, different claim. The daily model (and the rule engine) answer "how severe does today look." This model answers "how likely is this patient to be hospitalized in the next 7 days." It is surfaced on the dashboard as its own labeled panel and stored in its own field (`Patient.hospitalizationRiskScore`) — never merged into `riskStatus`/`riskScore`. This directly targets the challenge brief's own language about identifying patients "at risk for... hospitalization," which is a distinct ask from daily symptom triage.

### Features (rolling 7-day aggregates, not a single day)

| Feature | What it captures |
|---|---|
| `alertCount7d` | Cumulative clinical (YELLOW/RED) alert burden over the past week — not just today's bucket |
| `feverRecurrenceCount7d` | Count of distinct days with fever ≥100.4°F — recurrence, not a single spike |
| `severeDayCount7d` | Count of days with pain or nausea ≥7 — sustained near-severe burden |
| `maxTrendDelta7d` | Largest single-day symptom escalation observed anywhere in the window |
| `avgDailyModelProb7d` | Average of the daily risk model's probability across the week — sustained elevated risk, not just a peak |
| `caregiverBurdenFlag7d` | Whether a `CAREGIVER_BURDEN` alert fired for this patient's caregiver in the past week |

### Addressing training-data circularity (Aug 2026)

The original version of this model shared its underlying assumptions with the daily risk model in a way that undermined the "two models agree, therefore it's meaningful" argument: the hospitalization simulator generated its `avgDailyModelProb7d` feature by hand-picking numeric ranges meant to *look like* plausible daily-model outputs per severity tier, rather than deriving it from anything. Both simulators — despite being separate files with separate code — encoded the same assumptions about what "low/moderate/high severity" looks like, authored in the same reasoning pass. Two models trained on data built from shared assumptions agreeing with each other is not independent validation, even when the code doesn't literally import from itself.

**The fix:** `lib/independentPatientSimulator.ts` is a genuinely separate simulator — different PRNG algorithm (xorshift32 vs. the daily trainer's mulberry32), a continuous hidden-state model (a patient "acuity" trajectory and a caregiver "capacity" trajectory, each with mean reversion and stochastic shocks) instead of discrete severity tiers, and — critically — a hospitalization ground-truth mechanism derived directly from that hidden state, with no reference to what the daily model would say about the noisy observations built from it. `scripts/train-hospitalization-model.ts` then derives every 7-day feature, *including* `avgDailyModelProb7d`, by actually running the raw simulated logs through the real, already-independently-trained daily risk engine and classifier (`lib/risk.ts`) day by day — legitimate reuse of a fixed, already-trained artifact (exactly what production does), not the circularity being removed. The circularity was in how the raw data and the hospitalization label were generated, not in reusing real feature-computation logic.

**What changed when retrained on independent data**, reported honestly rather than smoothed over:

- **The Ruth Trahan cross-model result held up.** Ruth's caregiver-burden-driven hospitalization score is still the highest of all six seeded patients — **51.7%**, ahead of Michael Naquin (46.3%, daily-RED with an active fever) and Denise Guidry (35.6%, daily-RED). Checked directly against the raw feature inputs, not just the final score: Michael's `avgDailyModelProb7d` (0.605) and every raw symptom indicator (`feverRecurrenceCount7d`, `severeDayCount7d`, `maxTrendDelta7d`) are all *higher* than Ruth's — by every symptom-based measure he looks sicker. Ruth still wins purely because `caregiverBurdenFlag7d=1` for her and not him. That's about as clean a demonstration as this project can produce that the caregiver-burden feature is doing real, independent work, and it survived a full retrain on data with no shared assumptions.
- **The caregiver-burden feature's weight dropped** from 0.314 (circular version) to **0.149** (independent version) — still clearly positive and the third-largest of six features, but meaningfully smaller. Read honestly: the original weight was likely somewhat inflated by the shared-assumption problem; the independent estimate is probably closer to the feature's real (synthetic) contribution.
- **`severeDayCount7d` and `alertCount7d` came out with small negative weights** (-0.265 and -0.058) in the independent model, versus positive weights in the circular version. Investigated rather than dismissed: severe days (pain or nausea ≥7) occur on only ~1.5% of simulated days, and re-running training on 5x more data (6,000 vs. 1,200 simulated patients) didn't change the sign — this rules out small-sample noise. The likely explanation is a genuine statistical "suppressor" effect: `severeDayCount7d` is a sparse, noisy proxy for the same underlying signal `avgDailyModelProb7d` captures more smoothly, and once that stronger feature is in the model, the sparse one can pick up a spurious sign from residual correlation. This is disclosed as a real characteristic of the retrained model, not hidden — if asked "why would more severe days lower risk," the honest answer is "they don't, causally; that coefficient is a statistical artifact of a sparse, redundant feature, and we checked that it's stable rather than assuming it away."
- **Recall dropped substantially** — from 0.53 (circular version) to **0.14** (independent version, held-out test set; precision 0.11, accuracy 0.85, positive rate 7.4%). This is the most important honest finding of this exercise: the circular version's stronger-looking metrics were partly an artifact of training and evaluating on data built from consistent shared assumptions, not evidence of a more learnable task. The independent version's weaker recall is a more credible estimate of how hard this genuinely is.

### Training and calibration (current, independent version)

Trained on 174,000 simulated patient-day examples from 6,000 independently-simulated patient timelines (35 days each), with a hospitalized-within-7-days label derived from each patient's hidden acuity/capacity state, not from any daily-model-shaped proxy. Positive rate 7.4% — in the same "rarer than the daily model's 15-20%" spirit as the original target, though the independent simulator's calibration was driven by getting a usable, non-degenerate positive rate (an early pass at 1.6% collapsed to 0% recall) more than hitting an exact target number.

Held-out test metrics: **precision 0.11, recall 0.14, accuracy 0.85**. Recall is still prioritized via class weighting (capped 8x vs. the daily model's 6x, given the lower positive rate here), for the same reasoning as the daily model — a missed hospitalization signal costs more than an unnecessary review — but these numbers are honestly weaker than the pre-fix version, per the finding above.

**Honest caveat, updated:** this task was already harder than the daily model's (see the original caveat below, still true), and removing the circularity made that difficulty visible instead of masked. A stable, clean profile still gets a non-trivial baseline probability (roughly 25-30% in the seeded GREEN patients under the independent model, higher than the circular version's ~18-20% floor) — a real characteristic of this retrained artifact, driven by the class-weighting needed to get usable recall out of a genuinely sparser signal.

### Validation path (not yet done)

Same unvalidated status as the daily model above — see "Real-world validation path" for the full retrospective/recalibration/shadow-mode sequence, which applies here too. Two things specific to this model, not covered by that shared caveat:

- Removing training-data circularity is a **methodological** improvement (the two models' agreement is no longer explainable by shared assumptions) — it is not the same claim as **clinical** validation. The accurate pitch language is "internally consistent across independently-modeled signals," not "clinically validated."
- The caregiver-burden mechanism itself — that caregiver burnout signals precede patient hospitalization — is a stated hypothesis built into the simulation, not an established clinical finding being reproduced.
