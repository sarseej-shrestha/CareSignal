import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateSoapNote } from "@/lib/ai";

// Generates a SOAP note from a patient's recent check-in history and active
// alert reasons — a documentation aid for the nurse reviewing the patient,
// not an autonomous action. If there's an OPEN clinical (YELLOW/RED) alert,
// the generated note is also saved onto it (RiskAlert.soapNote) so it's not
// regenerated from scratch on every view; a stable/GREEN patient with no
// open alert still gets a note back, just not persisted (nothing to attach
// it to).
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

    if (clinicalAlert) {
      await prisma.riskAlert.update({ where: { id: clinicalAlert.id }, data: { soapNote: note.fullText } });
    }

    return NextResponse.json(note);
  } catch (err) {
    console.error("[soap-note] generation failed:", err);
    return NextResponse.json({ error: "Failed to generate SOAP note." }, { status: 500 });
  }
}
