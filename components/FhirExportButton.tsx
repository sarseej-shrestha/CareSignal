"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Downloads a FHIR-lite JSON bundle for this patient — a demonstration of
// interoperability thinking (real FHIR resource types, verified LOINC codes
// where available), not a certified integration. See lib/fhirExport.ts for
// the honest scope note.
export function FhirExportButton({ patientId, patientMrn }: { patientId: string; patientMrn: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ehr/export/${patientId}`);
      if (!res.ok) throw new Error("Export failed.");
      const bundle = await res.json();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `caresignal-fhir-lite-${patientMrn}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleExport} disabled={loading}>
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        Export FHIR-lite bundle
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
