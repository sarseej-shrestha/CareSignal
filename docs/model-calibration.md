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

### Why caregiver burden is a feature here — the explicit reasoning

A caregiver who is losing the capacity to cope is treated as a **leading indicator of hospitalization risk, not a restatement of the patient's own symptom severity**. The mechanism this is meant to approximate: an overwhelmed caregiver is less able to manage medications, notice warning signs early, or get the patient to care before a manageable problem becomes a crisis — so caregiver collapse can precede a hospitalization even when the patient's own logged symptoms don't yet look severe on paper. This is a defensible hypothesis, not a validated clinical finding — it hasn't been tested against real outcome data (see the validation path below) — but it's stated here explicitly rather than left implicit, because it's a claim this project is making on purpose.

The simulated training data encodes this as an **independent probability boost**: a `caregiverBurdenFlag7d=1` adds a fixed +0.12 to the simulated hospitalization probability on top of whatever the patient's own symptom-severity tier already contributes, rather than only occurring alongside already-severe symptom profiles. The trained model's standardized feature weight for this feature came out to **0.314** — the second-highest of the six features (behind `avgDailyModelProb7d` at 0.373, ahead of `maxTrendDelta7d` at 0.255) — confirming the model learned a real, standalone contribution from it rather than weighting it near zero because it was redundant with symptom severity.

**Concrete demo proof:** in the seeded data, Ruth Trahan (whose own daily clinical risk is only YELLOW) has the **highest** hospitalization-risk score of all six seeded patients (55.2%) — higher than Michael Naquin (44.8%) and Denise Guidry (39.1%), both of whom are daily-RED with active fever/severe-trend flags. The reason is her caregiver's burden alert. That's the caregiver-signal thesis showing up as an actual, reproducible model output, not just pitch copy — run `npx tsx prisma/seed.ts` and check the dashboard to see it.

### Training and calibration

Trained on 20,000 simulated "patient-week" examples (each one a snapshot of the 6 rolling features plus a hospitalized-within-7-days label), drawn from three severity tiers (low/moderate/high) with the caregiver-burden boost applied independently of tier. Calibrated to a **9.6% positive rate** — deliberately lower than the daily model's 15-20%, on the reasoning that hospitalization is a rarer, more severe outcome than a daily YELLOW/RED escalation; not every escalation leads to hospitalization, so this rate should sit below that one. This is a judgment call about relative ordering, not a claim grounded in a specific cited hospitalization-rate statistic.

Held-out test metrics: **precision 0.30, recall 0.53, accuracy 0.84**. Recall is prioritized over precision using the same class-weighting approach and the same reasoning as the daily model (a missed hospitalization-risk signal is worse than an unnecessary review) — a lower class weight was tried (capped at 3x instead of 6x) and produced better precision (0.35) but worse recall (0.36 vs 0.53); that tradeoff was rejected because it optimizes the wrong error for this use case.

**Honest caveat on these numbers:** this task is harder than the daily model's. The daily model's features include hard clinical thresholds (fever ≥100.4°F, pain ≥8) that are near-deterministic signals; this model's rolling aggregates are noisier and more overlapping between severity tiers by construction, and its recall/precision reflect that — a stable, clean profile still gets a non-trivial baseline probability (~18-20% in the seeded GREEN patients) rather than near-zero, because the recall-prioritized training pushes the whole decision surface toward flagging more broadly. That's a real characteristic of this model as trained, not a display bug — it was checked directly against the underlying feature inputs, not just the final score.

### Validation path (not yet done — same caveat as the daily model)

This model has **not** been validated against real hospitalization outcomes and should not be treated as clinically validated — everything above is simulated, including the caregiver-burden mechanism, which is a stated hypothesis, not an established one. The same validation path as the daily model applies: retrospective testing against real Ochsner admission records (matching the 6 features to real historical data would itself be a meaningful first step, since it would show whether the feature set is even available and predictive in practice), threshold recalibration against real costs, and prospective shadow mode before any real deployment.
