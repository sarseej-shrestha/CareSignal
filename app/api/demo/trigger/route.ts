import { NextRequest, NextResponse } from "next/server";
import { DEMO_SCENARIOS, triggerScenario } from "@/lib/demoScenarios";

// Break-glass demo fallback endpoint — only usable when DEMO_MODE=true.
// See lib/demoScenarios.ts and docs/pitch-notes.md.
export async function GET() {
  return NextResponse.json({ demoModeEnabled: process.env.DEMO_MODE === "true", scenarios: DEMO_SCENARIOS });
}

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE !== "true") {
    return NextResponse.json(
      { error: "DEMO_MODE is not enabled. Set DEMO_MODE=true in .env to use the fallback demo triggers." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const scenarioId = body?.scenarioId;
  if (typeof scenarioId !== "string") {
    return NextResponse.json({ error: "Provide { scenarioId: string } in the request body." }, { status: 400 });
  }

  try {
    const result = await triggerScenario(scenarioId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[demo/trigger] failed:", err);
    const message = err instanceof Error ? err.message : "Failed to trigger demo scenario.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
