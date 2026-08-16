"use client";

import { useState } from "react";
import { Check, Copy, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  fullText: string;
}

// Documentation aid, not an action button — generates a SOAP note a nurse
// can review and copy/adapt into the EHR. Nothing here writes clinical
// orders; the Plan section is generated as suggestions (see lib/ai.ts's
// SOAP_NOTE_SYSTEM_PROMPT), and generating a note has no side effect beyond
// optionally caching it on the patient's open alert (app/api/ai/soap-note).
export function SoapNoteGenerator({ patientId }: { patientId: string }) {
  const [note, setNote] = useState<SoapNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/soap-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate note.");
      setNote(data);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate note.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!note) return;
    await navigator.clipboard.writeText(note.fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="size-4" />
          AI-generated SOAP note
        </div>
        <div className="flex gap-2">
          {note && (
            <Button size="sm" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={loading}>
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {note ? "Regenerate" : "Generate"}
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {note && (
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">S — Subjective</dt>
            <dd>{note.subjective}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">O — Objective</dt>
            <dd>{note.objective}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">A — Assessment</dt>
            <dd>{note.assessment}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">P — Plan</dt>
            <dd>{note.plan}</dd>
          </div>
        </dl>
      )}

      {!note && !error && (
        <p className="text-xs text-muted-foreground">
          Synthesizes recent check-ins and active alert reasons into a formatted note for EHR copy-paste.
        </p>
      )}
    </div>
  );
}
