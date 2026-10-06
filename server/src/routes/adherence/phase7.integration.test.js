import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import app from '../../app.js';
import prisma from '../../prismaClient.js';
import { requiredEnv } from '../../config/env.js';
import { runDoseLogJob } from '../../jobs/doseLogJob.js';
import { runAdherenceJob } from '../../jobs/adherenceJob.js';
import { runWeeklyAdherenceJob } from '../../jobs/weeklyAdherenceJob.js';
import { patientDate, shiftDate, localDatetime, dayBounds } from '../../jobs/adherenceCalendar.js';
import { calculateStats } from './service.js';

test('calendar conversion, DST and gap-day streaks', () => {
  assert.equal(localDatetime('2026-10-02', '08:30:00', 'Asia/Kolkata').toISOString(), '2026-10-02T03:00:00.000Z');
  assert.equal(localDatetime('2026-11-01', '01:30:00', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(localDatetime('2026-03-08', '02:30:00', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
  const bounds = dayBounds('2026-03-08', 'America/New_York');
  assert.equal(bounds.lt - bounds.gte, 23 * 3600000);
  const rows = ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02'].map((date) => ({ periodStartDate: new Date(date), totalScheduledDoses: 1, takenCount: 1 }));
  assert.deepEqual(calculateStats(rows, '2026-10-02'), { currentStreak: 2, bestStreak: 2, rolling7DayPercentage: 100, rolling30DayPercentage: 100 });
  assert.equal(calculateStats(rows, '2026-09-30').currentStreak, 0);
  assert.equal(calculateStats(rows, '2026-10-03').currentStreak, 0);
  assert.equal(calculateStats([{ periodStartDate: new Date('2026-10-02'), totalScheduledDoses: 0, takenCount: 0 }], '2026-10-02').currentStreak, 0);
  assert.equal(calculateStats([{ periodStartDate: new Date('2026-10-01'), totalScheduledDoses: 1, takenCount: 1 }, { periodStartDate: new Date('2026-10-02'), totalScheduledDoses: 9, takenCount: 0 }], '2026-10-02').rolling7DayPercentage, 10);
  console.log('Gap proof: Sep 28/29 perfect, Sep 30 absent, Oct 1/2 perfect => current=2, best=2; on gap day current=0.');
});

test('Phase 7 database/API atomicity, reruns, aggregation, permissions and CLI', async () => {
  const users = []; let server;
  const events = [];
  const oldRuntime = app.locals.scanRuntime;
  app.locals.scanRuntime = { emitStatsUpdated: (patientId, date) => events.push({ patientId, date }) };
  try {
    for (const name of ['Patient', 'Other', 'Caregiver']) users.push(await prisma.user.create({ data: { fullName: name, email: `phase7-${randomUUID()}@example.test`, emailVerified: true, timezone: 'Asia/Kolkata' } }));
    const [patient, other, caregiver] = users;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(path, method = 'GET', body, expected = 200, user = patient) {
      const token = user && jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m' });
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    }
    const today = patientDate(new Date(), patient.timezone);
    const med = await call('/medications', 'POST', { medicineName: 'Phase Seven Test', medicineForm: 'syrup', trackingType: 'volume_ml', dosageAmount: 5, dosageUnit: 'ml', frequencyText: 'daily', startDate: shiftDate(today, -30) }, 201);
    const medPath = `/medications/${med.id}`;
    // Pre-existing schedule with a missed generation, so concurrent jobs (rather
    // than the new schedule-write hook) must insert the single dose under test.
    const schedule = await prisma.medicationSchedule.create({ data: { medicationId: med.id,
      timeOfDay: new Date('1970-01-01T08:30:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 2.5,
      createdAt: new Date(shiftDate(today, -30)) } });
    const inventory = await call(medPath + '/inventory', 'POST', { quantityTotal: 20, refillThreshold: 2, refillAmount: 20 }, 201);
    const options = { patientId: patient.id, date: today };
    const generated = await Promise.all([runDoseLogJob(options), runDoseLogJob(options)]);
    assert.ok(generated.every((r) => !r.errors.length), JSON.stringify(generated));
    assert.equal(generated.reduce((sum, r) => sum + r.created, 0), 1);
    assert.equal((await runDoseLogJob(options)).created, 0);
    assert.equal(await prisma.doseLog.count({ where: { scheduleId: schedule.id } }), 1);
    // Other weekdays, inactive schedules and medication date bounds cannot produce doses.
    const otherDay = String((new Date(today).getUTCDay() + 1) % 7);
    const excluded = await call(medPath + '/schedules', 'POST', { timeOfDay: '10:00', daysOfWeek: otherDay, doseAmount: 1 }, 201);
    assert.equal((await runDoseLogJob(options)).created, 0);
    await call(`/schedules/${excluded.id}`, 'PATCH', { daysOfWeek: '0,1,2,3,4,5,6', isActive: false });
    assert.equal((await runDoseLogJob(options)).created, 0);
    assert.equal((await runDoseLogJob({ ...options, date: shiftDate(today, -31) })).created, 0);
    const dose = (await call('/dose-logs/today'))[0];
    assert.equal(dose.status, 'pending');
    assert.equal((await call(`/dose-logs?from=${today}&to=${today}&medicationId=${med.id}`)).length, 1);
    await Promise.all([call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'taken' }), call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'taken' })]);
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'taken' });
    assert.equal(Number((await call(medPath + '/inventory')).quantityRemaining), 17.5);
    assert.equal(events.length, 3); // One committed recompute per successful PATCH, including duplicates.
    assert.deepEqual(events[0], { patientId: patient.id, date: today });
    assert.equal((await call('/adherence/heatmap'))[today], 100);
    assert.equal((await call('/adherence/stats')).currentStreak, 1);
    const dailyWhere = { patientId: patient.id, periodType: 'daily', periodStartDate: new Date(today) };
    const immediate = await prisma.adherenceStat.findFirst({ where: dailyWhere });
    await runAdherenceJob(options);
    const batch = await prisma.adherenceStat.findFirst({ where: dailyWhere });
    const { generatedAt: ignoredImmediate, ...immediateValues } = immediate;
    const { generatedAt: ignoredBatch, ...batchValues } = batch;
    assert.deepEqual(immediateValues, batchValues);
    // Fail the stats write inside the real transaction: status and inventory
    // must roll back, and there must be no post-commit notification.
    const eventCount = events.length;
    const originalTransaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = (work, options) => originalTransaction(async (tx) => {
      const statClient = new Proxy(tx.adherenceStat, { get(target, key) {
        if (key === 'update') return async () => { throw new Error('Injected stats write failure'); };
        return target[key];
      } });
      return work(new Proxy(tx, { get(target, key) { return key === 'adherenceStat' ? statClient : target[key]; } }));
    }, options);
    try { await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' }, 500); }
    finally { prisma.$transaction = originalTransaction; }
    assert.equal(events.length, eventCount);
    assert.equal((await prisma.doseLog.findUnique({ where: { id: dose.id } })).status, 'taken');
    assert.deepEqual(await prisma.adherenceStat.findFirst({ where: dailyWhere }), batch);
    console.log('Duplicate taken PATCH proof: 20 -> 17.5 after two concurrent PATCHes and a sequential retry (doseAmount=2.5).');
    console.log('Generation proof: two concurrent runs plus a rerun created exactly one DoseLog.');
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' });
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'snoozed' });
    assert.equal(Number((await call(medPath + '/inventory')).quantityRemaining), 17.5);
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'taken' });
    assert.equal(Number((await call(medPath + '/inventory')).quantityRemaining), 15);
    const dailyRuns = await Promise.all([runAdherenceJob(options), runAdherenceJob(options)]);
    assert.ok(dailyRuns.every((r) => !r.errors.length), JSON.stringify(dailyRuns));
    const stats = await call('/adherence/stats');
    assert.equal(stats.currentStreak, 1);
    assert.equal(stats.rolling7DayPercentage, 100);
    assert.equal((await call('/adherence/heatmap?months=3'))[today], 100);
    assert.equal(await prisma.adherenceStat.count({ where: { patientId: patient.id, periodType: 'daily' } }), 1);
    // Missing inventory must roll the status/audit fields back as well.
    const second = await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: schedule.id, scheduledDatetime: localDatetime(shiftDate(today, -1), '08:30:00', patient.timezone) } });
    await prisma.medicineInventory.delete({ where: { id: inventory.id } });
    await call(`/dose-logs/${second.id}`, 'PATCH', { status: 'taken' }, 404);
    const unchanged = await prisma.doseLog.findUnique({ where: { id: second.id } });
    assert.equal(unchanged.status, 'pending');
    assert.equal(unchanged.actualActionDatetime, null);
    assert.equal(unchanged.loggedByUserId, null);
    await runAdherenceJob({ patientId: patient.id, date: shiftDate(today, -1) });
    const yesterday = await prisma.adherenceStat.findFirst({ where: { patientId: patient.id, periodStartDate: new Date(shiftDate(today, -1)) } });
    assert.equal(yesterday.missedCount, 1);
    assert.equal((await call('/adherence/stats')).rolling7DayPercentage, 50);
    console.log('Daily API proof: today heatmap=100%; today current streak=1; one pending dose yesterday gives rolling7DayPercentage=50%.');
    const weeklyRuns = await Promise.all([runWeeklyAdherenceJob(options), runWeeklyAdherenceJob(options)]);
    assert.ok(weeklyRuns.every((r) => !r.errors.length), JSON.stringify(weeklyRuns));
    assert.equal(await prisma.adherenceStat.count({ where: { patientId: patient.id, periodType: 'weekly' } }), 1);
    const week = await prisma.adherenceStat.findFirst({ where: { patientId: patient.id, periodType: 'weekly' } });
    const dailies = await prisma.adherenceStat.findMany({ where: { patientId: patient.id, periodType: 'daily', periodStartDate: { gte: week.periodStartDate, lte: week.periodEndDate } } });
    assert.equal(week.totalScheduledDoses, dailies.reduce((sum, r) => sum + r.totalScheduledDoses, 0));
    assert.equal(Number(week.adherencePercentage), Math.round(week.takenCount * 10000 / week.totalScheduledDoses) / 100);
    const lastWeek = await runWeeklyAdherenceJob({ patientId: patient.id, now: new Date('2026-10-07T12:00:00Z') });
    assert.deepEqual(lastWeek.errors, []);
    assert.ok(await prisma.adherenceStat.findFirst({ where: { patientId: patient.id, periodType: 'weekly', periodStartDate: new Date('2026-09-28') } }));
    for (const path of ['/dose-logs/today', '/dose-logs', '/adherence/stats', '/adherence/heatmap']) {
      await call(path, 'GET', undefined, 401, null);
      await call(`${path}?patientId=${patient.id}`, 'GET', undefined, 403, other);
    }
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' }, 403, other);
    const link = await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: caregiver.id, relationshipType: 'family', permissionLevel: 'view_only', status: 'active' } });
    await call(`/adherence/stats?patientId=${patient.id}`, 'GET', undefined, 200, caregiver);
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' }, 403, caregiver);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'alerts_only' } });
    await call(`/adherence/heatmap?patientId=${patient.id}`, 'GET', undefined, 403, caregiver);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'full_access' } });
    const edited = await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped', notes: 'with caregiver' }, 200, caregiver);
    assert.equal(edited.loggedByUserId, caregiver.id);
    await call('/adherence/heatmap?months=0', 'GET', undefined, 400);
    await call('/dose-logs?from=2026-02-30', 'GET', undefined, 400);
    await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'missed' }, 400);
    for (const [name, file] of [['generate', 'doseLogJob'], ['aggregate', 'adherenceJob'], ['weekly', 'weeklyAdherenceJob']]) {
      await call(`/dose-logs/jobs/${name}`, 'POST', { date: today });
      const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL(`../../jobs/${file}.js`, import.meta.url)), String(patient.id), today]);
      assert.deepEqual(JSON.parse(result.stdout).errors, []);
    }
    const oldMode = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await call('/dose-logs/jobs/generate', 'POST', {}, 404);
    } finally {
      if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    }
    console.log('All three authenticated manual routes and CLI job entry points verified.');
    // Use historical step boundaries and 00:30 local time so both today's date
    // and the UTC date would select the wrong step (or no step).
    const firstDate = shiftDate(today, -4);
    const secondDate = shiftDate(today, -2);
    const taperMed = await call('/medications', 'POST', { medicineName: 'Phase Seven Taper', medicineForm: 'tablet', trackingType: 'countable', dosageAmount: 10, dosageUnit: 'mg', frequencyText: 'taper daily', startDate: firstDate }, 201, other);
    const taperPath = `/medications/${taperMed.id}`;
    const taperSchedule = await call(taperPath + '/schedules', 'POST', {
      timeOfDay: '00:30', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 9,
      isTaperSchedule: true, taperDetails: [
        { fromDate: firstDate, toDate: shiftDate(secondDate, -1), doseAmount: 2 },
        { fromDate: secondDate, toDate: shiftDate(today, -1), doseAmount: 1 },
      ],
    }, 201, other);
    await prisma.medicationSchedule.update({ where: { id: taperSchedule.id }, data: { createdAt: new Date(shiftDate(firstDate, -1)) } });
    await call(taperPath + '/inventory', 'POST', { quantityTotal: 20, refillThreshold: 2, refillAmount: 20 }, 201, other);
    for (const [date, remaining] of [[firstDate, 18], [secondDate, 17]]) {
      assert.deepEqual(await runDoseLogJob({ patientId: other.id, date }), { created: 1, existing: 0, errors: [] });
      const [log] = await call(`/dose-logs?from=${date}&to=${date}&medicationId=${taperMed.id}`, 'GET', undefined, 200, other);
      assert.equal(log.scheduledDatetime.slice(0, 10), shiftDate(date, -1));
      assert.equal(Number(log.schedule.doseAmount), 9);
      await call(`/dose-logs/${log.id}`, 'PATCH', { status: 'taken' }, 200, other);
      assert.equal(Number((await call(taperPath + '/inventory', 'GET', undefined, 200, other)).quantityRemaining), remaining);
      await call(`/dose-logs/${log.id}`, 'PATCH', { status: 'taken' }, 200, other);
      assert.equal(Number((await call(taperPath + '/inventory', 'GET', undefined, 200, other)).quantityRemaining), remaining);
    }
    assert.equal((await runDoseLogJob({ patientId: other.id, date: today })).created, 0);
    const invalidLog = await prisma.doseLog.create({ data: { patientId: other.id, scheduleId: taperSchedule.id, scheduledDatetime: localDatetime(today, '00:30:00', other.timezone) } });
    const beforeGapEvents = events.length;
    const beforeGapStats = await prisma.adherenceStat.findMany({ where: { patientId: other.id } });
    const conflict = await call(`/dose-logs/${invalidLog.id}`, 'PATCH', { status: 'taken' }, 409, other);
    assert.equal(events.length, beforeGapEvents);
    assert.deepEqual(await prisma.adherenceStat.findMany({ where: { patientId: other.id } }), beforeGapStats);
    assert.ok(events.some((event) => event.patientId === other.id && event.date === firstDate));
    assert.ok(events.some((event) => event.patientId === other.id && event.date === secondDate));
    assert.match(conflict.error, /no taper step covers scheduled date/);
    const rolledBack = await prisma.doseLog.findUnique({ where: { id: invalidLog.id } });
    assert.equal(rolledBack.status, 'pending');
    assert.equal(rolledBack.actualActionDatetime, null);
    assert.equal(rolledBack.loggedByUserId, null);
    assert.equal(Number((await call(taperPath + '/inventory', 'GET', undefined, 200, other)).quantityRemaining), 17);
    console.log('Taper proof: schedule doseAmount=9, historical local-date steps 2 then 1 => inventory 20 -> 18 -> 17; unmatched date returns 409 with full rollback.');
  } finally {
    app.locals.scanRuntime = oldRuntime;
    if (server) await new Promise((resolve) => server.close(resolve));
    const ids = users.map((row) => row.id);
    await prisma.adherenceStat.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
