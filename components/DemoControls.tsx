"use client";

import { useCallback, useEffect, useState } from "react";
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

  const handleTrigger = useCallback(
    async (id: string) => {
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
    },
    [router]
  );

  // Fast keyboard trigger — Alt+1 / Alt+2 / Alt+3 fire the scenario in that
  // list position immediately, no click required. The whole point: if
  // live Twilio/Groq drops mid-demo, recovery should take a keystroke, not
  // require finding and precisely clicking a small button on stage while
  // an audience watches. Alt (not Cmd/Ctrl) specifically to avoid
  // colliding with real browser shortcuts (Cmd+1..9 switches tabs in some
  // browsers). Documented in docs/pitch-notes.md, and the exact
  // combination is also shown right on each button below — discoverable
  // without reading the docs mid-pitch.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || pendingId !== null) return;
      const index = Number(e.key) - 1;
      const scenario = scenarios[index];
      if (Number.isInteger(index) && index >= 0 && scenario) {
        e.preventDefault();
        handleTrigger(scenario.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scenarios, pendingId, handleTrigger]);

  return (
    <Card className="border-dashed border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
          <Zap className="size-4" />
          Demo fallback (DEMO_MODE)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Break-glass only — replays a seeded scenario locally if live SMS/AI isn&apos;t available. Live SMS is the
          primary demo path. Click a button, or press the shortcut shown on it from anywhere on this page.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s, i) => (
            <Button
              key={s.id}
              size="sm"
              variant="outline"
              disabled={pendingId !== null}
              onClick={() => handleTrigger(s.id)}
              title={`${s.description} (Alt+${i + 1})`}
            >
              {pendingId === s.id ? <RotateCcw className="size-3.5 animate-spin" /> : null}
              {s.label}
              <kbd className="ml-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[10px] font-mono text-amber-700 dark:text-amber-400">
                Alt+{i + 1}
              </kbd>
            </Button>
          ))}
        </div>
        {message && <p className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
