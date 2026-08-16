// Seeds the database with the canonical demo patients (see lib/seedData.ts
// for the fixture data itself, shared with the DEMO_MODE fallback in
// lib/demoScenarios.ts).
//
// Run: npx tsx prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import { assessRisk } from "../lib/risk";
import type { DailySymptoms } from "../lib/riskEngine";
import { patients, daysAgo, type SeedCaregiverDay } from "../lib/seedData";
import { computeHospitalizationRisk } from "../lib/hospitalizationRisk";

const prisma = new PrismaClient();

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
        preferredLanguage: p.preferredLanguage ?? "en",
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

    const hosp = await computeHospitalizationRisk(patient.id);
    await prisma.patient.update({ where: { id: patient.id }, data: { hospitalizationRiskScore: hosp.score } });
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
