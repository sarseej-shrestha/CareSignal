# Final status report

This document closes out the "final robustness pass" — the last planned
substantial pass before CareSignal is considered done for the hackathon.
It summarizes what was re-verified, what was actually found and fixed
during this pass (as distinct from earlier passes), current test/build
state, current load-test numbers, and an explicit list of what's left —
which, as of this report, is conceptual/scope-level only, not technical.

## What was re-verified and confirmed clean

**Full regression pass:** `tsc --noEmit` clean, `npx next build` succeeds,
137/137 tests passing across 16 files (fresh run, not assumed from memory).

**All 9 previously identified items, re-confirmed with evidence, not just re-asserted:**

1. **Hospitalization-model circularity fix** — `git log` confirms the
   simulator/training files haven't been touched since the original fix;
   the committed coefficients file's weights match `docs/model-calibration.md`
   exactly (including `nExamples: 174000`, `nPatients: 6000`).
2. **Spanish/French parity** — all i18n and webhook-language tests still
   pass; `normalizeLang()` is a strict allowlist. Re-verified live this
   pass with real Groq calls in both languages, including the unprompted
   Celsius-to-Fahrenheit conversion still working.
3. **Alert consolidation** — 9/9 unit tests pass; confirmed the dashboard
   was never exposed to today's hospitalization-recompute bug in the first
   place, because `app/dashboard/page.tsx` always live-recomputes
   `hospitalizationRiskScore` rather than reading the (previously-buggy)
   stored column.
4. **SOAP note safety architecture** — files unchanged since the original
   commit; 20/20 SOAP tests pass, including the Groq-timeout-returns-500
   test.
5. **FHIR conformance** — re-validated against HL7's real reference
   validator on two additional, differently-shaped patients (Sofía Reyes,
   James Chauvin) beyond the originally-tested Ruth Trahan bundle: zero
   errors on both, same four expected warning categories. Also validated a
   synthetic zero-history patient (see error-handling section below).
6. **SDOH depth and trigger logic** — 7/7 unit tests pass; confirmed live
   on the dashboard that the treatment-frequency trigger still correctly
   shows/hides across real seeded patients.
7. **Hedging-language dedup** — confirmed the Task 8 dedup held; no new
   duplication was reintroduced by any commit since.
8. **Twilio live-demo readiness** — confirmed still genuinely outstanding
   (see below).
9. **Both bugs fixed in the prior session** (hospitalization recompute;
   the circularity-audit findings) — regression tests for both still pass.

## What was found and fixed in THIS pass

Six real issues found during this pass's audits, all fixed (not just
flagged) and all covered by new or updated tests:

1. **No test coverage for Twilio signature enforcement itself.** Every
   existing webhook test ran without `TWILIO_AUTH_TOKEN` set, so the
   "reject bad signature" and "accept valid signature" paths had zero
   automated coverage even though the code was correct. Added two tests
   using `twilio.getExpectedTwilioSignature` (a real computed signature,
   not mocked) — confirms genuine 403 rejection and genuine acceptance.
