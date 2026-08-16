import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateSoapNote } from "@/lib/ai";
import { assessSoapNoteConfidence } from "@/lib/soapNoteConfidence";

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
        status: "DRAFT",
      },
    });

    return NextResponse.json({
      ...saved,
      confidenceReasons: confidence.reasons,
    });
  } catch (err) {
    console.error("[soap-note] generation failed:", err);
    return NextResponse.json({ error: "Failed to generate SOAP note." }, { status: 500 });
  }
}
