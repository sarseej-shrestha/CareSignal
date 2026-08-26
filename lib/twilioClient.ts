// The ONLY outbound Twilio REST client in this codebase. Everything else
// that touches `twilio` (app/api/twilio/inbound/route.ts) uses it for
// `twiml.MessagingResponse` (a same-request reply) and `validateRequest`
// (signature checking) — neither of those is an outbound send. A
// clinician-initiated reply happens later, outside any inbound webhook
// request, which structurally requires the REST client this file provides.
// Reuses the exact same env vars the inbound webhook already documents
// (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) — no new
// environment variables introduced.

import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

function getTwilioClient(): ReturnType<typeof twilio> {
  if (!client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set — outbound SMS requires them.");
    }
    client = twilio(accountSid, authToken);
  }
  return client;
}

export interface TwilioSendResult {
  sid: string;
}

// Throws on any failure (invalid recipient, auth failure, network error,
// rate limit) — the caller (lib/communications.ts) is responsible for
// catching this and never reporting a message as sent when it throws. Never
// called at all when DEMO_MODE=true — see lib/communications.ts.
export async function sendSms(to: string, body: string): Promise<TwilioSendResult> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error("TWILIO_PHONE_NUMBER not set — outbound SMS requires it.");
  }
  const message = await getTwilioClient().messages.create({ to, from, body });
  return { sid: message.sid };
}
