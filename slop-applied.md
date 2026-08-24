# Slop Applied (Pass A — removals)

Log of every Pass A finding from `slop-audit.md` and its outcome. Each row is
one atomic commit, gated on `npm test` + `npx tsc --noEmit` + `npm run build`,
with automatic `git reset --hard HEAD~1` on any gate failure.

| Finding | Commit | Outcome |
|---|---|---|
| `scripts/train-hospitalization-model.ts:25` unused `predictRiskProbability` import | `0569909` | applied |
| `lib/alertConsolidation.ts:70` dead export `ConsolidatableSortable` | `b78b4f0` | applied |
| `lib/seedData.ts:27` dead export `SeedSymptomDay` | `089dee7` | applied |
| `lib/seedData.ts:38` dead export `SeedCaregiverDay` | — | **skipped — false positive.** Audit missed that `prisma/seed.ts:10,93` imports and uses this type by name. Left exported. |
| `lib/independentPatientSimulator.ts:56,64` dead exports `IndependentSimDay` + `IndependentPatientTimeline` | `a8d53b5` | applied (combined, as noted in the audit — `IndependentSimDay` is a member type of `IndependentPatientTimeline`) |
| `components/RiskBadge.tsx:4` dead export `BadgeLevel` | `8ae6627` | applied |
| `app/dashboard/DashboardClient.tsx:20` dead export `CaregiverLogView` | `e7f916b` | applied |

**Result: 6 applied, 1 skipped (false positive, caught during pre-apply verification), 0 rolled back.**

Before applying each finding, every proposed unexport was independently re-verified with a fresh `grep -rn` across the whole tree (not just trusting the audit's claim) — this is what caught the `SeedCaregiverDay` false positive before it ever reached the gate.
