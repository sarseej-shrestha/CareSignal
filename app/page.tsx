import Link from "next/link";
import { Activity, ExternalLink, FileText, ListChecks, MessageSquareText, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { PhoneMockup, SmsBubble } from "@/components/demo/PhoneMockup";

const STEPS = [
  {
    icon: MessageSquareText,
    title: "A message comes in",
    body: "A patient or their caregiver texts a plain phone number. Structured shorthand or their own words, in English, French, or Spanish.",
  },
  {
    icon: Activity,
    title: "CareSignal reads it",
    body: "Freeform text is parsed into symptom data. Hard clinical rules and a trained risk model both run against it.",
  },
  {
    icon: ListChecks,
    title: "Risk is triaged",
    body: "Clinical risk and caregiver burden are tracked as two separate signals on one prioritized queue.",
  },
  {
    icon: FileText,
    title: "A nurse reviews it",
    body: "The care team sees why a patient was flagged and can generate a draft clinical note in one click.",
  },
];

const DIFFERENTIATORS = [
  {
    title: "SMS only",
    body: "No app, no login, no data plan required. Works on any phone.",
  },
  {
    title: "Caregiver burden, tracked separately",
    body: "Most tools watch the patient only. CareSignal gives the caregiver their own channel and their own alert, never folded into the patient's score.",
  },
  {
    title: "A real two-layer risk engine",
    body: "Interpretable clinical rules set the safety floor. A trained classifier can escalate risk further on top of that, never lower it.",
  },
  {
    title: "AI drafts, a clinician decides",
    body: "Generated SOAP notes start as an unreviewed draft and stay labeled that way until a clinician signs off.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">CareSignal</span>
        </div>
        <a
          href="https://github.com/sarseej-shrestha/CareSignal"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-4" />
          GitHub
        </a>
      </header>

      <section className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-12 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-20">
        <div className="flex flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Catch problems before they become emergencies.
          </h1>
          <p className="max-w-md text-base text-muted-foreground">
            CareSignal helps care teams spot worsening symptoms between appointments so they can step in earlier.
            Chemotherapy patients and their caregivers check in daily by text message. No app, no login, no
            smartphone required.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" render={<Link href="/demo" />} className="px-6 text-base">
              Try the live demo
            </Button>
            <a
              href="https://github.com/sarseej-shrestha/CareSignal"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              View on GitHub
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Built for the Ochsner Health / ASCO healthcare hackathon, grounded in Terrebonne and Lafourche Parish,
            Louisiana.
          </p>
        </div>

        <PhoneMockup contactName="Denise Guidry" contactSub="985-555-0144">
          <SmsBubble text="feeling a lot worse today, pain's up a lot and I'm just wiped out, no fever though" />
        </PhoneMockup>
      </section>

      <section className="border-t">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <h2 className="text-lg font-semibold tracking-tight">How it works</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span className="flex size-6 items-center justify-center rounded-full border text-[11px]">
                    {i + 1}
                  </span>
                  <step.icon className="size-4 text-primary" />
                </div>
                <h3 className="text-sm font-medium">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-[var(--viz-caregiver-burden)]" />
            <h2 className="text-lg font-semibold tracking-tight">What makes it different</h2>
          </div>
          <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.title} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{d.title}</h3>
                <p className="text-sm text-muted-foreground">{d.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <RiskBadge level="RED" score={0.96} />
            <span>
              Rules alone would flag a moderate case like this YELLOW. The trained model reads the trend and pushes
              it to RED, live, in the demo.
            </span>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Not clinically validated against real patient outcomes. Built and trained on simulated data. Does not
            diagnose or replace a clinician&apos;s judgment.
          </p>
          <Button render={<Link href="/demo" />}>Try the live demo</Button>
        </div>
      </footer>
    </div>
  );
}
