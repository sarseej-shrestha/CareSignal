// Shared fixture data — the canonical demo patients, grounded in real
// Louisiana geography (Terrebonne / Lafourche parishes, 985 area code) and
// real clinical framing (PRO-CTCAE symptom grades, 100.4°F neutropenic fever
// threshold). Used by prisma/seed.ts (full database seed) and
// lib/demoScenarios.ts (the DEMO_MODE fallback, which replays a single
// patient's final check-in live rather than just bulk-inserting it) — kept
// in one place so the two can't drift apart.

export function daysAgo(n: number, hour = 8): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);

  // Clamp to "now" if this computed timestamp would land in the future.
  // Found via testing: if the seed script runs before `hour` (e.g. seeded
  // at 2am, "day 0" defaults to "today at 8am"), the seeded day-0 entry
  // gets a timestamp LATER than a live SMS sent in between — so the risk
  // engine picks the stale seeded entry as "most recent" over the real live
  // message and silently computes the wrong risk level. No error, no
  // crash, just a quietly wrong answer, which is worse. Live-recorded logs
  // (lib/inbound.ts) aren't affected — they use Prisma's real now() default
  // — only this fixture-data helper needed the guard.
  const now = new Date();
  return d > now ? now : d;
}

export interface SeedSymptomDay {
  daysAgo: number;
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  source?: "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB";
  rawSmsText?: string;
  parsedByAi?: boolean;
}

export interface SeedCaregiverDay {
  daysAgo: number;
  patientStatus: number;
  copingScore: number;
  rawSmsText?: string;
}

export interface SeedPatient {
  mrn: string;
  firstName: string;
  lastName: string;
  phone: string;
  cancerType: string;
  chemoCycle: string;
  parish: string;
  preferredLanguage?: "en" | "fr";
  logs: SeedSymptomDay[];
  caregiver?: {
    firstName: string;
    lastName: string;
    phone: string;
    relationship: string;
    logs: SeedCaregiverDay[];
  };
}

