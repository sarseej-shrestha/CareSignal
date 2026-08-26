import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CareSignal — Catch problems before they become emergencies",
  description: "SMS-first remote symptom monitoring for rural Louisiana cancer care, with a separate caregiver-burden signal.",
};

// Inline (not next/script) and placed before body content specifically so it
// runs before first paint — applying .dark after hydration would flash light
// mode first. Tailwind's dark variant here is class-based (see globals.css),
// so without this the --viz-* dark tokens built in earlier sessions are
// unreachable dead CSS for anyone whose OS is in dark mode.
const THEME_INIT_SCRIPT = `
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.classList.add("dark");
  }
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
