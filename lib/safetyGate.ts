// Deterministic crisis-language safety gate — runs BEFORE any LLM
// interpretation, on the raw SMS text, for both patient and caregiver
// senders. This is intentionally NOT dependent on the LLM: a model can
// misclassify, soften, or fail; explicit crisis language must never rely
// solely on that judgment call. Narrowly scoped on purpose — a handful of
// explainable, multi-word phrases rather than a broad keyword dictionary,
// to keep false positives on ordinary emotional distress ("I'm scared",
// "I'm overwhelmed", idiomatic "this is killing me") as low as possible
// while still catching explicit self-harm/suicidal language. This gate
// does not diagnose or give clinical instructions — it only flags for
// immediate human routing and points to real, existing crisis resources.

const CRISIS_PATTERNS: RegExp[] = [
  /\bkill(ing)? myself\b/i,
  /\bsuicid(e|al)\b/i,
  /\bend(ing)? (my|her|his|their|it all)\b.*\blife\b/i,
  /\bwant(ed)? to die\b/i,
  /\bdon'?t want to (be alive|live)\b/i,
  /\bno reason to live\b/i,
  /\bhurt(ing)? myself\b/i,
  /\bharm(ing)? myself\b/i,
  /\bcan'?t (go on|keep going) (living|anymore)\b/i,
  /\bbetter off dead\b/i,
];

export interface SafetyGateResult {
  triggered: boolean;
  reason: string | null;
}

export function checkSafetyGate(text: string): SafetyGateResult {
  const trimmed = text.trim();
  if (!trimmed) return { triggered: false, reason: null };

  for (const pattern of CRISIS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        triggered: true,
        reason: `Message matched a crisis-language safety pattern (${pattern.source})`,
      };
    }
  }

  return { triggered: false, reason: null };
}
