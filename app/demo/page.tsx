import type { Metadata } from "next";
import { DemoClient } from "./DemoClient";

export const metadata: Metadata = {
  title: "Try the demo — CareSignal",
  description: "Send a patient message and watch CareSignal detect risk, alert the care team, and draft a note.",
};

export default function DemoPage() {
  return <DemoClient demoModeEnabled={process.env.DEMO_MODE === "true"} />;
}
