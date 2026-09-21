// Development fixtures only. prisma/seed.js remains reserved for DrugInteraction.
// Run from server/: $env:DEV_SEED_PASSWORD = 'your test password'; node prisma/devSeed.js
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcrypt';
import prisma from '../src/prismaClient.js';
import { dayWindow } from '../src/routes/dashboard/dayWindow.js';

// Also used by the integration test inside a transaction. Each run owns fresh
// accounts, so rerunning never resets or removes existing patient data.
export async function createDashboardFixtures(db, { password, now = new Date() }) {
  const suffix = randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const accounts = [];
  for (const [name, kind] of [['Demo Patient One', 'patient'], ['Demo Patient Two', 'patient-two'], ['Demo Caregiver', 'caregiver']]) {
    accounts.push(await db.user.create({ data: { fullName: name, email: `${kind}-${suffix}@example.test`,
      passwordHash, emailVerified: true, timezone: 'Asia/Kolkata',
      preferences: { create: { preferredNotificationChannel: 'in_app', timezone: 'Asia/Kolkata' } } },
      select: { id: true, fullName: true, email: true } }));
  }
  const [patient, secondPatient, caregiver] = accounts;
  const links = [];
  const medications = [];
  const schedules = [];
  const { start, end } = dayWindow(now, 'Asia/Kolkata');
  for (const [index, person] of [patient, secondPatient].entries()) {
    links.push(await db.caregiverPatientLink.create({ data: { patientId: person.id, caregiverId: caregiver.id,
      relationshipType: 'family', permissionLevel: index ? 'alerts_only' : 'view_only', status: 'active',
      invitedByUserId: person.id, linkedAt: now } }));
    const medication = await db.medication.create({ data: { patientId: person.id,
      medicineName: `Demo medicine ${index + 1} (test only)`, medicineForm: 'tablet', trackingType: 'countable',
      dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'Three times daily', startDate: start, addedVia: 'manual' } });
    medications.push(medication);
    for (const [position, status] of ['taken', 'missed', 'pending'].entries()) {
      const hour = [8, 13, 20][position];
      const schedule = await db.medicationSchedule.create({ data: { medicationId: medication.id,
        timeOfDay: new Date(`1970-01-01T${String(hour).padStart(2, '0')}:00:00Z`),
        daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } });
      schedules.push(schedule);
      const scheduledDatetime = new Date(start.getTime() + hour * 3600000);
      await db.doseLog.create({ data: { scheduleId: schedule.id, patientId: person.id, scheduledDatetime,
        status, ...(status === 'taken' ? { actualActionDatetime: scheduledDatetime, loggedByUserId: person.id } : {}) } });
    }
    await db.adherenceStat.create({ data: { patientId: person.id, periodType: 'daily',
      periodStartDate: start, periodEndDate: end, totalScheduledDoses: 3, takenCount: 1, missedCount: 1,
      skippedCount: 0, adherencePercentage: '33.33', generatedAt: now } });
    await db.medicineInventory.create({ data: { medicationId: medication.id, patientId: person.id,
      quantityUnit: 'tablets', quantityTotal: 30, quantityRemaining: 6, estimatedUsagePerDose: 1,
      refillThreshold: 9, refillAmount: 30, estimatedRunoutDate: new Date(now.getTime() + 2 * 86400000) } });
  }
  return { patient, secondPatient, caregiver, links, medications, schedules };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.NODE_ENV === 'production') throw new Error('Development seed is disabled in production.');
    const password = process.env.DEV_SEED_PASSWORD;
    if (!password || password.length < 12) throw new Error('Set DEV_SEED_PASSWORD to a test password of at least 12 characters.');
    const fixtures = await prisma.$transaction((db) => createDashboardFixtures(db, { password }), { timeout: 30000 });
    console.log(JSON.stringify({ message: 'Fresh development accounts created. Log in with DEV_SEED_PASSWORD.',
      patient: fixtures.patient, secondPatient: fixtures.secondPatient, caregiver: fixtures.caregiver,
      links: fixtures.links.map(({ id, patientId, caregiverId, permissionLevel }) => ({ id, patientId, caregiverId, permissionLevel })) }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
