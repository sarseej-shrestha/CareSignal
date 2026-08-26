"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_LENGTH = 1600;

// The clinician writes and explicitly sends — nothing here generates or
// suggests message text. Recipient phone number is never handled
// client-side at all; this component only ever sends { patientId,
// participant, body }, and app/api/communications/send/route.ts resolves
// the actual destination server-side from the database record.
export function ReplyComposer({
  patientId,
  patientName,
  caregiverName,
  relatedAlertId,
  defaultParticipant,
}: {
  patientId: string;
  patientName: string;
  caregiverName: string | null;
  relatedAlertId?: string | null;
  defaultParticipant: "PATIENT" | "CAREGIVER";
}) {
  const router = useRouter();
  const [participant, setParticipant] = useState<"PATIENT" | "CAREGIVER">(defaultParticipant);
  const [body, setBody] = useState("");
  const [sentByName, setSentByName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const recipientLabel = participant === "CAREGIVER" ? (caregiverName ?? "caregiver") : patientName;
  const trimmed = body.trim();
  const overLimit = body.length > MAX_LENGTH;

  async function handleSend() {
    if (!trimmed || overLimit || pending) return;
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/communications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          participant,
          body: trimmed,
          relatedAlertId: relatedAlertId ?? null,
          sentByName: sentByName.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to send message.");
      // Only clear the composer on confirmed success — a failure leaves
      // the clinician's typed message in place so they don't have to
      // retype it to retry.
      setBody("");
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Reply to {participant === "CAREGIVER" ? "caregiver" : "patient"}
        </span>
        {caregiverName && (
          <div className="flex overflow-hidden rounded-md border text-xs">
            <button
              type="button"
              onClick={() => setParticipant("PATIENT")}
              className={
                participant === "PATIENT"
                  ? "bg-primary px-2 py-1 text-primary-foreground"
                  : "px-2 py-1 text-muted-foreground hover:bg-muted"
              }
            >
              Patient
            </button>
            <button
              type="button"
              onClick={() => setParticipant("CAREGIVER")}
              className={
                participant === "CAREGIVER"
                  ? "bg-primary px-2 py-1 text-primary-foreground"
                  : "px-2 py-1 text-muted-foreground hover:bg-muted"
              }
            >
              Caregiver
            </button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">To: {recipientLabel}</p>

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSuccess(false);
        }}
        placeholder="Type a message…"
        rows={3}
        disabled={pending}
        className="w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      />

      <input
        type="text"
        value={sentByName}
        onChange={(e) => setSentByName(e.target.value)}
        placeholder="Your name (optional, for the record)"
        disabled={pending}
        className="w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      />

      <div className="flex items-center justify-between gap-2">
        <span className={overLimit ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {body.length}/{MAX_LENGTH}
        </span>
        <Button size="sm" onClick={handleSend} disabled={pending || !trimmed || overLimit}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {pending ? "Sending…" : "Send SMS"}
        </Button>
      </div>

      {success && <p className="text-xs text-[var(--viz-status-good)]">Sent.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
