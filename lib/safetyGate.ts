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
//
// Semifinal red-team fix: this list was English-only, and CareSignal's own
// pitch is trilingual (lib/i18n.ts). Verified live: a French or Spanish
// crisis message bypassed this gate entirely and fell through to needCategory
// EMOTIONAL — same visual/reply treatment as ordinary anxiety, no crisis
// resources sent. The French/Spanish patterns below are DIRECT phrase
// equivalents of the English list above (same narrow, multi-word,
// low-false-positive philosophy), not a general translation layer — they
// are a zero-dependency floor that still works if Groq is unreachable.
// See lib/ai.ts's crisisLanguageDetected field for the second, LLM-based
// layer that catches paraphrases/indirect phrasing this list can't.
// Accents are made optional where SMS commonly drops them (e.g. "mas" for
// "más") since that's how this actually gets typed on a phone.
const CRISIS_PATTERNS: RegExp[] = [
  // English
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

  // French
  /\bme (tuer|suicider)\b/i,
  /\bsuicid(e|aire)\b/i,
  /\ben finir avec (ma|sa|leur|cette) vie\b/i,
  /\bveu(x|t|lent) mourir\b/i,
  /\bne veux? plus (vivre|[êe]tre en vie)\b/i,
  /\baucune raison de vivre\b/i,
  /\bme (faire du mal|blesser)\b/i,
  /\bn'?en peux plus\b/i,
  /\bmieux (de\s)?(mort|[êe]tre mort)\b/i,

  // Spanish
  /\b(matarme|suicidarme)\b/i,
  /\bsuicid(io|a)\b/i,
  /\b(terminar|acabar) con (mi|su|la) vida\b/i,
  /\bquier[oa]? morir\b/i,
  /\bquer[ií]a morir\b/i,
  /\bno quiero (vivir|seguir viviendo)\b/i,
  /\bninguna raz[oó]n para vivir\b/i,
  /\b(hacerme da[nñ]o|lastimarme)\b/i,
  /\bya no puedo m[aá]s\b/i,
  /\bmejor (estar[ií]a|estuviera) muert[oa]\b/i,
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
