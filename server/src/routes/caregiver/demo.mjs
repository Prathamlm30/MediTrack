// Dev-only fixtures. Relationships are accepted through the real invitation API.
import { randomUUID, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../prismaClient.js';
import { requiredEnv } from '../../config/env.js';
import { reportWindow } from '../../jobs/weeklyReportData.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo fixtures are disabled in production.');
if (process.argv.length > 2) throw new Error('Usage: node src/routes/caregiver/demo.mjs');
try {
  const result = await prisma.$transaction(async (tx) => {
    const caregiver = await tx.user.create({ data: { fullName: 'Phase 9 Demo Caregiver',
      email: `phase9-caregiver-${randomUUID()}@example.test`, emailVerified: true,
      preferences: { create: { preferredNotificationChannel: 'in_app' } } } });
    const accessToken = (user) => jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), {
      subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', algorithm: 'HS256', expiresIn: '1h',
    });
    const window = reportWindow();
    const result = { caregiverId: caregiver.id, caregiverToken: accessToken(caregiver), window, patients: [] };
    for (const [index, statuses] of [['taken', 'taken', 'taken', 'missed', 'missed', 'skipped'], ['taken', 'missed']].entries()) {
      const patient = await tx.user.create({ data: { fullName: `Phase 9 Demo Patient ${index + 1}`,
        email: `phase9-patient-${randomUUID()}@example.test`, emailVerified: true } });
      const medication = await tx.medication.create({ data: { patientId: patient.id,
        medicineName: `Demo medicine ${index + 1}`, medicineForm: 'tablet', trackingType: 'countable',
        dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'daily', startDate: window.start, addedVia: 'manual' } });
      const schedule = await tx.medicationSchedule.create({ data: { medicationId: medication.id,
        timeOfDay: new Date('1970-01-01T08:00:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } });
      const doseLogs = [];
      for (const [i, status] of statuses.entries()) doseLogs.push(await tx.doseLog.create({ data: {
        patientId: patient.id, scheduleId: schedule.id, status,
        scheduledDatetime: new Date(window.start.getTime() + (i + 1) * 3600000),
      } }));
      const adherenceStat = await tx.adherenceStat.create({ data: { patientId: patient.id, periodType: 'daily',
        periodStartDate: new Date(doseLogs[0].scheduledDatetime.toISOString().slice(0, 10)),
        periodEndDate: new Date(doseLogs[0].scheduledDatetime.toISOString().slice(0, 10)),
        totalScheduledDoses: statuses.length, takenCount: index === 0 ? 3 : 1, missedCount: index === 0 ? 2 : 1,
        skippedCount: index === 0 ? 1 : 0, adherencePercentage: 50 } });
      const invitation = await tx.invitation.create({ data: { inviterUserId: patient.id,
        inviteeEmail: caregiver.email, proposedRole: 'caregiver', relationshipType: 'family',
        inviteToken: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3600000) } });
      result.patients.push({ id: patient.id, token: accessToken(patient), scheduleId: schedule.id,
        invitationToken: invitation.inviteToken, doseLogs, adherenceStat });
    }
    return result;
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
