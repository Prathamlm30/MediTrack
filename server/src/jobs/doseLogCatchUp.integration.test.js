import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import prisma from '../prismaClient.js';
import { requiredEnv } from '../config/env.js';
import { runDoseLogJob, startDoseLogJob } from './doseLogJob.js';
import { runEscalationJob } from './escalationJob.js';
import { runAdherenceJob } from './adherenceJob.js';
import { patientDate, localDatetime, shiftDate } from './adherenceCalendar.js';

test('today catch-up, schedule writes and late-created escalation exclusion', async () => {
  const ids = [];
  let server, job;
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  const now = new Date();
  // Keep the patient's current local hour at noon regardless of test wall time.
  const offset = 12 - now.getUTCHours();
  const timezone = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  const today = patientDate(now, timezone);
  const clock = (time) => localDatetime(today, `${time}:00`, timezone);
  try {
    const patient = await prisma.user.create({ data: { fullName: 'Catch-up patient', email: `${randomUUID()}@example.test`, emailVerified: true, timezone } });
    ids.push(patient.id);
    const caregiver = await prisma.user.create({ data: { fullName: 'Catch-up caregiver', email: `${randomUUID()}@example.test`, emailVerified: true } });
    ids.push(caregiver.id);
    await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: caregiver.id, relationshipType: 'family', permissionLevel: 'full_access', status: 'active' } });
    const medication = await prisma.medication.create({ data: { patientId: patient.id, medicineName: 'Catch-up fixture', medicineForm: 'tablet', trackingType: 'countable', dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'daily', startDate: new Date(shiftDate(today, -2)), addedVia: 'manual' } });
    await prisma.medicineInventory.create({ data: { patientId: patient.id, medicationId: medication.id, quantityUnit: 'tablet', quantityTotal: 20, quantityRemaining: 20, refillThreshold: 1, refillAmount: 20 } });
    const makeSchedule = (time, extra = {}) => prisma.medicationSchedule.create({ data: { medicationId: medication.id,
      timeOfDay: new Date(`1970-01-01T${time}:00Z`), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1,
      createdAt: new Date(shiftDate(today, -1)), ...extra } });
    const morning = await makeSchedule('08:00');
    await makeSchedule('09:00', { isActive: false });
    await makeSchedule('10:00', { daysOfWeek: String((new Date(today).getUTCDay() + 1) % 7) });
    job = startDoseLogJob({ patientId: patient.id, now, schedule: '0 0 1 1 *' });
    assert.equal((await job.ready).created, 1); // startup after missed midnight
    assert.equal((await job.tick()).created, 0);
    const late = await prisma.doseLog.findFirstOrThrow({ where: { scheduleId: morning.id } });
    assert.ok(late.createdAt > late.scheduledDatetime);
    assert.equal(late.scheduledDatetime.toISOString(), clock('08:00').toISOString());
    assert.equal(await prisma.doseLog.count({ where: { patientId: patient.id } }), 1);
    const recovered = await makeSchedule('11:00');
    assert.equal((await job.tick()).created, 1); // another missing schedule on a later tick
    assert.equal((await job.tick()).created, 0);
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: recovered.id } }), 1);
    await makeSchedule('08:00', { createdAt: clock('15:00') });
    const evening = await makeSchedule('18:00', { createdAt: clock('15:00') });
    assert.equal((await runDoseLogJob({ patientId: patient.id, now: clock('15:00') })).created, 1);
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: evening.id } }), 1);
    assert.equal(await prisma.doseLog.count({ where: { patientId: patient.id, scheduledDatetime: { lt: clock('00:00') } } }), 0);
    const normal = await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: morning.id,
      scheduledDatetime: clock('07:00'), createdAt: clock('06:00') } });
    const first = await runEscalationJob({ patientId: patient.id, now: clock('16:00') });
    assert.equal(first.level1Created, 1);
    await prisma.escalationAlert.updateMany({ where: { doseLogId: normal.id }, data: { triggeredAt: clock('08:00') } });
    const second = await runEscalationJob({ patientId: patient.id, now: clock('16:00') });
    assert.equal(second.level2Created, 1);
    assert.equal(await prisma.escalationAlert.count({ where: { doseLogId: late.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { relatedDoseLogId: late.id } }), 0);
    // Even a legacy L1 chain cannot produce L2 for a late-created dose.
    await prisma.escalationAlert.create({ data: { doseLogId: late.id, patientId: patient.id, escalationLevel: 1, triggeredAt: clock('08:00') } });
    assert.equal((await runEscalationJob({ patientId: patient.id, now: clock('16:00') })).notificationsCreated, 0);
    await runAdherenceJob({ patientId: patient.id, date: today, now: localDatetime(shiftDate(today, 1), '00:05:00', timezone) });
    const stat = await prisma.adherenceStat.findFirstOrThrow({ where: { patientId: patient.id, periodType: 'daily' } });
    assert.equal(stat.missedCount, stat.totalScheduledDoses);
    assert.equal((await prisma.doseLog.findUnique({ where: { id: late.id } })).status, 'pending');

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const token = jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { subject: String(patient.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m' });
    async function call(path, method, body, status = 200) {
      const response = await originalFetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      return data;
    }
    const path = `/medications/${medication.id}/schedules`;
    const created = await call(path, 'POST', { timeOfDay: '19:00', daysOfWeek: '0,1,2,3,4,5,6' }, 201);
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: created.id } }), 1);
    await call(`/schedules/${created.id}`, 'PATCH', { timeOfDay: '20:00' });
    await call(`/schedules/${created.id}`, 'PATCH', { timeOfDay: '20:00' });
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: created.id } }), 2);
    const past = await call(path, 'POST', { timeOfDay: '08:00', daysOfWeek: '0,1,2,3,4,5,6' }, 201);
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: past.id } }), 0);
    await call(`/dose-logs/${late.id}`, 'PATCH', { status: 'taken' });
    await call(`/dose-logs/${late.id}`, 'PATCH', { status: 'skipped' });
    await prisma.medicationSchedule.updateMany({ where: { medicationId: medication.id }, data: { isActive: false } });
    process.env.GEMINI_API_KEY = 'test-only';
    globalThis.fetch = async (url) => {
      assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify([
        { timeOfDay: '08:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 },
        { timeOfDay: '21:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 },
      ]) }] } }] });
    };
    const generated = await call(path + '/generate', 'POST', { frequencyText: 'twice daily' }, 201);
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: { in: generated.map((row) => row.id) } } }), 1);
    for (const status of ['completed', 'discontinued']) {
      await prisma.medication.update({ where: { id: medication.id }, data: { status } });
      assert.equal((await job.tick()).created, 0);
    }
    await prisma.medication.update({ where: { id: medication.id }, data: { status: 'active', endDate: new Date(shiftDate(today, -1)) } });
    assert.equal((await job.tick()).created, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    await job?.destroy();
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.escalationAlert.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.adherenceStat.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
