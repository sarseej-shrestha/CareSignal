// Swaps a seeded patient's (and optionally their caregiver's) phone number
// for a real, verified number — needed to demo live inbound SMS on a
// Twilio TRIAL account, which can only exchange messages with numbers
// you've explicitly verified as caller IDs in the Twilio console (see
// docs/pitch-notes.md's Twilio section for the verification steps
// themselves; this script only does the database side).
//
// The seeded phone numbers (+19855550142 etc., see lib/seedData.ts) are
// fake and will never work against a real Twilio number, trial or paid —
// swap in a real verified number here before attempting a live demo.
//
// Usage:
//   npx tsx scripts/set-live-demo-number.ts <mrn> <patientPhoneE164> [caregiverPhoneE164]
//
// Example:
//   npx tsx scripts/set-live-demo-number.ts OCH-70143 +19855551234
//   npx tsx scripts/set-live-demo-number.ts OCH-70146 +19855551234 +19855555678

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function assertE164(label: string, value: string) {
  if (!/^\+\d{10,15}$/.test(value)) {
    throw new Error(`${label} must be E.164 format (e.g. +19855551234), got: ${value}`);
  }
}

async function main() {
  const [mrn, patientPhone, caregiverPhone] = process.argv.slice(2);

  if (!mrn || !patientPhone) {
    console.error("Usage: npx tsx scripts/set-live-demo-number.ts <mrn> <patientPhoneE164> [caregiverPhoneE164]");
    console.error("Example: npx tsx scripts/set-live-demo-number.ts OCH-70143 +19855551234");
    process.exit(1);
  }

  assertE164("patient phone", patientPhone);
  if (caregiverPhone) assertE164("caregiver phone", caregiverPhone);

  const patient = await prisma.patient.findUnique({ where: { mrn }, include: { caregiver: true } });
  if (!patient) {
    console.error(`No patient found with MRN ${mrn}. Check lib/seedData.ts for valid MRNs.`);
    process.exit(1);
  }

  await prisma.patient.update({ where: { id: patient.id }, data: { phone: patientPhone } });
  console.log(`Updated ${patient.firstName} ${patient.lastName} (${mrn}) phone -> ${patientPhone}`);

  if (caregiverPhone) {
    if (!patient.caregiver) {
      console.error(`${patient.firstName} ${patient.lastName} has no caregiver in the seeded data — nothing to update for the caregiver phone.`);
      process.exit(1);
    }
    await prisma.caregiver.update({ where: { id: patient.caregiver.id }, data: { phone: caregiverPhone } });
    console.log(`Updated caregiver ${patient.caregiver.firstName} ${patient.caregiver.lastName} phone -> ${caregiverPhone}`);
  }

  console.log("\nReminder: this real number still needs to be verified as a caller ID in the Twilio console");
  console.log("if the Twilio project is on a trial account — see docs/pitch-notes.md.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
