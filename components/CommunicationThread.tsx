import { AlertCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CommunicationMessageView {
  id: string;
  participant: "PATIENT" | "CAREGIVER";
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  sentByName: string | null;
  dateLabel: string;
}

// A simple chronological thread, not a chat UI — one row per message,
// sender/direction/timestamp/content always visible, nothing collapsible
// or hoverable-only. Inbound rows mirror what the EXISTING pipeline already
// recorded (lib/inbound.ts) — this component only renders, it never writes.
export function CommunicationThread({ messages }: { messages: CommunicationMessageView[] }) {
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {messages.map((m) => {
        const isOutbound = m.direction === "OUTBOUND";
        const failed = m.status === "FAILED";
        const who = isOutbound ? "Care team" : m.participant === "CAREGIVER" ? "Caregiver" : "Patient";
        return (
          <div
            key={m.id}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-3 text-sm",
              isOutbound ? "border-primary/25 bg-primary/5" : "bg-muted/30",
              failed && "border-destructive/40 bg-destructive/5"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {isOutbound ? (
                  <ArrowUpRight className="size-3.5 text-primary" />
                ) : (
                  <ArrowDownLeft className="size-3.5" />
                )}
                {who}
                {isOutbound && m.sentByName ? ` · ${m.sentByName}` : ""}
              </span>
              <span className="flex items-center gap-1.5">
                {failed && (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertCircle className="size-3" />
                    Not delivered
                  </span>
                )}
                {m.dateLabel}
              </span>
            </div>
            <p className="text-foreground/90">{m.body}</p>
          </div>
        );
      })}
    </div>
  );
}
