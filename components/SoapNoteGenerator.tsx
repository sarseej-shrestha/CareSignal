"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSoapNoteForExport } from "@/lib/soapNoteFormat";
import { SourceBadge, type LogSource } from "@/components/SourceBadge";

interface SourceLogEntry {
  id: string;
  dateLabel: string;
  source: LogSource;
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
}

interface SoapNote {
  id: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  fullText: string;
  confidenceLevel: "HIGH" | "LIMITED";
  confidenceReasons: string[];
  sourceLogs: SourceLogEntry[];
  status: "DRAFT" | "REVIEWED";
  reviewedAt: string | null;
}

// A generated note is ALWAYS "DRAFT" until a clinician explicitly reviews
// it (app/api/ai/soap-note/[id]/review) — that's enforced server-side
// (prisma/schema.prisma's SoapNote model), not just by this component
// defaulting to showing a banner. The copy button always runs the note
// through formatSoapNoteForExport(), so the draft/reviewed status rides
// along into whatever gets pasted elsewhere, not just what's shown here.
export function SoapNoteGenerator({ patientId }: { patientId: string }) {
  const [note, setNote] = useState<SoapNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
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

  async function handleReview() {
    if (!note) return;
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/soap-note/${note.id}/review`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to mark as reviewed.");
      setNote(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark as reviewed.");
    } finally {
      setReviewing(false);
    }
  }

  async function handleCopy() {
    if (!note) return;
    await navigator.clipboard.writeText(formatSoapNoteForExport(note));
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
        <>
          {note.status === "DRAFT" ? (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  AI-GENERATED DRAFT — REQUIRES CLINICIAN REVIEW
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Not a finalized clinical note. Review the content below, then mark it reviewed.
                </p>
              </div>
              <Button size="sm" onClick={handleReview} disabled={reviewing} className="shrink-0">
                {reviewing && <Loader2 className="size-3.5 animate-spin" />}
                Mark reviewed
              </Button>
            </div>
          ) : (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5">
              <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Reviewed{note.reviewedAt ? ` ${new Date(note.reviewedAt).toLocaleString()}` : ""}
              </p>
            </div>
          )}

          {note.confidenceLevel === "LIMITED" && (
            <div className="mb-3 rounded-md border border-dashed p-2.5">
              <p className="text-xs font-medium text-muted-foreground">Limited-confidence signal</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {note.confidenceReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

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

          {note.sourceLogs.length > 0 && (
            // Verifiability, not a fancy diff: every S/O/A/P section above
            // was generated from this SAME complete set of check-ins at
            // once (not one log per sentence), so this deliberately doesn't
            // claim a false per-sentence mapping — it's the real, complete
            // evidence set, with actual numbers, so a nurse can cross-check
            // a claim like "pain rose to 5/10" against the raw values here
            // in a few seconds instead of trusting the prose on its own.
            <div className="mt-3 rounded-md border border-dashed p-2.5">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Sourced from these check-ins — cross-check the note above against the raw values here
              </p>
              <ul className="flex flex-col gap-1">
                {note.sourceLogs.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{log.dateLabel}</span>
                    <SourceBadge source={log.source} />
                    <span>
                      Pain {log.pain}/10 · Nausea {log.nausea}/10 · Fatigue {log.fatigue}/10 · Fever {log.fever.toFixed(1)}°F
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!note && !error && (
        <p className="text-xs text-muted-foreground">
          Synthesizes recent check-ins and active alert reasons into a formatted note for EHR copy-paste. Every
          generated note starts as an unreviewed draft.
        </p>
      )}
    </div>
  );
}
