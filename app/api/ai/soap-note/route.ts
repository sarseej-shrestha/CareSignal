import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateSoapNote } from "@/lib/ai";
import { assessSoapNoteConfidence } from "@/lib/soapNoteConfidence";

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Generates a SOAP note from a patient's recent check-in history and active
// alert reasons, and PERSISTS it as its own record — status "DRAFT" always,
// with a deterministic confidence signal computed alongside it. There is no
// code path here (or anywhere) that creates a note already marked
// reviewed — see app/api/ai/soap-note/[id]/review/route.ts for the only way
// a note's status changes.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const patientId = body?.patientId;
  if (typeof patientId !== "string") {
    return NextResponse.json({ error: "Provide { patientId: string } in the request body." }, { status: 400 });
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: {
      symptomLogs: { orderBy: { createdAt: "desc" }, take: 7 },
      alerts: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" } },
      caregiver: { include: { caregiverLogs: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  });
  if (!patient) {
    return NextResponse.json({ error: "No patient found for that id." }, { status: 404 });
  }

  const clinicalAlert = patient.alerts.find((a) => a.level === "YELLOW" || a.level === "RED") ?? null;
  const burdenAlert = patient.alerts.find((a) => a.level === "CAREGIVER_BURDEN") ?? null;

  const now = Date.now();
  const recentLogs = patient.symptomLogs
    .slice()
    .reverse() // chronological for the note
    .map((l) => ({
      daysAgo: Math.round((now - l.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      pain: l.pain,
      nausea: l.nausea,
      fatigue: l.fatigue,
      fever: l.fever,
      source: l.source,
    }));

  const confidence = assessSoapNoteConfidence({
    logCount: patient.symptomLogs.length,
    aiParsedLogCount: patient.symptomLogs.filter((l) => l.parsedByAi).length,
  });

  // Provenance for the note — the EXACT check-ins fed into generation
  // above, captured now rather than re-queried later, since the trailing
  // 7-day window this route just read could shift by the time anyone
  // views the note. Deterministic (built from the same data already
  // fetched, not asked of the LLM), so a nurse can cross-check what the
  // note's S/O sections claim against real source data in a few seconds —
  // see components/SoapNoteGenerator.tsx.
  const sourceLogs = patient.symptomLogs
    .slice()
    .reverse()
    .map((l) => ({
      id: l.id,
      dateLabel: formatDateLabel(l.createdAt),
      source: l.source,
      pain: l.pain,
      nausea: l.nausea,
      fatigue: l.fatigue,
      fever: l.fever,
    }));

  try {
    const note = await generateSoapNote({
      patientName: `${patient.firstName} ${patient.lastName}`,
      cancerType: patient.cancerType,
      chemoCycle: patient.chemoCycle,
      riskStatus: patient.riskStatus as "GREEN" | "YELLOW" | "RED",
      riskScore: patient.riskScore,
      hospitalizationRiskScore: patient.hospitalizationRiskScore,
      activeAlertReasons: clinicalAlert ? (JSON.parse(clinicalAlert.reasons) as string[]) : [],
      recentLogs,
      caregiverBurdenNote: burdenAlert ? (JSON.parse(burdenAlert.reasons) as string[]).join(" ") : null,
    });

    const saved = await prisma.soapNote.create({
      data: {
        patientId: patient.id,
        subjective: note.subjective,
        objective: note.objective,
        assessment: note.assessment,
        plan: note.plan,
        fullText: note.fullText,
        confidenceLevel: confidence.level,
        confidenceReasons: JSON.stringify(confidence.reasons),
        sourceLogs: JSON.stringify(sourceLogs),
        status: "DRAFT",
      },
    });

    return NextResponse.json({
      ...saved,
      confidenceReasons: confidence.reasons,
      sourceLogs,
    });
  } catch (err) {
    console.error("[soap-note] generation failed:", err);
    // Semifinal red-team fix: a Groq rate limit (observed live during
    // testing — the free tier's 8,000 TPM cap after a handful of sequential
    // calls) previously surfaced as the same generic message as any other
    // failure, giving a live demo operator no signal on whether to just
    // wait a few seconds and click "Generate" again. `status` is set on
    // errors the `openai` SDK throws for HTTP error responses (429 here);
    // anything without it (a network error, a malformed response) keeps
    // the existing generic message — this doesn't change behavior for any
    // other failure mode, only labels the one that's actually recoverable
    // by waiting.
    const status = (err as { status?: number } | null)?.status;
    const message =
      status === 429
        ? "The AI service is briefly rate-limited — wait about 10 seconds and try again, or use the DEMO_MODE fallback."
        : "Failed to generate SOAP note.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
