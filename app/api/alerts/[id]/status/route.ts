import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// The only place a RiskAlert's status changes after creation — a real care-
// team action (claim/resolve), not automatic. Reuses the existing
// OPEN/ACKNOWLEDGED/RESOLVED values already defined on the model (see
// prisma/schema.prisma) rather than introducing a second, parallel status
// vocabulary. Applies to ANY alert level (clinical YELLOW/RED,
// CAREGIVER_BURDEN, or a care-need category from lib/needCategory.ts) —
// the workflow of "someone owns this, then it's done" is the same
// regardless of what kind of alert it is.
const ALLOWED_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = body?.status;

  if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${ALLOWED_STATUSES.join(", ")}.` }, { status: 400 });
  }

  const existing = await prisma.riskAlert.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "No alert found for that id." }, { status: 404 });
  }

  const updated = await prisma.riskAlert.update({ where: { id }, data: { status } });
  return NextResponse.json(updated);
}
