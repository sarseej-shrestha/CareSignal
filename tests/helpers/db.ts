import { prisma } from "@/lib/db";

export async function resetDb() {
  await prisma.riskAlert.deleteMany();
  await prisma.soapNote.deleteMany();
  await prisma.symptomLog.deleteMany();
  await prisma.caregiverLog.deleteMany();
  await prisma.caregiver.deleteMany();
  await prisma.patient.deleteMany();
}

interface PatientOverrides {
  mrn?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  cancerType?: string;
  chemoCycle?: string;
  parish?: string;
  preferredLanguage?: string;
  treatmentFrequency?: string;
}

export async function seedTestPatient(overrides: PatientOverrides = {}) {
  return prisma.patient.create({
    data: {
      mrn: `TEST-${Math.random().toString(36).slice(2, 8)}`,
      firstName: "Test",
      lastName: "Patient",
      phone: `+1985555${Math.floor(1000 + Math.random() * 8999)}`,
      cancerType: "Breast cancer",
      chemoCycle: "Cycle 1 of 6",
      parish: "Terrebonne",
      ...overrides,
    },
  });
}

interface CaregiverOverrides {
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

export async function seedTestCaregiver(patientId: string, overrides: CaregiverOverrides = {}) {
  return prisma.caregiver.create({
    data: {
      firstName: "Test",
      lastName: "Caregiver",
      phone: `+1985555${Math.floor(1000 + Math.random() * 8999)}`,
      relationship: "Spouse",
      patientId,
      ...overrides,
    },
  });
}
