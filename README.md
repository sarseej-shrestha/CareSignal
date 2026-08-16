# CareSignal

SMS-first remote symptom monitoring for cancer patients undergoing chemotherapy, with a parallel caregiver-reporting channel. Daily check-ins (structured or freeform text) feed a two-layer risk engine — interpretable clinical rules plus a trained classifier — that flags escalating symptoms to a nurse triage dashboard. Caregiver burden is tracked as its own first-class signal, separate from patient clinical risk, not folded into it.

Built for the Ochsner Health / ASCO healthcare hackathon, grounded in Terrebonne and Lafourche Parish, Louisiana.

## Tech stack

- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/ui)
- **Database:** SQLite via Prisma ORM
- **SMS:** Twilio SMS API + webhooks
- **AI:** Groq (`openai/gpt-oss-120b`, OpenAI-compatible API) for freeform SMS parsing
- **ML:** A hand-trained logistic regression (no external ML library) for the risk classifier, trained on simulated data — see `docs/model-calibration.md`
- **Charts:** Recharts

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
- `GROQ_API_KEY` — required for freeform SMS/text parsing
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — required only for live inbound SMS via `/api/twilio/inbound`
- `DEMO_MODE` — set to `"true"` to enable a local fallback that replays the seeded demo scenarios without needing a live Twilio/Groq round-trip (see `docs/pitch-notes.md`)

## Docs

- [`docs/pitch-notes.md`](docs/pitch-notes.md) — talking points and demo-day logistics
- [`docs/model-calibration.md`](docs/model-calibration.md) — training data, metrics, and validation plan for the risk classifier
