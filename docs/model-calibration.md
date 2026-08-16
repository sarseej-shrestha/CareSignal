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
