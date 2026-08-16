# Load test results

Run: 2026-08-16T07:23:44.064Z
Target: local dev server (`npm run dev`), SQLite via Prisma, structured SMS bodies (no Groq/AI in the loop — this measures our own pipeline, not the LLM provider's latency).

## Throughput

| Concurrency | Requests | Errors | Min (ms) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) |
|---|---|---|---|---|---|---|---|
| 10 | 10 | 0 | 236 | 250 | 237 | 297 | 297 |
| 50 | 50 | 0 | 23 | 79 | 81 | 127 | 146 |
| 100 | 100 | 0 | 102 | 152 | 137 | 223 | 274 |

## Race condition check

Fired 60 concurrent structured check-ins at a single dedicated test patient (no prior history), then compared the patient's final stored `riskStatus`/`riskScore` against a fresh `assessRisk()` recomputation over the complete, actually-committed log history — not just checking that no rows were lost.

- **Logs written:** 60 / 60 (no lost writes)
- **HTTP-level errors:** 0
- **Stored risk assessment:** GREEN, p=0.462
- **Recomputed from final history:** GREEN, p=0.462
- **Match:** YES — final risk assessment is consistent with the full committed history

No race condition observed at this concurrency: every concurrent request's SymptomLog write landed, and the patient's final risk fields reflect the complete history, not a stale intermediate read.

## Investigation: does this need a transaction?

`recordSymptomLog`/`recordCaregiverLog` (`lib/inbound.ts`) do a create → read-full-history → update sequence that is **not** wrapped in a `prisma.$transaction()`. That looked like an obvious gap, so it was tested both ways:

1. **Without a transaction** (original code): 60 concurrent same-patient requests, 60/60 logs written, stored risk assessment matched a fresh recomputation from the final history exactly. Ran this twice (once at N=20, once at N=60) with the same clean result both times.
2. **With a transaction** (tried as a defensive fix): wrapped both functions in `prisma.$transaction(async (tx) => {...})` and re-ran the exact same load test. Result was strictly worse on every axis — at 50 concurrent, average latency went from ~86ms to ~11,051ms; at 100 concurrent, from ~152ms to ~20,599ms; and the same-patient race check at 60 concurrent went from 60/60 logs written to **8/60**, with the other 52 requests failing outright with Prisma errors (`Socket timeout`, `Transaction already closed... timeout for this transaction was 5000 ms`).

**Root cause of (2):** Prisma's SQLite connector serializes interactive transactions through a single connection, and each transaction here holds that connection across multiple round-trip queries (create, findMany, update, sometimes another create). Under concurrency the queue backs up, transactions start exceeding Prisma's 5-second interactive-transaction timeout, and once that happens the transaction is killed mid-flight — losing the write entirely, which is a worse failure mode than the theoretical race it was meant to prevent (which was never actually observed).

**Conclusion: reverted the transaction wrap.** The unwrapped version is what's in `lib/inbound.ts` today. SQLite's single-writer semantics already serialize this closely enough in practice to avoid the interleaving that would cause a stale write, and wrapping it in an interactive transaction traded a theoretical, never-observed race for a real, load-tested one. If this app ever moves to a database with true concurrent connections (Postgres), re-evaluate — that database won't have SQLite's single-writer behavior, so the original theoretical race becomes possible again, but it also won't have Prisma's SQLite-specific interactive-transaction queuing problem, so a transaction wrap there should be revisited on its own merits rather than assumed to behave the same way.
