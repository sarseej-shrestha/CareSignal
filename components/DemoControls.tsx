"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface DemoScenario {
  id: string;
  label: string;
  description: string;
}

// Break-glass fallback panel, only rendered when DEMO_MODE=true (checked
// server-side in app/dashboard/page.tsx). Replays a seeded scenario through
// the real risk-engine/alert pathway with no Twilio/Groq dependency — see
// lib/demoScenarios.ts and docs/pitch-notes.md. Never shown in a real
// deployment (DEMO_MODE should be off).
export function DemoControls() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<DemoScenario[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/demo/trigger")
      .then((res) => res.json())
      .then((data) => setScenarios(data.scenarios ?? []))
      .catch(() => setError("Couldn't load demo scenarios."));
  }, []);

  async function handleTrigger(id: string) {
    setPendingId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/demo/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Trigger failed.");
      setMessage(`${data.patientName}: ${data.summary}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trigger failed.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="border-dashed border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Zap className="size-4" />
          Demo fallback (DEMO_MODE)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Break-glass only — replays a seeded scenario locally if live SMS/AI isn&apos;t available. Live SMS is the
          primary demo path.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant="outline"
              disabled={pendingId !== null}
              onClick={() => handleTrigger(s.id)}
              title={s.description}
            >
              {pendingId === s.id ? <RotateCcw className="size-3.5 animate-spin" /> : null}
              {s.label}
            </Button>
          ))}
        </div>
        {message && <p className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
