// A DELIBERATELY SEPARATE simulator from scripts/train-risk-model.ts's
// persona/arc-injection approach — different RNG algorithm, different state
// model (continuous latent dynamics instead of discrete severity tiers),
// and critically, a hospitalization ground-truth mechanism that does NOT
// reference or approximate what the daily risk model would output.
//
// Why this exists: the original hospitalization-model trainer
// (scripts/train-hospitalization-model.ts) simulated its
// avgDailyModelProb7d feature by hand-picking numeric RANGES per severity
// tier that were meant to look like plausible daily-model outputs. That's
// circular in substance even though it's not circular in code — both
// models' training data encoded the same assumptions about what "low vs.
// high severity" looks like, authored in the same reasoning pass. Two
// models trained on data built from shared assumptions agreeing with each
// other (e.g. on a case like Ruth Trahan) is not independent validation.
//
// The fix here: generate raw day-by-day symptom/caregiver observations from
// a continuous hidden-state process (a patient "acuity" trajectory and a
// caregiver "capacity" trajectory, each with mean reversion and stochastic
// shocks), and generate the hospitalization ground truth from THAT hidden
// state directly — not from what the trained daily model says about the
// noisy observed data. The training script that consumes this then derives
// all seven-day features (including avgDailyModelProb7d) by actually
// running the raw simulated logs through the REAL, already-independently-
// trained daily model and rule engine (lib/risk.ts) — which is legitimate
// reuse (applying a fixed, already-trained artifact, exactly like
// production does), not the circularity being removed.

// xorshift32 — a different PRNG algorithm from riskEngine training's
// mulberry32, so there's no shared implementation, only a shared *language*
// (JavaScript) between the two simulators.
function makeXorshift32(seed: number) {
  let state = seed || 0x9e3779b9;
  return function next(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

function gaussian(rng: () => number, mean: number, stdDev: number): number {
  // Box-Muller — a different noise-generation approach from the uniform
  // randRange() jitter used in the original persona simulator.
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * stdDev;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface IndependentSimDay {
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  copingScore: number; // 1-5, hidden ground truth observed with noise
}

export interface IndependentPatientTimeline {
  days: IndependentSimDay[];
  /** Index (0-based) of the day hospitalization occurred, or null if it never did within the simulated window. */
  hospitalizedOnsetDay: number | null;
}

/**
 * Simulates one patient's raw day-by-day timeline from continuous hidden
 * state (NOT discrete severity tiers) and an independent hospitalization
 * ground-truth process (NOT a lookup keyed to a severity tier).
 */
export function simulateIndependentTimeline(seed: number, numDays: number): IndependentPatientTimeline {
  const rng = makeXorshift32(seed);

  // Baselines drawn once per patient — continuous, not tier membership.
  const acuityBaseline = clamp(gaussian(rng, 2.2, 1.6), 0.2, 6);
  const capacityBaseline = clamp(gaussian(rng, 3.6, 0.9), 1.5, 5);

  let acuity = acuityBaseline;
  let acuityShock = 0;
  let acuityEma = acuityBaseline; // tracks SUSTAINED elevation, distinct from an acute shock spike
  let capacity = capacityBaseline;
  let capacityShock = 0;

  const days: IndependentSimDay[] = [];
  let hospitalizedOnsetDay: number | null = null;

  for (let day = 0; day < numDays; day++) {
    // Patient acuity: mean-reverting random walk + decaying shock (an
    // infection/complication episode) that can newly onset each day.
    acuityShock *= 0.65;
    if (rng() < 0.045) acuityShock += gaussian(rng, 4.5, 1.3);
    acuity = clamp(acuity + 0.25 * (acuityBaseline - acuity) + acuityShock * 0.3 + gaussian(rng, 0, 0.4), 0, 10);
    acuityEma = 0.8 * acuityEma + 0.2 * acuity;

    // Caregiver capacity: its OWN independent mean-reverting walk and its
    // OWN independent shocks (representing the caregiver's own life stress,
    // unrelated to the patient), plus a WEAK coupling term — sustained high
    // patient acuity drags capacity down a little, but capacity crises also
    // happen on their own. This is the mechanism that lets caregiver burden
    // act as a genuinely independent contributor rather than a restatement
    // of patient severity.
    capacityShock *= 0.7;
    if (rng() < 0.035) capacityShock += gaussian(rng, 1.8, 0.6);
    const acuityCoupling = -0.12 * Math.max(0, acuity - 6);
    capacity = clamp(
      capacity + 0.2 * (capacityBaseline - capacity) - capacityShock * 0.3 + acuityCoupling + gaussian(rng, 0, 0.3),
      1,
      5
    );

    // Observed (noisy) measurements of the hidden acuity state — a
    // different functional mapping per symptom, not one shared arc curve.
    const pain = Math.round(clamp(acuity * 0.9 + gaussian(rng, 0, 0.6), 0, 10));
    const nausea = Math.round(clamp(acuity * 0.75 + gaussian(rng, 0, 0.6), 0, 10));
    const fatigue = Math.round(clamp(acuity * 1.0 + 0.6 + gaussian(rng, 0, 0.6), 0, 10));
    const fever = clamp(
      98.4 + Math.max(0, acuity - 5.5) * 0.55 + Math.max(0, acuityShock - 2) * 0.25 + gaussian(rng, 0, 0.15),
      96.5,
      105
    );
    const copingScore = Math.round(clamp(capacity, 1, 5));

    days.push({ pain, nausea, fatigue, fever, copingScore });

    // Hospitalization hazard — derived from the HIDDEN state directly, not
    // from any daily-model-shaped proxy. At most one event per timeline.
    if (hospitalizedOnsetDay === null) {
      let hazard = 0.0025;
      if (acuity >= 7) hazard += 0.13; // acute peak
      else if (acuity >= 5.5) hazard += 0.045;
      if (acuityShock >= 4) hazard += 0.07; // acute shock event
      if (acuityEma >= 4.5) hazard += 0.05; // SUSTAINED elevation — cumulative burden, not just a peak
      else if (acuityEma >= 3.5) hazard += 0.018;
      if (capacity <= 2) hazard += 0.06; // independent caregiver-driven contribution
      hazard = Math.min(hazard, 0.7);
      if (rng() < hazard) hospitalizedOnsetDay = day;
    }
  }

  return { days, hospitalizedOnsetDay };
}
