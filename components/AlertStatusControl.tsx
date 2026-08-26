"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

// Wires the existing (previously dead) RiskAlert.status field into a real
// action: OPEN -> ACKNOWLEDGED ("claimed, someone's on it") -> RESOLVED
// ("done"). One control, reused for clinical alerts, caregiver-burden
// alerts, and care-need alerts alike (see app/api/alerts/[id]/status).
export function AlertStatusControl({ alertId, status }: { alertId: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update status.");
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
    <div className="flex items-center gap-1.5">
      {status === "OPEN" && (
        <Button size="xs" variant="outline" onClick={() => setStatus("ACKNOWLEDGED")} disabled={pending}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : <UserCheck className="size-3" />}
          Claim
        </Button>
      )}
      {status === "ACKNOWLEDGED" && (
        <>
          <span className="text-xs text-muted-foreground">Claimed</span>
          <Button size="xs" variant="outline" onClick={() => setStatus("RESOLVED")} disabled={pending}>
            {pending ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
            Resolve
          </Button>
        </>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
