import { NextRequest, NextResponse } from "next/server";
import { translateForClinician } from "@/lib/ai";

// On-demand clinician translation — called ONLY when a clinician clicks
// "Translate to English" on a specific message (components/TranslateMessage.tsx).
// This is NOT part of inbound SMS processing (app/api/twilio/inbound/route.ts)
// and has no way to reach it: it receives plain text, returns a translation,
// and never touches the database, a patient record, or any risk/safety
// computation. See lib/ai.ts's translateForClinician for the prompt and the
// isolation note.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const text = body?.text;

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Provide { text: string } in the request body." }, { status: 400 });
  }

  try {
    const result = await translateForClinician(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[translate] failed:", err);
    // Same rate-limit-aware pattern as app/api/ai/soap-note/route.ts — the
    // free Groq tier's rate limit is a real, observed failure mode, and a
    // clinician clicking "Translate" deserves a more useful message than a
    // generic failure when that's specifically what happened.
    const status = (err as { status?: number } | null)?.status;
    const message =
      status === 429
        ? "The AI service is briefly rate-limited — wait about 10 seconds and try again."
        : "Translation unavailable. Original message shown above.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
