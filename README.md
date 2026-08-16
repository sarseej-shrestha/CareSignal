# CareSignal

SMS-first remote symptom monitoring for cancer patients undergoing chemotherapy, with a parallel caregiver-reporting channel. Daily check-ins (structured or freeform text, in English, French, or Spanish) feed a two-layer risk engine — interpretable clinical rules plus a trained classifier — that flags escalating symptoms to a nurse triage dashboard. A separate model forecasts 7-day hospitalization risk. Caregiver burden is tracked as its own first-class signal, separate from patient clinical risk, not folded into it.

Built for the Ochsner Health / ASCO healthcare hackathon, grounded in Terrebonne and Lafourche Parish, Louisiana.

## Tech stack

- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/ui)
- **Database:** SQLite via Prisma ORM
- **SMS:** Twilio SMS API + webhooks
- **AI:** Groq (`openai/gpt-oss-120b`, OpenAI-compatible API) for freeform SMS/note-generation, handling English, French, and Spanish input
- **ML:** Two hand-trained logistic regression models (no external ML library) — a daily symptom-risk classifier and a separate 7-day hospitalization-risk forecaster — both trained on simulated data; see `docs/model-calibration.md`
- **Charts:** Recharts
- **Testing:** Vitest (unit + integration against a dedicated test DB) plus a custom load/concurrency test

## Running locally

```bash
npm install
npx prisma db push
npx tsx prisma/seed.ts
npm run dev
```

Then open [http://localhost:3000/dashboard](http://localhost:3000/dashboard).

Required environment variables (see `.env.example`):

- `DATABASE_URL` — SQLite file path, defaults to `file:./dev.db`
- `GROQ_API_KEY` — required for freeform SMS parsing and SOAP note generation
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — required only for live inbound SMS via `/api/twilio/inbound`
- `DEMO_MODE` — set to `"true"` to enable a local fallback that replays the seeded demo scenarios without needing a live Twilio/Groq round-trip (see `docs/pitch-notes.md`)

## Testing

```bash
npm test              # Vitest — unit + integration, dedicated test.db
npm run test:coverage # with a coverage report
npx tsx scripts/load-test.ts  # concurrency/load test against a live `npm run dev` server
```

The load test writes real numbers to `docs/load-test-results.md` and needs `npm run dev` running in another terminal — it writes into the actual seeded `dev.db`, so re-seed afterward (`npx tsx prisma/seed.ts`) to restore the clean demo baseline.

## What's in the dashboard

- **Consolidated triage queue** — daily clinical risk and 7-day hospitalization risk merged into one prioritized notification per patient, not two separate items (see `docs/alert-volume-analysis.md`), with source labeling (Patient SMS vs. Caregiver SMS vs. AI-parsed freeform).
- **Caregiver-burden alerts** — surfaced first, as their own alert type, never merged into clinical risk.
- **7-day hospitalization-risk forecast** — a separate model and panel from the daily risk badge, with its contributing factors listed.
- **AI-generated SOAP notes** — synthesizes recent check-ins into a Subjective/Objective/Assessment/Plan note. Every note starts as an unreviewed draft (a real database status, not just a UI label) with a computed confidence signal, and requires an explicit review action before it stops showing the draft banner; the draft/reviewed status travels with the text on copy.
- **SDOH transportation card** — a triggered, parish-aware suggestion (not a booking flow), shown when risk is elevated.
- **FHIR-lite export** — downloads a patient's data as a simplified FHIR R4 bundle (real, verified LOINC codes where available); validated against HL7's real reference validator across four rounds, now passing with zero errors (111 remaining warnings, all cosmetic best-practice recommendations) — genuinely FHIR-conformant, though not a certified EHR integration. See `docs/fhir-validation-results.md` for the full results and the scope note in `lib/fhirExport.ts`.
- **DEMO_MODE fallback panel** — replays the headline seeded scenarios locally if live SMS/AI isn't available mid-demo.

## Docs

- [`docs/pitch-notes.md`](docs/pitch-notes.md) — talking points and demo-day logistics
- [`docs/model-calibration.md`](docs/model-calibration.md) — training data, metrics, and validation plan for both risk models
- [`docs/load-test-results.md`](docs/load-test-results.md) — concurrency/load test results, including a real concurrency bug found and fixed
- [`docs/alert-volume-analysis.md`](docs/alert-volume-analysis.md) — computed nurse-triage notification volume estimates for a 50-100 patient panel
