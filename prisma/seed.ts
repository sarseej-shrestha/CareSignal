// Seed data for CareSignal demos. Patients are grounded in real Louisiana
// geography (Terrebonne / Lafourche parishes, 985 area code) and real clinical
// framing (PRO-CTCAE symptom grades, 100.4°F neutropenic fever threshold).
//
// Run: npx tsx prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import { assessRisk } from "../lib/risk";
import type { DailySymptoms } from "../lib/riskEngine";

const prisma = new PrismaClient();

function daysAgo(n: number, hour = 8): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

interface SeedSymptomDay {
  daysAgo: number;
  pain: number;
  nausea: number;
  fatigue: number;
  fever: number;
  source?: "PATIENT_SMS" | "CAREGIVER_SMS" | "WEB";
  rawSmsText?: string;
  parsedByAi?: boolean;
}

interface SeedCaregiverDay {
  daysAgo: number;
  patientStatus: number;
  copingScore: number;
  rawSmsText?: string;
}

interface SeedPatient {
  mrn: string;
  firstName: string;
  lastName: string;
  phone: string;
  cancerType: string;
  chemoCycle: string;
  parish: string;
  logs: SeedSymptomDay[];
  caregiver?: {
    firstName: string;
    lastName: string;
    phone: string;
    relationship: string;
    logs: SeedCaregiverDay[];
  };
}

const patients: SeedPatient[] = [
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
];

async function main() {
  console.log("Clearing existing data...");
  await prisma.riskAlert.deleteMany();
  await prisma.symptomLog.deleteMany();
  await prisma.caregiverLog.deleteMany();
  await prisma.caregiver.deleteMany();
  await prisma.patient.deleteMany();

  for (const p of patients) {
    console.log(`Seeding ${p.firstName} ${p.lastName} (${p.parish})...`);

    const patient = await prisma.patient.create({
      data: {
        mrn: p.mrn,
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        cancerType: p.cancerType,
        chemoCycle: p.chemoCycle,
        parish: p.parish,
      },
    });

    for (const log of p.logs) {
      await prisma.symptomLog.create({
        data: {
          patientId: patient.id,
          pain: log.pain,
          nausea: log.nausea,
          fatigue: log.fatigue,
          fever: log.fever,
          rawSmsText: log.rawSmsText,
          parsedByAi: log.parsedByAi ?? false,
          source: log.source ?? "PATIENT_SMS",
          createdAt: daysAgo(log.daysAgo),
        },
      });
    }

    // Compute risk from the full chronological history (oldest first).
    const history: DailySymptoms[] = p.logs
      .slice()
      .sort((a, b) => b.daysAgo - a.daysAgo)
      .map((l) => ({ pain: l.pain, nausea: l.nausea, fatigue: l.fatigue, fever: l.fever, createdAt: daysAgo(l.daysAgo) }));

    const assessment = assessRisk(history);

    await prisma.patient.update({
      where: { id: patient.id },
      data: { riskStatus: assessment.level, riskScore: assessment.modelProb },
    });

    if (assessment.level === "YELLOW" || assessment.level === "RED") {
      await prisma.riskAlert.create({
        data: {
          patientId: patient.id,
          level: assessment.level,
          reasons: JSON.stringify(assessment.reasons),
          modelProb: assessment.modelProb,
          status: "OPEN",
        },
      });
    }

    if (p.caregiver) {
      const caregiver = await prisma.caregiver.create({
        data: {
          firstName: p.caregiver.firstName,
          lastName: p.caregiver.lastName,
          phone: p.caregiver.phone,
          relationship: p.caregiver.relationship,
          patientId: patient.id,
        },
      });

      let lastLog: SeedCaregiverDay | undefined;
      for (const log of p.caregiver.logs) {
        await prisma.caregiverLog.create({
          data: {
            caregiverId: caregiver.id,
            patientStatus: log.patientStatus,
            copingScore: log.copingScore,
            rawSmsText: log.rawSmsText,
            createdAt: daysAgo(log.daysAgo, 19), // caregivers tend to check in evenings
          },
        });
        lastLog = log;
      }

      if (lastLog && lastLog.copingScore <= 2) {
        const recentLow = p.caregiver.logs.filter((l) => l.daysAgo <= 2 && l.copingScore <= 2).length;
        await prisma.riskAlert.create({
          data: {
            patientId: patient.id,
            level: "CAREGIVER_BURDEN",
            reasons: JSON.stringify([
              `Caregiver coping score ${lastLog.copingScore}/5 ("overwhelmed") — ${recentLow} of last 3 check-ins at or below threshold`,
              "Caregiver free-text check-in flags exhaustion and burnout risk",
            ]),
            modelProb: null,
            status: "OPEN",
          },
        });
      }
    }
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
