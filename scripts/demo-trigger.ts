// CLI alternative to the dashboard's demo-fallback buttons — same effect,
// for a presenter more comfortable with a terminal than a click during a
// live-troubleshooting moment. Requires DEMO_MODE=true in .env.
//
// Run: npx tsx scripts/demo-trigger.ts <scenario-id>
//   npx tsx scripts/demo-trigger.ts naquin-fever
//   npx tsx scripts/demo-trigger.ts guidry-divergence
//   npx tsx scripts/demo-trigger.ts trahan-burden
//   npx tsx scripts/demo-trigger.ts        (no arg: lists scenario ids)

import { DEMO_SCENARIOS, triggerScenario } from "../lib/demoScenarios";
import { prisma } from "../lib/db";

async function main() {
  const scenarioId = process.argv[2];

  if (!scenarioId) {
    console.log("Usage: npx tsx scripts/demo-trigger.ts <scenario-id>\n");
    console.log("Available scenarios:");
    for (const s of DEMO_SCENARIOS) {
      console.log(`  ${s.id.padEnd(20)} ${s.description}`);
    }
    process.exit(1);
  }

  const result = await triggerScenario(scenarioId);
  console.log(`✓ ${result.patientName}: ${result.summary}`);
}

main()
  .catch((err) => {
    console.error("✗", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
