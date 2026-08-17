import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// The ONLY place a SoapNote's status can become "REVIEWED". A clinician
// action, not something that happens automatically or as a side effect of
// generation — see prisma/schema.prisma's SoapNote model comment.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.soapNote.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "No SOAP note found for that id." }, { status: 404 });
  }

  const updated = await prisma.soapNote.update({
    where: { id },
    data: { status: "REVIEWED", reviewedAt: new Date() },
  });

  return NextResponse.json({
    ...updated,
    confidenceReasons: JSON.parse(updated.confidenceReasons) as string[],
    sourceLogs: JSON.parse(updated.sourceLogs),
  });
}