2. **A brand-new patient's hospitalization score looked misleadingly
   precise.** Zero check-in history still produced a real percentage (the
   model's learned intercept), shown with no visual distinction from a
   personalized estimate. `computeHospitalizationRisk()` now returns
   `hasRecentHistory`; the dashboard panel shows an explicit "Limited
   data" caveat when false — same pattern as the SOAP note's `LIMITED`
   confidence signal.
3. **FHIR export bypassed the language-fallback allowlist.**
   `lib/fhirExport.ts` embedded `patient.preferredLanguage` raw into a
   FHIR field that requires a valid BCP-47 code, instead of going through
   `normalizeLang()` like every other consumer. Fixed; added a test with a
   deliberately invalid language value.
4. **No dedicated test for FHIR export on minimal/no data.** Verified live
   (a synthetic zero-history patient produces a small, valid 3-entry
   bundle — Patient, Condition, hospitalization RiskAssessment — that
   still passes real HL7 validation with zero errors) and added a
   permanent regression test for it.
5. **The "111 remaining FHIR warnings" figure was patient-specific,
   presented as universal.** Discovered while re-validating multiple
   patients for item 5 above — the count scales with bundle size (93-95
   for typical patients, 111 for the most data-rich seeded patient, 3 for
   a zero-history patient). `docs/pitch-notes.md` reworded to say so.
6. **Load-test latency increased measurably at 50/100 concurrency**
   (avg +41ms/+62ms, P95 +55ms/+105ms) vs. the original hardening-pass
   baseline. Investigated two hypotheses rather than assuming a cause:
   accumulated `dev.db` row growth (tested by reseeding clean and
   re-running — ruled out, numbers were unchanged) and real added
   work from the hospitalization-risk recompute, confirmed via `git log`
   to postdate the original baseline entirely. Documented as expected,
   bounded, disclosed cost — not an unexplained regression (zero errors at
   every concurrency level, in every run).

Additionally, three stale numbers were caught and fixed in the final docs
consistency pass: a hardcoded "93 automated tests" figure (now 137), a
"those 7" seeded-patient reference (now 8), and the FHIR warning-count
universality issue from item 5 above.

## Current test count

**137 tests passing, 16 files, 0 failures.** `tsc --noEmit` clean.
`npx next build` succeeds. (Was 130 tests / 15 files at the start of this
pass — the six items above added 7 new tests net.)

## Current load-test numbers

| Concurrency | Avg (ms) | P95 (ms) | Errors |
|---|---|---|---|
| 10 | 53 | 74 | 0 |
| 50 | 120 | 182 | 0 |
| 100 | 214 | 328 | 0 |

Race-condition check: 60/60 concurrent same-patient writes landed, stored
risk assessment matches a fresh recomputation from the full committed
history. Zero errors at every concurrency level tested. Full comparison
against the original baseline, including the investigation into why
latency increased, is in `docs/load-test-results.md`.

## Remaining known limitations

Everything below is a conceptual or scope-level limitation — a pitch
framing decision or a real-world deployment gap — not a code defect. If
that changes before this report is next updated, it will say so plainly
here rather than being dropped from the list.

- **Not clinically validated against real patient outcomes.** Both risk
  models are trained on simulated data with a disclosed, reasoned
  calibration target — not validated against real Ochsner admission or
  triage records. The proposed retrospective/recalibration/shadow-mode
  path is documented in `docs/model-calibration.md` but not executed.
- **Not a certified EHR integration.** The FHIR export is genuinely
  FHIR-conformant (validated against HL7's real reference validator,
  zero errors across every patient tested) but has not gone through a
  formal HL7/ONC certification process.
- **Breadth across many systems rather than narrow depth in one.** This
  project covers SMS intake, two ML models, three languages, SOAP note
  generation, SDOH suggestions, and FHIR export — a hackathon-appropriate
  demonstration of range, not the deep, single-system polish a narrower
  scope could have achieved in the same time.
- **No human usability testing conducted.** Nothing here has been used by
  an actual patient, caregiver, or nurse — all verification in this
  project (including this pass's full manual walkthrough) was conducted by
  the development team, not real end users.
- **Twilio live-demo readiness requires the user's own action.** A real
  Twilio account still needs to be created, a phone number verified as a
  caller ID, and the webhook pointed at a public URL — none of which can
  be done from inside this codebase. `scripts/set-live-demo-number.ts` and
  the setup steps in `docs/pitch-notes.md` are ready; `TWILIO_ACCOUNT_SID`
  / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` are still unset in `.env`
  as of this report (confirmed, not assumed).
- **Single-writer SQLite, not evaluated under multi-connection concurrency.**
  The load test's clean results rely on SQLite's single-writer semantics,
  documented in `docs/load-test-results.md`. A move to a real
  multi-connection database (e.g. Postgres) would need this re-evaluated
  on its own terms, particularly the decision not to wrap writes in an
  interactive transaction.

No technical defect is being held back from this list — everything found
during this pass that qualified as one has been fixed and is covered by a
test, per the sections above.

---

Every commit made during this session operated inside `~/CareSignal`
(confirmed via `git rev-parse --show-toplevel` before every stage, and
`git status` reviewed for out-of-repo paths before every `git add`). No
commit in this session touched anything under `~/nexus`.
