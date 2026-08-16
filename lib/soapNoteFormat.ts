// Formats a SOAP note for export/copy with a status header that reflects
// CURRENT review status at format-time — never baked into the stored
// fullText at creation, since status can change after creation (via the
// review endpoint) and a stale "DRAFT" header surviving into a reviewed
// note would defeat the point. This is what makes it structurally
// difficult to paste an unreviewed note into an EHR without the disclaimer
// riding along with it — the copy button always calls this, never the raw
// fullText.

export interface FormattableSoapNote {
  fullText: string;
  status: "DRAFT" | "REVIEWED";
  reviewedAt: string | Date | null;
}

export function formatSoapNoteForExport(note: FormattableSoapNote): string {
  const header =
    note.status === "REVIEWED"
      ? `[Reviewed by clinician${note.reviewedAt ? " at " + new Date(note.reviewedAt).toLocaleString() : ""}]`
      : "[AI-GENERATED DRAFT — REQUIRES CLINICIAN REVIEW. Do not treat as a finalized clinical note until reviewed.]";

  return `${header}\n\n${note.fullText}`;
}
