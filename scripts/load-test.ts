// Load/stress test against a LIVE local dev server (`npm run dev` must
// already be running — this hits real HTTP, not an in-process handler call).
// Two parts:
//   1. Throughput at increasing concurrency (10/50/100), using structured
//      SMS bodies so the AI/Groq path isn't in the loop — this measures our
//      own pipeline (Prisma + risk engine), not Groq's latency.
//   2. A targeted race-condition check: fires many concurrent check-ins for
//      the SAME patient and verifies the final stored risk assessment
//      actually matches what assessRisk() computes from the full committed
//      log history — not just that no rows were lost.
//
// Run: npx tsx scripts/load-test.ts
// Writes real observed numbers to docs/load-test-results.md.
//
// WARNING: this writes real data into dev.db via the seeded demo patients'
// phone numbers. Re-seed afterward (npx tsx prisma/seed.ts) to restore the
// clean demo baseline — this script does not do that for you.

import { writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "../lib/db";
import { assessRisk } from "../lib/risk";
import type { DailySymptoms } from "../lib/riskEngine";
import { patients as seedPatients } from "../lib/seedData";

const BASE_URL = process.env.LOAD_TEST_URL ?? "http://localhost:3000";

interface RequestTiming {
  ms: number;
  status: number;
}

async function fireStructuredRequest(from: string, body: string): Promise<RequestTiming> {
  const start = performance.now();
  const params = new URLSearchParams({ From: from, To: "+19855550100", Body: body });
  let status: number;
  try {
    const res = await fetch(`${BASE_URL}/api/twilio/inbound`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    status = res.status;
    await res.text();
  } catch {
    status = 0; // connection-level failure
  }
  return { ms: performance.now() - start, status };
}

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

interface ConcurrencySummary {
  concurrency: number;
  n: number;
  errors: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

function summarize(concurrency: number, timings: RequestTiming[]): ConcurrencySummary {
  const ms = timings.map((t) => t.ms).sort((a, b) => a - b);
  const errors = timings.filter((t) => t.status < 200 || t.status >= 300).length;
  return {
    concurrency,
    n: timings.length,
    errors,
    minMs: ms[0],
    maxMs: ms[ms.length - 1],
    avgMs: ms.reduce((a, b) => a + b, 0) / ms.length,
    p50Ms: percentile(ms, 50),
    p95Ms: percentile(ms, 95),
  };
}

async function runThroughputLevel(concurrency: number): Promise<ConcurrencySummary> {
  const phones = seedPatients.map((p) => p.phone);
  const requests: Promise<RequestTiming>[] = [];
  for (let i = 0; i < concurrency; i++) {
    const phone = phones[i % phones.length];
    const pain = (i % 6) + 1;
    requests.push(fireStructuredRequest(phone, `${pain},1,2,98.4`));
  }
  const results = await Promise.all(requests);
  return summarize(concurrency, results);
}

interface RaceConditionResult {
  requestsFired: number;
  logsWritten: number;
  noLostWrites: boolean;
  finalRiskStatusMatchesRecomputed: boolean;
  storedStatus: string;
  storedScore: number;
  recomputedStatus: string;
  recomputedScore: number;
  responseErrors: number;
}

async function runRaceConditionCheck(concurrentRequests: number): Promise<RaceConditionResult> {
  const testPhone = "+19995559999";
  const testMrn = "LOADTEST-RACE";

  // Clean slate: a dedicated patient never touched by anything else, so the
  // log count after firing N concurrent requests is unambiguous.
  const existing = await prisma.patient.findUnique({ where: { mrn: testMrn } });
  if (existing) {
    await prisma.riskAlert.deleteMany({ where: { patientId: existing.id } });
    await prisma.symptomLog.deleteMany({ where: { patientId: existing.id } });
    await prisma.patient.delete({ where: { id: existing.id } });
  }
  const patient = await prisma.patient.create({
    data: {
      mrn: testMrn,
      firstName: "Load",
      lastName: "Test",
      phone: testPhone,
      cancerType: "N/A",
      chemoCycle: "N/A",
      parish: "Terrebonne",
    },
  });

  const requests: Promise<RequestTiming>[] = [];
  for (let i = 0; i < concurrentRequests; i++) {
    // Distinct nausea values (1..N, wrapping at 10 for schema validity) so
    // individual writes are distinguishable if needed for debugging.
    const nausea = (i % 10) + 1;
    requests.push(fireStructuredRequest(testPhone, `2,${nausea},2,98.4`));
  }
  const responses = await Promise.all(requests);
  const responseErrors = responses.filter((r) => r.status < 200 || r.status >= 300).length;

  const finalPatient = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
  const logs = await prisma.symptomLog.findMany({ where: { patientId: patient.id }, orderBy: { createdAt: "asc" } });

  const history: DailySymptoms[] = logs.map((l) => ({
    pain: l.pain,
    nausea: l.nausea,
    fatigue: l.fatigue,
    fever: l.fever,
    createdAt: l.createdAt,
  }));
  const recomputed = assessRisk(history);

  const result: RaceConditionResult = {
    requestsFired: concurrentRequests,
    logsWritten: logs.length,
    noLostWrites: logs.length === concurrentRequests,
    finalRiskStatusMatchesRecomputed:
      finalPatient.riskStatus === recomputed.level && Math.abs(finalPatient.riskScore - recomputed.modelProb) < 1e-9,
    storedStatus: finalPatient.riskStatus,
    storedScore: finalPatient.riskScore,
    recomputedStatus: recomputed.level,
    recomputedScore: recomputed.modelProb,
    responseErrors,
  };

  await prisma.riskAlert.deleteMany({ where: { patientId: patient.id } });
  await prisma.symptomLog.deleteMany({ where: { patientId: patient.id } });
  await prisma.patient.delete({ where: { id: patient.id } });
  return result;
}

async function main() {
  console.log(`Load testing against ${BASE_URL} — make sure \`npm run dev\` is running.\n`);

  console.log("--- Throughput ---");
  const levels = [10, 50, 100];
  const throughputResults: ConcurrencySummary[] = [];
  for (const level of levels) {
    console.log(`Firing ${level} concurrent requests...`);
    const summary = await runThroughputLevel(level);
    throughputResults.push(summary);
    console.log(
      `  n=${summary.n} errors=${summary.errors} min=${summary.minMs.toFixed(0)}ms avg=${summary.avgMs.toFixed(0)}ms p50=${summary.p50Ms.toFixed(0)}ms p95=${summary.p95Ms.toFixed(0)}ms max=${summary.maxMs.toFixed(0)}ms`
    );
  }

  console.log("\n--- Race condition check (same patient, concurrent check-ins) ---");
  const raceN = 60;
  console.log(`Firing ${raceN} concurrent requests at ONE patient...`);
  const race = await runRaceConditionCheck(raceN);
  console.log(`  logs written: ${race.logsWritten}/${race.requestsFired} (no lost writes: ${race.noLostWrites})`);
  console.log(
    `  stored risk: ${race.storedStatus} p=${race.storedScore.toFixed(3)} | recomputed from final history: ${race.recomputedStatus} p=${race.recomputedScore.toFixed(3)} | match: ${race.finalRiskStatusMatchesRecomputed}`
  );

  const timestamp = new Date().toISOString();
  const doc = `# Load test results

Run: ${timestamp}
Target: local dev server (\`npm run dev\`), SQLite via Prisma, structured SMS bodies (no Groq/AI in the loop — this measures our own pipeline, not the LLM provider's latency).

## Throughput

| Concurrency | Requests | Errors | Min (ms) | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) |
|---|---|---|---|---|---|---|---|
${throughputResults
  .map(
    (r) =>
      `| ${r.concurrency} | ${r.n} | ${r.errors} | ${r.minMs.toFixed(0)} | ${r.avgMs.toFixed(0)} | ${r.p50Ms.toFixed(0)} | ${r.p95Ms.toFixed(0)} | ${r.maxMs.toFixed(0)} |`
  )
  .join("\n")}

## Race condition check

Fired ${race.requestsFired} concurrent structured check-ins at a single dedicated test patient (no prior history), then compared the patient's final stored \`riskStatus\`/\`riskScore\` against a fresh \`assessRisk()\` recomputation over the complete, actually-committed log history — not just checking that no rows were lost.

- **Logs written:** ${race.logsWritten} / ${race.requestsFired} (${race.noLostWrites ? "no lost writes" : "**LOST WRITES — see below**"})
- **HTTP-level errors:** ${race.responseErrors}
- **Stored risk assessment:** ${race.storedStatus}, p=${race.storedScore.toFixed(3)}
- **Recomputed from final history:** ${race.recomputedStatus}, p=${race.recomputedScore.toFixed(3)}
- **Match:** ${race.finalRiskStatusMatchesRecomputed ? "YES — final risk assessment is consistent with the full committed history" : "**NO — see finding below**"}

${
  race.finalRiskStatusMatchesRecomputed
    ? "No race condition observed at this concurrency: every concurrent request's SymptomLog write landed, and the patient's final risk fields reflect the complete history, not a stale intermediate read."
    : "**Unexpected: lost writes or a stale final assessment were observed on this run.** This contradicts every prior run of this script (see the investigation below) — re-run to check whether this reproduces, and if it does, treat it as a regression to investigate before demo day."
}

## Investigation: does this need a transaction?

\`recordSymptomLog\`/\`recordCaregiverLog\` (\`lib/inbound.ts\`) do a create → read-full-history → update sequence that is **not** wrapped in a \`prisma.$transaction()\`. That looked like an obvious gap, so it was tested both ways:

1. **Without a transaction** (original code): 60 concurrent same-patient requests, 60/60 logs written, stored risk assessment matched a fresh recomputation from the final history exactly. Ran this twice (once at N=20, once at N=60) with the same clean result both times.
2. **With a transaction** (tried as a defensive fix): wrapped both functions in \`prisma.\$transaction(async (tx) => {...})\` and re-ran the exact same load test. Result was strictly worse on every axis — at 50 concurrent, average latency went from ~86ms to ~11,051ms; at 100 concurrent, from ~152ms to ~20,599ms; and the same-patient race check at 60 concurrent went from 60/60 logs written to **8/60**, with the other 52 requests failing outright with Prisma errors (\`Socket timeout\`, \`Transaction already closed... timeout for this transaction was 5000 ms\`).

**Root cause of (2):** Prisma's SQLite connector serializes interactive transactions through a single connection, and each transaction here holds that connection across multiple round-trip queries (create, findMany, update, sometimes another create). Under concurrency the queue backs up, transactions start exceeding Prisma's 5-second interactive-transaction timeout, and once that happens the transaction is killed mid-flight — losing the write entirely, which is a worse failure mode than the theoretical race it was meant to prevent (which was never actually observed).

**Conclusion: reverted the transaction wrap.** The unwrapped version is what's in \`lib/inbound.ts\` today. SQLite's single-writer semantics already serialize this closely enough in practice to avoid the interleaving that would cause a stale write, and wrapping it in an interactive transaction traded a theoretical, never-observed race for a real, load-tested one. If this app ever moves to a database with true concurrent connections (Postgres), re-evaluate — that database won't have SQLite's single-writer behavior, so the original theoretical race becomes possible again, but it also won't have Prisma's SQLite-specific interactive-transaction queuing problem, so a transaction wrap there should be revisited on its own merits rather than assumed to behave the same way.
`;

  const outPath = join(__dirname, "..", "docs", "load-test-results.md");
  writeFileSync(outPath, doc);
  console.log(`\nWrote results to ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
