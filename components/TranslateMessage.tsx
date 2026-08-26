"use client";

import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// On-demand clinician translation for a single non-English patient/caregiver
// message — deliberately scoped to ONE message card (the "what happened"
// summary a clinician reads first), not every historical message. Native to
// the existing message card, not a new panel or page. Reuses component
// state as the cache (no schema change): once translated within this render,
// re-clicking toggles visibility instead of re-fetching. See
// app/api/ai/translate/route.ts / lib/ai.ts's translateForClinician — this
// is purely a presentation layer on a message that's already been safely
// triaged; it has no path back into the safety/risk pipeline.
export function TranslateMessage({ text }: { text: string }) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  async function handleClick() {
    // Already translated this render — just toggle, don't re-fetch.
    if (translation) {
      setVisible((v) => !v);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Translation unavailable. Original message shown above.");
      setTranslation(data.translation);
      setVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation unavailable. Original message shown above.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-1.5">
      <Button size="xs" variant="outline" onClick={handleClick} disabled={loading}>
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Languages className="size-3" />}
        {translation ? (visible ? "Hide translation" : "Show translation") : "Translate to English"}
      </Button>

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

      {translation && visible && (
        <div className="mt-1.5 rounded-md border border-dashed bg-muted/40 p-2.5">
          <p className="text-sm text-foreground/90">{translation}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">AI-generated translation · verify against original</p>
        </div>
      )}
    </div>
  );
}
