import { MessageSquare, Sparkles, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type LogSource = "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB";

const CONFIG: Record<LogSource, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  PATIENT_SMS: { label: "Patient SMS", icon: User },
  CAREGIVER_SMS: { label: "Caregiver SMS", icon: Users },
  WEB: { label: "Web", icon: MessageSquare },
};

export function SourceBadge({ source, parsedByAi }: { source: LogSource; parsedByAi?: boolean }) {
  const { label, icon: Icon } = CONFIG[source];
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
          source === "CAREGIVER_SMS" && "border-[var(--viz-caregiver-burden)]/30 text-[var(--viz-caregiver-burden)]"
        )}
      >
        <Icon className="size-3" />
        {label}
      </span>
      {parsedByAi && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--viz-series-fatigue)]/35 bg-[var(--viz-series-fatigue)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--viz-series-fatigue)]">
          <Sparkles className="size-3" />
          AI parsed
        </span>
      )}
    </span>
  );
}
