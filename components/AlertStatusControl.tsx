"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquareCheck, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

// Wires RiskAlert.status into real actions: OPEN -> REVIEWED -> ACTIONED ->
// RESOLVED (was OPEN/ACKNOWLEDGED/RESOLVED — see prisma/schema.prisma).
// REVIEWED is the only status set here that also triggers a side effect
// (the review-acknowledgment SMS, sent server-side by
// app/api/alerts/[id]/status/route.ts). ACTIONED has no manual button on
// purpose — it's set automatically when a clinician sends an outbound reply
// (app/api/communications/send/route.ts), because "took action" in this
// product specifically means "communicated back," not a separate manual
// checkbox to click. Only REVIEWED/ACTIONED -> RESOLVED is a manual action
// again, since resolution is a real clinical judgment call, never implied
// by having sent a message. One control, reused for clinical alerts,
// caregiver-burden alerts, and care-need alerts alike.
export function AlertStatusControl({ alertId, status }: { alertId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function setStatus(next: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update status.");
      // The status change itself always succeeds independent of whether the
      // review-acknowledgment SMS did — surface that distinction rather
      // than silently swallowing a real send failure.
      if (next === "REVIEWED" && data?.ackSent === false) {
        setNotice(`Marked reviewed, but the acknowledgment SMS could not be sent${data.ackError ? `: ${data.ackError}` : "."}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    } finally {
      setPending(false);
    }
  }

  if (status === "RESOLVED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--viz-status-good)]">
        <CheckCircle2 className="size-3.5" />
        Resolved
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {status === "OPEN" && (
          <Button size="xs" variant="outline" onClick={() => setStatus("REVIEWED")} disabled={pending}>
            {pending ? <Loader2 className="size-3 animate-spin" /> : <UserCheck className="size-3" />}
            Mark reviewed
          </Button>
        )}
        {status === "REVIEWED" && (
          <>
            <span className="text-xs text-muted-foreground">Reviewed</span>
            <Button size="xs" variant="outline" onClick={() => setStatus("RESOLVED")} disabled={pending}>
              {pending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
              Resolve
            </Button>
          </>
        )}
        {status === "ACTIONED" && (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquareCheck className="size-3" />
              Actioned
            </span>
            <Button size="xs" variant="outline" onClick={() => setStatus("RESOLVED")} disabled={pending}>
              {pending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
              Resolve
            </Button>
          </>
        )}
      </div>
      {notice && <span className="text-right text-[11px] text-amber-600 dark:text-amber-400">{notice}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
