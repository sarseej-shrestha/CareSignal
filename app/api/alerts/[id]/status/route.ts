import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendOutboundCommunication } from "@/lib/communications";
import { normalizeLang, t } from "@/lib/i18n";

// The only place a RiskAlert's status changes after creation — a real care-
// team action, not automatic. OPEN -> REVIEWED -> ACTIONED -> RESOLVED (was
// OPEN/ACKNOWLEDGED/RESOLVED — a plain string column, not a real enum, so
// this is a value rename plus one new value, not a migration). Applies to
// ANY alert level (clinical YELLOW/RED, CAREGIVER_BURDEN, or a care-need
// category from lib/needCategory.ts) — the workflow of "someone owns this,
// then acted, then it's done" is the same regardless of what kind of alert
// it is. ACTIONED can also be set here directly (a clinician marking it
// actioned without having sent a message, e.g. acted on it another way) —
// the more common path is automatic, set by
// app/api/communications/send/route.ts on a successful reply send. Neither
// REVIEWED nor ACTIONED implies RESOLVED; only an explicit "Resolve" sets
// that.
const ALLOWED_STATUSES = ["OPEN", "REVIEWED", "ACTIONED", "RESOLVED"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;

  if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${ALLOWED_STATUSES.join(", ")}.` }, { status: 400 });
  }

  const existing = await prisma.riskAlert.findUnique({
    where: { id },
    include: { patient: { include: { caregiver: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "No alert found for that id." }, { status: 404 });
  }

  const updated = await prisma.riskAlert.update({ where: { id }, data: { status } });

  // Review acknowledgment — fires ONLY on the specific OPEN -> REVIEWED
  // transition (not on repeat "mark reviewed" calls against an
  // already-REVIEWED alert, and not on any other transition), matching
  // "send exactly once" / "duplicate clicks don't send duplicate
  // acknowledgments". Best-effort: a failed ack send does not fail the
  // status change itself — the clinical action (marking it reviewed) is
  // real and independent of whether the notification SMS went through.
  let ackSent = false;
  let ackError: string | null = null;
  if (existing.status === "OPEN" && status === "REVIEWED") {
    const isBurden = existing.level === "CAREGIVER_BURDEN";
    const recipient = isBurden ? existing.patient.caregiver : existing.patient;
    if (recipient) {
      const lang = normalizeLang(recipient.preferredLanguage);
      const outcome = await sendOutboundCommunication({
        patientId: existing.patientId,
        participant: isBurden ? "CAREGIVER" : "PATIENT",
        to: recipient.phone,
        body: t("reviewAcknowledgment", lang),
        relatedAlertId: existing.id,
      });
      ackSent = outcome.ok;
      if (!outcome.ok) ackError = outcome.error ?? "Failed to send acknowledgment.";
    } else {
      // A CAREGIVER_BURDEN alert with no caregiver on file shouldn't
      // happen in practice (the alert can't be created without one — see
      // lib/inbound.ts), but fail quietly rather than throwing if it ever
      // does; the status change itself still succeeds.
      ackError = "No recipient on file for the acknowledgment.";
    }
  }

  return NextResponse.json({ ...updated, ackSent, ackError });
}