export const patients: SeedPatient[] = [
  {
    // Stable, no caregiver — baseline GREEN case.
    mrn: "OCH-70142",
    firstName: "Marguerite",
    lastName: "Boudreaux",
    phone: "+19855550142",
    cancerType: "Breast cancer",
    chemoCycle: "Cycle 3 of 6",
    parish: "Terrebonne",
    logs: [
      { daysAgo: 6, pain: 1, nausea: 1, fatigue: 3, fever: 98.3 },
      { daysAgo: 5, pain: 2, nausea: 1, fatigue: 3, fever: 98.4 },
      { daysAgo: 4, pain: 1, nausea: 2, fatigue: 4, fever: 98.2 },
      { daysAgo: 3, pain: 2, nausea: 1, fatigue: 3, fever: 98.5 },
      { daysAgo: 2, pain: 1, nausea: 1, fatigue: 3, fever: 98.3 },
      { daysAgo: 1, pain: 2, nausea: 2, fatigue: 4, fever: 98.4 },
      { daysAgo: 0, pain: 1, nausea: 1, fatigue: 3, fever: 98.4 },
    ],
  },
  {
    // Headline escalation arc: climbing symptoms into a neutropenic fever — RED.
    mrn: "OCH-70143",
    firstName: "Michael",
    lastName: "Naquin",
    phone: "+19855550143",
    cancerType: "Colorectal cancer",
    chemoCycle: "Cycle 2 of 8",
    parish: "Lafourche",
    logs: [
      { daysAgo: 6, pain: 2, nausea: 2, fatigue: 4, fever: 98.4 },
      { daysAgo: 5, pain: 2, nausea: 2, fatigue: 4, fever: 98.5 },
      { daysAgo: 4, pain: 2, nausea: 3, fatigue: 4, fever: 98.4 },
      { daysAgo: 3, pain: 3, nausea: 3, fatigue: 5, fever: 98.8 },
      { daysAgo: 2, pain: 5, nausea: 5, fatigue: 6, fever: 99.6 },
      {
        daysAgo: 1,
        pain: 6,
        nausea: 6,
        fatigue: 7,
        fever: 100.2,
        rawSmsText: "6,6,7,100.2",
      },
      {
        daysAgo: 0,
        pain: 7,
        nausea: 6,
        fatigue: 8,
        fever: 101.3,
        rawSmsText: "7,6,8,101.3",
      },
    ],
  },
  {
    // Moderate trend escalation — YELLOW via 3-day trend delta, no fever.
    mrn: "OCH-70144",
    firstName: "Denise",
    lastName: "Guidry",
    phone: "+19855550144",
    cancerType: "Non-small cell lung cancer",
    chemoCycle: "Cycle 4 of 6",
    parish: "Terrebonne",
    logs: [
      { daysAgo: 5, pain: 2, nausea: 2, fatigue: 4, fever: 98.4 },
      { daysAgo: 4, pain: 2, nausea: 3, fatigue: 4, fever: 98.3 },
      { daysAgo: 3, pain: 3, nausea: 3, fatigue: 5, fever: 98.6 },
      { daysAgo: 2, pain: 3, nausea: 2, fatigue: 5, fever: 98.4 },
      { daysAgo: 1, pain: 4, nausea: 3, fatigue: 5, fever: 98.5 },
      {
        daysAgo: 0,
        pain: 7,
        nausea: 4,
        fatigue: 6,
        fever: 98.7,
        rawSmsText: "feeling a lot worse today, pain's up a lot and I'm just wiped out, no fever though",
        parsedByAi: true,
      },
    ],
  },
  {
    // Stable patient WITH a caregiver who is coping fine — contrast case.
    mrn: "OCH-70145",
    firstName: "Anthony",
    lastName: "Pitre",
    phone: "+19855550145",
    cancerType: "Prostate cancer",
    chemoCycle: "Cycle 1 of 6",
    parish: "Lafourche",
    logs: [
      { daysAgo: 6, pain: 1, nausea: 0, fatigue: 3, fever: 98.3 },
      { daysAgo: 5, pain: 1, nausea: 1, fatigue: 3, fever: 98.2 },
      { daysAgo: 4, pain: 2, nausea: 0, fatigue: 3, fever: 98.4 },
      { daysAgo: 3, pain: 1, nausea: 1, fatigue: 3, fever: 98.3 },
      { daysAgo: 2, pain: 1, nausea: 0, fatigue: 2, fever: 98.5 },
      { daysAgo: 1, pain: 2, nausea: 1, fatigue: 3, fever: 98.3 },
      { daysAgo: 0, pain: 1, nausea: 0, fatigue: 3, fever: 98.4 },
    ],
    caregiver: {
      firstName: "Marcus",
      lastName: "Pitre",
      phone: "+19855550245",
      relationship: "Son",
      logs: [
        { daysAgo: 6, patientStatus: 4, copingScore: 5 },
        { daysAgo: 5, patientStatus: 4, copingScore: 4 },
        { daysAgo: 4, patientStatus: 5, copingScore: 5 },
        { daysAgo: 3, patientStatus: 4, copingScore: 4 },
        { daysAgo: 2, patientStatus: 5, copingScore: 5 },
        { daysAgo: 1, patientStatus: 4, copingScore: 4 },
        { daysAgo: 0, patientStatus: 4, copingScore: 5 },
      ],
    },
  },
  {
    // Headline caregiver-burden case: patient's OWN clinical risk stays
    // moderate/YELLOW while the caregiver's coping score collapses — the
    // burden flag is a distinct signal, not a mirror of patient severity.
    mrn: "OCH-70146",
    firstName: "Ruth",
    lastName: "Trahan",
    phone: "+19855550146",
    cancerType: "Pancreatic cancer",
    chemoCycle: "Cycle 5 of 6",
    parish: "Terrebonne",
    logs: [
      { daysAgo: 6, pain: 3, nausea: 3, fatigue: 5, fever: 98.4 },
      { daysAgo: 5, pain: 3, nausea: 3, fatigue: 5, fever: 98.3 },
      { daysAgo: 4, pain: 4, nausea: 3, fatigue: 5, fever: 98.5 },
      { daysAgo: 3, pain: 4, nausea: 4, fatigue: 6, fever: 98.4 },
      { daysAgo: 2, pain: 5, nausea: 4, fatigue: 6, fever: 98.6 },
      { daysAgo: 1, pain: 5, nausea: 4, fatigue: 6, fever: 98.4 },
      { daysAgo: 0, pain: 5, nausea: 5, fatigue: 6, fever: 98.5 },
    ],
    caregiver: {
      firstName: "Angela",
      lastName: "Trahan",
      phone: "+19855550246",
      relationship: "Daughter",
      logs: [
        { daysAgo: 6, patientStatus: 4, copingScore: 4 },
        { daysAgo: 5, patientStatus: 4, copingScore: 3 },
        { daysAgo: 4, patientStatus: 3, copingScore: 3 },
        { daysAgo: 3, patientStatus: 3, copingScore: 2 },
        { daysAgo: 2, patientStatus: 3, copingScore: 2 },
        {
          daysAgo: 1,
          patientStatus: 2,
          copingScore: 1,
          rawSmsText:
            "I don't know how much longer I can keep doing this on top of my own job. I'm exhausted.",
        },
        {
          daysAgo: 0,
          patientStatus: 3,
          copingScore: 2,
          rawSmsText: "A little better today but still really overwhelmed.",
        },
      ],
    },
  },
  {
    // Mixed-source case: wife relays symptoms by SMS on days James is too
    // fatigued to text himself — demonstrates PATIENT_SMS vs CAREGIVER_SMS
    // source labeling on the same patient's timeline.
    mrn: "OCH-70147",
    firstName: "James",
    lastName: "Chauvin",
    phone: "+19855550147",
    cancerType: "Acute myeloid leukemia",
    chemoCycle: "Cycle 2 of 4",
    parish: "Lafourche",
    logs: [
      { daysAgo: 5, pain: 2, nausea: 2, fatigue: 4, fever: 98.3, source: "PATIENT_SMS", rawSmsText: "2,2,4,98.3" },
      { daysAgo: 4, pain: 2, nausea: 3, fatigue: 5, fever: 98.4, source: "PATIENT_SMS", rawSmsText: "2,3,5,98.4" },
      {
        daysAgo: 3,
        pain: 3,
        nausea: 3,
        fatigue: 6,
        fever: 98.5,
        source: "CAREGIVER_SMS",
        parsedByAi: true,
        rawSmsText:
          "He's too tired to text today, this is Patricia — he says pain is about a 3, still nauseous, really wiped out, no fever that I can tell.",
      },
      { daysAgo: 2, pain: 2, nausea: 2, fatigue: 4, fever: 98.3, source: "PATIENT_SMS", rawSmsText: "2,2,4,98.3" },
      { daysAgo: 1, pain: 2, nausea: 1, fatigue: 3, fever: 98.2, source: "PATIENT_SMS", rawSmsText: "2,1,3,98.2" },
      {
        daysAgo: 0,
        pain: 2,
        nausea: 2,
        fatigue: 4,
        fever: 98.4,
        source: "CAREGIVER_SMS",
        parsedByAi: true,
        rawSmsText: "Quick update from Patricia, James is resting but doing okay today.",
      },
    ],
    caregiver: {
      firstName: "Patricia",
      lastName: "Chauvin",
      phone: "+19855550247",
      relationship: "Wife",
      logs: [
        { daysAgo: 5, patientStatus: 4, copingScore: 4 },
        { daysAgo: 4, patientStatus: 3, copingScore: 4 },
        { daysAgo: 3, patientStatus: 3, copingScore: 3 },
        { daysAgo: 2, patientStatus: 4, copingScore: 4 },
        { daysAgo: 1, patientStatus: 4, copingScore: 4 },
        { daysAgo: 0, patientStatus: 4, copingScore: 4 },
      ],
    },
  },
  {
    // French-speaking patient — demonstrates preferredLanguage-driven
    // outbound replies and freeform-French inbound parsing. Last entry is
    // real freeform French text (not a translated placeholder) so the
    // freeform-AI path can be demoed/verified against it directly.
    mrn: "OCH-70148",
    firstName: "Émile",
    lastName: "Thibodeaux",
    phone: "+19855550148",
    cancerType: "Multiple myeloma",
    chemoCycle: "Cycle 3 of 6",
    parish: "Lafourche",
    preferredLanguage: "fr",
    logs: [
      { daysAgo: 5, pain: 1, nausea: 1, fatigue: 2, fever: 98.3, rawSmsText: "1,1,2,98.3" },
      { daysAgo: 4, pain: 1, nausea: 2, fatigue: 3, fever: 98.4, rawSmsText: "1,2,3,98.4" },
      { daysAgo: 3, pain: 2, nausea: 2, fatigue: 3, fever: 98.3, rawSmsText: "2,2,3,98.3" },
      { daysAgo: 2, pain: 2, nausea: 2, fatigue: 4, fever: 98.5, rawSmsText: "2,2,4,98.5" },
      { daysAgo: 1, pain: 2, nausea: 3, fatigue: 4, fever: 98.4, rawSmsText: "2,3,4,98.4" },
      {
        daysAgo: 0,
        pain: 1,
        nausea: 3,
        fatigue: 6,
        fever: 98.6,
        rawSmsText: "Je me sens assez fatigué aujourd'hui, un peu de nausée, mais pas de fièvre, heureusement.",
        parsedByAi: true,
      },
    ],
  },
];
