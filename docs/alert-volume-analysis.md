# Alert volume analysis

Answers the question a real triage nurse would ask before adopting this: *how many things would I actually have to look at each day?* Numbers below are computed, not estimated by hand — `scripts/estimate-alert-volume.ts` runs the same independent patient simulator used to train the hospitalization model (`lib/independentPatientSimulator.ts`) through the ACTUAL trained daily and hospitalization models, at scale (2,000 simulated patients × 30 days = 48,000 patient-days), and tabulates how often each signal fires, alone and together. Re-run it (`npx tsx scripts/estimate-alert-volume.ts`) any time either model is retrained — these numbers are only as good as the models behind them, and both are still trained on simulated, not real, data (see `docs/model-calibration.md`).

## Why consolidation exists

Before this: a patient could generate a daily clinical alert (YELLOW/RED) and independently cross an elevated hospitalization-risk threshold, and a nurse reviewing a raw alert list would see those as two separate things to check — even though they're often about the same patient, the same underlying situation, at the same time. `lib/alertConsolidation.ts` merges them into one notification per patient with a combined priority tier (`DUAL_RED` > `RED` > `DUAL_YELLOW` > `YELLOW` > `HOSP_WATCH` > `NONE`), shown as one queue row with both signals visible when both apply — see the "+ 7-day risk" tag on the dashboard.

## Base rates (measured, not assumed)

| Signal | Rate |
|---|---|
| Daily clinical alert (YELLOW/RED) | 24.4% of patient-days |
| Hospitalization risk elevated (≥0.5, the model's own trained decision threshold — see the calibration note below) | 9.7% of patient-days |
| Both at once (dual-signal) | 6.9% of patient-days |
| Daily alert only | 17.5% of patient-days |
| Hospitalization-watch only (no daily alert) | 2.8% of patient-days |
| Neither | 72.9% of patient-days |

**A calibration note on the threshold, because getting this wrong the first time is itself worth documenting:** the hospitalization-alert threshold was initially set to 0.35, chosen by eyeballing the real seeded demo patients' scores (which cluster 25-52%). Running it against the full simulated population instead of just the seven hand-picked demo patients showed that threshold firing on **~60% of all patient-days** — nowhere near a usable "elevated" signal, because those 7 patients aren't a representative sample of the model's output range. The threshold is now pinned to `HOSP_MODEL_THRESHOLD` (0.5, the model's own trained decision boundary), which gives a 9.7% elevated rate closely matching the model's own ~7.4% training positive rate, as expected. Lesson generalized: a threshold checked only against a handful of demo examples doesn't tell you what it does at scale — check it against the full simulated distribution before treating it as calibrated.

## Panel-size projections

Assumes one check-in per patient per day (the app's daily cadence) and independence across patients (a simplification — in reality, a bad week for the whole panel, e.g. a shared complication trend, would correlate check-ins across patients; this estimate doesn't model that).

| Panel size | Consolidated notifications/day | Of which dual-signal | Of which daily-only | Of which hosp-watch-only | Unconsolidated (two separate items) |
|---|---|---|---|---|---|
| 50 | **13.6** | 3.5 | 8.7 | 1.4 | 17.0 |
| 75 | **20.4** | 5.2 | 13.1 | 2.1 | 25.6 |
| 100 | **27.1** | 6.9 | 17.5 | 2.8 | 34.1 |

For the middle of the brief's suggested range — a 75-patient panel — a nurse reviews roughly **20 consolidated notifications per day**, of which about a quarter (5) are the higher-priority dual-signal case (both daily risk and hospitalization risk elevated at once). Consolidation cuts total review volume by about **20%** versus treating the two signals as separate items (25.6 → 20.4 at that panel size) — a real, modest reduction, not a dramatic one, and stated as such rather than oversold.

## Honest limits of this estimate

- Both underlying models are trained on **simulated** data (see `docs/model-calibration.md`) — this volume estimate inherits that limitation directly. A real deployment's actual alert volume depends on real escalation and hospitalization base rates in a real Ochsner patient population, which are not yet known.
- Assumes daily check-in compliance at 100%. Real SMS response rates are lower; a missed check-in is a different kind of thing to review (has this patient gone quiet?), not modeled here at all.
- Assumes each patient-day is independent. Correlated events (a facility-wide issue, a bad flu season) would cluster alerts in ways a per-day-independent estimate misses.
- `RiskAlert.status` (OPEN/ACKNOWLEDGED/RESOLVED) already exists in the schema for a nurse to actually clear reviewed items, but this estimate is about daily *new* notification volume, not queue backlog — a nurse who doesn't clear items would see backlog grow independent of these numbers.
