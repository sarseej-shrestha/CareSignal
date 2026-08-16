import { NextRequest, NextResponse } from "next/server";
import { parseCaregiverMessageText } from "@/lib/ai";

// Standalone demo/test endpoint for the freeform caregiver-text parsing path
// (relayed patient symptoms and/or the caregiver's own coping state).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = body?.text;

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Provide { text: string } in the request body." }, { status: 400 });
  }

  try {
    const parsed = await parseCaregiverMessageText(text);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("parse-caregiver error:", err);
    return NextResponse.json({ error: "Failed to parse caregiver text." }, { status: 500 });
  }
}
