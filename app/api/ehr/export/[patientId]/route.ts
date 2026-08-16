import { NextRequest, NextResponse } from "next/server";
import { buildFhirBundle } from "@/lib/fhirExport";

// A demonstration of interoperability thinking, not a certified FHIR
// integration — see the honest scope note at the top of lib/fhirExport.ts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;

  const bundle = await buildFhirBundle(patientId);
  if (!bundle) {
    return NextResponse.json({ error: "No patient found for that id." }, { status: 404 });
  }

  return NextResponse.json(bundle);
}
