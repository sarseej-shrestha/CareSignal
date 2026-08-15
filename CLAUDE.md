@AGENTS.md

# CareSignal

SMS-first remote symptom monitoring for cancer patients undergoing treatment,
with a parallel caregiver-reporting channel. Built for a healthcare hackathon
(Ochsner Health / ASCO). Full spec lived in the original build prompt; this
file is the condensed reference for future sessions in this project folder.

Vault status notes for this project live at
`~/nexus/01-Projects/CareSignal/progress-log.md` (a separate Obsidian vault,
not part of this repo) — append a dated entry there after each build tier.

## Positioning (build to support this, don't just build features)

- Not a novel clinical idea — daily symptom monitoring + nurse triage is a
  validated intervention pattern. The innovation is **accessibility**: SMS
  only, no app, no login, built for patients the original studies couldn't
  reach.
- **Caregiver-burden signal is the headline differentiator** — most tools
  monitor the patient only. Caregiver burnout is treated as a first-class,
  separate signal (its own `CAREGIVER_BURDEN` alert type), not folded into
  patient clinical risk.
- The risk model must be visibly a *trained* model (see `lib/riskModel.ts`),
  not just if/else thresholds — the challenge brief names AI/predictive
  analytics explicitly.
- Grounded in real Louisiana geography (Terrebonne/Lafourche Parish, 985 area
  code) and real clinical standards (PRO-CTCAE symptom grading, 100.4°F
  neutropenic fever threshold).

## Tech stack

- Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/ui)
- SQLite via Prisma ORM (`prisma/schema.prisma`, `prisma.config.ts`)
- Twilio SMS API + webhooks (trial account — pre-verified numbers only)
- OpenAI `gpt-4o-mini` for freeform SMS symptom parsing and SOAP note generation
- A hand-trained logistic regression (pure TS, no external ML lib) for the
  Layer 2 risk classifier
- Recharts for charts, lucide-react for icons

## File layout

- `prisma/schema.prisma` — Patient, Caregiver, SymptomLog, CaregiverLog, RiskAlert
- `prisma/seed.ts` — 6 seeded patients (Terrebonne/Lafourche), run via `npx tsx prisma/seed.ts`
- `lib/riskEngine.ts` — Layer 1: interpretable rule-based flags (the safety-critical floor)
- `lib/riskFeatures.ts` — shared feature extraction (used by both training and inference — keep these in sync)
- `lib/riskModel.ts` — Layer 2: loads `lib/model-coefficients.json`, returns a probability
- `lib/risk.ts` — combines both layers into one assessment; the model can escalate a rule bucket further, never downgrade it
- `scripts/train-risk-model.ts` — offline trainer; simulates data, writes `lib/model-coefficients.json`. Re-run with `npx tsx scripts/train-risk-model.ts` after changing the feature set or simulation calibration.
- `lib/db.ts` — Prisma client singleton
- `app/dashboard/page.tsx` — server component, fetches + shapes all dashboard data
- `app/dashboard/DashboardClient.tsx` — client component: caregiver-burden card (shown first), risk queue table, per-patient detail panel
- `components/PatientRiskTable.tsx`, `components/SymptomTrendChart.tsx`, `components/RiskBadge.tsx`, `components/SourceBadge.tsx`
- `app/api/twilio/inbound/route.ts` — Tier 2, not yet built
- `app/api/ai/parse-symptoms/route.ts` — Tier 2, not yet built
- `app/api/ai/soap-note/route.ts` — Tier 3, not yet built
- `docs/model-calibration.md`, `docs/pitch-notes.md` — pitch ammunition, written after Tier 2

## Build tiers

1. **Tier 1 (done)** — Prisma schema + seed, rule engine, trained classifier,
   triage dashboard with caregiver-burden section, trend charts, source
   labeling.
2. **Tier 2** — live Twilio inbound webhook (structured `pain,nausea,fatigue,fever`
   parsing + patient/caregiver number matching), LLM freeform-text parsing via
   GPT-4o-mini (feature this prominently — it's the clearest "this is really
   AI" demo beat), caregiver-burden alert creation wired to live inbound
   CaregiverLogs (currently only created at seed time).
3. **Tier 3 (cut first under time pressure)** — AI SOAP note generator,
   transportation/SDOH action card.

## Conventions worth knowing

- `RiskLevel` is `"GREEN" | "YELLOW" | "RED"`; `RiskAlert.level` additionally
  allows `"CAREGIVER_BURDEN"` — these are deliberately never merged into one
  enum in the UI, since clinical risk and caregiver burden must render as
  visually distinct badge types (see `components/RiskBadge.tsx`).
- `SymptomLog.source` is `"PATIENT_SMS" | "CAREGIVER_SMS" | "WEB"` — a
  caregiver can relay a patient's symptoms (source `CAREGIVER_SMS` on a
  `SymptomLog`), which is a different thing from the caregiver reporting their
  *own* coping/status (`CaregiverLog`, always tied to the `Caregiver`, not the
  `Patient`, via `caregiverId`).
- If you change `lib/riskFeatures.ts`'s feature vector, you must re-run
  `scripts/train-risk-model.ts` — the training script has its own inlined copy
  of the extraction logic (kept byte-for-byte identical on purpose, since tsx
  running the script standalone was simpler than fighting module resolution)
  and `lib/riskModel.ts` reads the resulting `model-coefficients.json`
  directly, so a drift between the two silently breaks inference.
- Chart colors follow the dataviz skill's validated palette; CSS custom
  properties for the viz roles live in `app/globals.css` (`--viz-*`) — don't
  hardcode hex values in components, reference those variables.
