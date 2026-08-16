// A deterministic, auditable confidence heuristic for AI-generated SOAP
// notes — computed in code, NOT by asking the LLM to self-assess (a model
// grading its own output is not a reliable confidence signal). Two simple,
// explainable factors: how much history the note is built from, and how
// much of that history came through freeform-text AI parsing (inherently
// more uncertain than a structured numeric reply) rather than structured
// input. This is intentionally simple — a real confidence model would need
// real outcome data to calibrate against, which doesn't exist yet (see
// docs/model-calibration.md) — but "simple and honest" beats "no signal at
// all" or "an LLM's unverifiable self-rating."

export type ConfidenceLevel = "HIGH" | "LIMITED";

export interface ConfidenceInput {
  logCount: number;
  aiParsedLogCount: number;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  reasons: string[];
}

const MIN_LOGS_FOR_HIGH_CONFIDENCE = 3;
const AI_PARSED_FRACTION_THRESHOLD = 0.5;

export function assessSoapNoteConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];

  if (input.logCount < MIN_LOGS_FOR_HIGH_CONFIDENCE) {
    reasons.push(
      input.logCount === 0
        ? "No check-in history available — this note has no symptom data to draw on."
        : `Based on only ${input.logCount} check-in${input.logCount === 1 ? "" : "s"} — limited history to establish a trend.`
    );
  }

  if (input.logCount > 0 && input.aiParsedLogCount / input.logCount >= AI_PARSED_FRACTION_THRESHOLD) {
    reasons.push(
      "Half or more of the underlying check-ins were freeform text parsed by AI, which carries more inherent uncertainty than structured numeric replies."
    );
  }

  return { level: reasons.length > 0 ? "LIMITED" : "HIGH", reasons };
}
