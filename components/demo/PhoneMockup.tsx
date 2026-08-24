import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A restrained SMS-thread mockup — no bezels/notches/gloss, just enough
// framing to read as "a phone" without competing with the real content
// inside it. Reused for both the patient and caregiver message beats in
// app/demo/DemoClient.tsx.
export function PhoneMockup({
  contactName,
  contactSub,
  children,
  className,
}: {
  contactName: string;
  contactSub: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[320px]", className)}>
      <div className="rounded-[1.75rem] border border-border bg-card p-1.5 ring-1 ring-foreground/10">
        <div className="overflow-hidden rounded-[1.4rem] bg-muted/30">
          <div className="flex flex-col items-center gap-0.5 border-b bg-card px-4 py-3">
            <span className="text-sm font-medium">{contactName}</span>
            <span className="text-[11px] text-muted-foreground">{contactSub}</span>
          </div>
          <div className="flex min-h-[150px] flex-col justify-end gap-2 p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SmsBubble({
  text,
  timestamp,
  pending,
}: {
  text: string;
  timestamp?: string;
  pending?: boolean;
}) {
  return (
    <div className={cn("flex max-w-[88%] flex-col gap-0.5 self-start", pending && "opacity-60")}>
      <div className="rounded-2xl rounded-bl-sm bg-secondary px-3 py-2 text-[13px] leading-snug text-secondary-foreground">
        {text}
      </div>
      {timestamp && <span className="pl-1 text-[10px] text-muted-foreground">{timestamp}</span>}
    </div>
  );
}
