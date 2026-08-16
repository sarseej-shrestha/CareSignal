import { NextRequest, NextResponse } from "next/server";
import { parsePatientSymptomText } from "@/lib/ai";

// Standalone demo/test endpoint for the freeform patient-text parsing path.
// The Twilio webhook (app/api/twilio/inbound/route.ts) calls the same
// lib/ai.ts function directly rather than hitting this route over HTTP.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = body?.text;

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Provide { text: string } in the request body." }, { status: 400 });
  }

  try {
    const parsed = await parsePatientSymptomText(text);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("parse-symptoms error:", err);
    return NextResponse.json({ error: "Failed to parse symptom text." }, { status: 500 });
  }
}
