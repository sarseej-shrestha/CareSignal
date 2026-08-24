# Demo script (~3 minutes)

A timed, word-for-word script for a live pitch slot. Built around the
`DEMO_MODE` fallback panel (Alt+1/2/3 keyboard triggers) rather than live
Twilio SMS — reliable regardless of venue wifi, and it exercises the exact
same risk-engine/alert pathway a real text message would. See
`docs/pitch-notes.md` for the full talking-points reference and hard-question
answers this script pulls from; this file is the on-stage version of a subset
of it, timed and literal.

## Before you go on

1. `DEMO_MODE="true"` in `.env`.
2. Fresh seed: `npx tsx prisma/seed.ts` (so Denise Guidry's row is still in
   its pre-escalation state — the live trigger later won't do anything
   visible if she's already been triggered once this session).
3. Dashboard open at `/dashboard`, priority queue visible, nothing
   pre-clicked.
4. Do one silent dry run of Alt+2 before walking on stage, then re-seed. Confirms the fallback is warm.

**If DEMO_MODE panel doesn't render or the browser hiccups:** open a terminal
and run `npx tsx scripts/demo-trigger.ts guidry-divergence`, then refresh the
tab. Same end state, no clicking required.

---

## 0:00 – Open on the queue (~15s)

**[Dashboard is already open. Don't click anything yet. Let the queue sit on screen for a beat.]**

> "This is CareSignal — a nurse's triage queue for chemo patients who check in
> by text message. No app, no login. Just a phone number."

**[Point at Ruth Trahan's row.]**

> "Every other symptom tracker on the market watches the patient. We watch
> two people — the patient, and whoever's taking care of them at home. Watch
> what that looks like."

## 0:15 – Click into Ruth Trahan (~40s)

**[Click Ruth Trahan's row to open the detail panel.]**

> "Ruth's clinical status today is moderate — yellow, not red. But right next
> to it is a second badge her tracker generates from a completely separate
> data source: her daughter Angela, texting in on her own channel."

**[Point at the two side-by-side "why" boxes.]**

> "Two days ago, Angela texted this —"

**[Read directly off the caregiver check-in log, or paraphrase tightly:]**

> "— *'I don't know how much longer I can keep doing this on top of my own
> job. I'm exhausted.'* That's not folded into Ruth's clinical score. It's
> its own alert, its own color, its own reason box. Because a caregiver
> burning out is a second point of failure for this patient's care, and
> almost nobody tracks it."

## 0:55 – The hospitalization forecast payoff (~35s)

**[Scroll to the 7-day hospitalization risk panel in Ruth's detail view.]**

> "Here's proof that signal is real, not decoration. This panel is a second,
> completely separate model — it forecasts hospitalization risk over the next
> seven days, not today's status. Ruth's score here is the **highest of
> every patient in this panel** — higher than patients with an actual active
> fever right now."

**[Pause half a beat.]**

> "Symptom-for-symptom, she's not the sickest person in this queue. She's
> first because her caregiver is running out of capacity — and the model
> found that on its own."

## 1:30 – Live proof it's a real trained model (~45s)

**[Navigate back to the queue. Say this line before pressing the key — it sets up what the audience should watch for.]**

> "One more thing, live. Every risk score here runs through two layers: hard
> clinical rules first — that's the safety floor, always auditable — and then
> a trained model on top that can push a risk level *higher* than the rules
> alone would, never lower. Watch Denise Guidry's row."

**[Press Alt+2. The dashboard updates in about a second.]**

> "That check-in just came in as loose text — 'feeling a lot worse today,
> pain's up a lot, I'm just wiped out, no fever though.' No fever means the
> hard rules alone only get her to yellow. But the trained model looked at
> the same data and pushed her to **red** — because it's read the trend, not
> just today's numbers. That's the model doing real work in front of you,
> not an if/else statement wearing an AI label."

## 2:15 – Close (~35s)

**[Scroll up to the "What CareSignal does not claim" panel at the top of the dashboard, if it's still expanded — otherwise just gesture at the header area.]**

> "This isn't a new clinical idea — daily symptom monitoring with nurse
> triage is already validated in oncology research. What we built is reach:
> SMS-only, so it works for the patient who doesn't have a smartphone data
> plan, not just the one who does. And we say what this isn't, right on the
> dashboard, without being asked — not clinically validated yet, not a
> diagnosis, built on simulated data with a real path to real validation
> written down."

> "Two people, two signals, one nurse who can actually see both. That's
> CareSignal."

**[Stop talking. Let the last frame sit. Take questions.]**

---

## If a judge asks something mid-demo

Full answers are in `docs/pitch-notes.md`. The three most likely to come up
in the room, condensed:

- **"How is this different from other symptom trackers?"** — Caregiver
  channel as a first-class signal, SMS-only with no app or login, trend-based
  flagging instead of single-reading thresholds.
- **"How do you know this works?"** — Built on a validated intervention
  pattern, calibrated to published real-world escalation rates, with an
  explicit retrospective-pilot validation path scoped but not yet run. Not
  claiming clinical validation today — claiming an honest starting point.
- **"Isn't the hospitalization model just the daily model twice?"** —
  Different features entirely: the daily model looks at today plus a 3-day
  trend, this one looks at a rolling 7-day window including caregiver-burden
  history, trained separately, stored in its own field, never merged into
  the clinical badge.

## Contingency: if DEMO_MODE itself fails

Narrate from memory using a screenshot or a previously-deployed build if one
exists: Ruth Trahan's 52% hospitalization score (highest of all eight seeded
patients, per `docs/model-calibration.md`) and Denise Guidry's rules-vs-model
divergence (YELLOW vs. RED, p=0.96). Say plainly that live triggering isn't
cooperating rather than pretending it worked — the project's own
honesty-about-limitations framing covers this kind of moment too.
