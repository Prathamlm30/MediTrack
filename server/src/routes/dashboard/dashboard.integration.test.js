// Run from server/: node --test src/routes/dashboard/dashboard.integration.test.js
// Uses development PostgreSQL and real JWT/permission middleware. Cleans its own fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../../app.js';
import prisma from '../../prismaClient.js';
import { requiredEnv } from '../../config/env.js';
import { createDashboardFixtures } from '../../../prisma/devSeed.js';
import { dayWindow } from './dayWindow.js';

test('patient calendar days handle offsets, DST and missing/invalid timezones', () => {
  for (const [instant, timezone, start, end] of [
    ['2026-09-20T21:00:00Z', 'Asia/Kolkata', '2026-09-20T18:30:00.000Z', '2026-09-21T18:30:00.000Z'],
    ['2026-03-08T12:00:00Z', 'America/New_York', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01T12:00:00Z', 'America/New_York', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ['2026-09-20T12:00:00Z', 'invalid', '2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z'],
  ]) {
    const result = dayWindow(new Date(instant), timezone);
    assert.equal(result.start.toISOString(), start); assert.equal(result.end.toISOString(), end);
  }
});

test('Phase 3: live scoped dashboards, permission filtering and multiple patients', async () => {
  let fixtures, server;
  const ownIds = [];
  try {
    fixtures = await prisma.$transaction((db) => createDashboardFixtures(db, { password: 'Dashboard-test-password-42' }), { timeout: 30000 });
    const { patient, secondPatient, caregiver, links, schedules, medications } = fixtures;
    ownIds.push(patient.id, secondPatient.id, caregiver.id);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/dashboard`;
    const token = (id) => jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), {
      algorithm: 'HS256', subject: String(id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m',
    });
    async function get(path, user, expected = 200, method = 'GET') {
      const response = await fetch(base + path, { method, headers: user ? { Authorization: `Bearer ${token(user.id)}` } : {},
        signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      assert.equal(response.status, expected, `${path}: ${text}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
    }
    for (const path of ['/patient', `/caregiver/${patient.id}`, '/my-patients']) await get(path, null, 401);
    const { start, end } = dayWindow(new Date(), 'Asia/Kolkata');
    const extra = await prisma.doseLog.createMany({ data: [
      { patientId: patient.id, scheduleId: schedules[0].id, scheduledDatetime: new Date(start.getTime() - 1), status: 'missed' },
      { patientId: patient.id, scheduleId: schedules[0].id, scheduledDatetime: end },
      { patientId: patient.id, scheduleId: schedules[3].id, scheduledDatetime: start }, // wrong medication owner
      { patientId: secondPatient.id, scheduleId: schedules[0].id, scheduledDatetime: start }, // wrong dose owner
    ] });
    assert.equal(extra.count, 4);
    await prisma.adherenceStat.createMany({ data: [
      { patientId: patient.id, periodType: 'daily', periodStartDate: new Date(start.getTime() - 86400000),
        periodEndDate: start, totalScheduledDoses: 4, takenCount: 4, missedCount: 0, skippedCount: 0, adherencePercentage: 100 },
      { patientId: patient.id, periodType: 'weekly', periodStartDate: start, periodEndDate: end,
        totalScheduledDoses: 10, takenCount: 10, missedCount: 0, skippedCount: 0, adherencePercentage: 100 },
    ] });
    const inventoryNow = Date.now();
    await prisma.medicineInventory.createMany({ data: [null, -1, 8].map((days) => ({
      patientId: patient.id, medicationId: medications[0].id, quantityUnit: 'tablets', quantityTotal: 30,
      quantityRemaining: 20, refillThreshold: 5, refillAmount: 30,
      estimatedRunoutDate: days === null ? null : new Date(inventoryNow + days * 86400000),
    })) });
    const own = await get('/patient', patient);
    assert.equal(own.patient.id, patient.id); assert.equal(own.readOnly, false);
    assert.equal(own.todayDoses.length, 3); assert.equal(own.adherence.adherencePercentage, '33.33');
    assert.equal(own.refillAlerts.length, 2); assert.equal(own.timezone, 'Asia/Kolkata');
    assert.equal(own.refillAlerts[0].medicationId, medications[0].id);
    assert.equal(own.refillAlerts[0].estimatedRunoutDate, new Date(inventoryNow - 86400000).toISOString());
    assert.ok(new Date(own.refillAlerts[1].estimatedRunoutDate) > new Date(own.generatedAt));
    assert.ok(new Date(own.refillAlerts[1].estimatedRunoutDate) <= new Date(new Date(own.generatedAt).getTime() + 7 * 86400000));
    const caregiverOwn = await get('/patient', caregiver);
    assert.deepEqual(caregiverOwn.todayDoses, []); assert.equal(caregiverOwn.adherence, null);
    assert.deepEqual(caregiverOwn.refillAlerts, []);
    const viewed = await get(`/caregiver/${patient.id}`, caregiver);
    assert.equal(viewed.readOnly, true); assert.equal(viewed.permissionLevel, 'view_only');
    assert.deepEqual(viewed.todayDoses, own.todayDoses); assert.deepEqual(viewed.adherence, own.adherence);
    const overview = await get('/my-patients', caregiver);
    assert.deepEqual(overview.patients.map((row) => row.patient.id), [patient.id, secondPatient.id]);
    for (const row of overview.patients) assert.deepEqual(Object.keys(row.patient).sort(), ['fullName', 'id']);
    assert.deepEqual((await get('/my-patients', patient)).patients, []);
    const restricted = await get(`/caregiver/${secondPatient.id}`, caregiver);
    assert.equal(restricted.permissionLevel, 'alerts_only'); assert.equal(restricted.readOnly, true);
    assert.equal(Object.hasOwn(restricted, 'todayDoses'), false); assert.equal(Object.hasOwn(restricted, 'adherence'), false);
    assert.equal(restricted.refillAlerts.length, 1);
    assert.equal(JSON.stringify(restricted).includes('dosageAmount'), false);
    console.log('PASS alerts_only response keys:', Object.keys(restricted).join(', '));
    // Permission changes must take effect on the next request, without a fresh JWT.
    await prisma.caregiverPatientLink.update({ where: { id: links[0].id }, data: { permissionLevel: 'alerts_only' } });
    assert.equal(Object.hasOwn(await get(`/caregiver/${patient.id}`, caregiver), 'adherence'), false);
    await prisma.caregiverPatientLink.update({ where: { id: links[0].id }, data: { permissionLevel: 'full_access' } });
    assert.equal((await get(`/caregiver/${patient.id}`, caregiver)).readOnly, true);
    assert.ok((await get(`/caregiver/${patient.id}`, caregiver)).adherence);
    await get(`/caregiver/${patient.id}`, secondPatient, 403);
    await get(`/caregiver/${patient.id}`, patient, 403);
    await get('/caregiver/invalid', caregiver, 400);
    await get('/caregiver/0', caregiver, 400);
    await get('/caregiver/9007199254740992', caregiver, 400);
    await get(`/caregiver/${patient.id}`, caregiver, 404, 'POST');
    // Re-read changed data: no cached dashboard snapshot.
    const doseId = own.todayDoses[2].id;
    await prisma.doseLog.update({ where: { id: doseId }, data: { status: 'taken' } });
    assert.equal((await get('/patient', patient)).todayDoses[2].status, 'taken');
    for (const status of ['pending', 'expired', 'revoked']) {
      await prisma.caregiverPatientLink.update({ where: { id: links[0].id }, data: { status } });
      await get(`/caregiver/${patient.id}`, caregiver, 403);
      assert.deepEqual((await get('/my-patients', caregiver)).patients.map((row) => row.patient.id), [secondPatient.id]);
    }
    console.log('PASS patient isolation, daily/refill windows, all permissions, live updates, read-only routes, and inactive links');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (ownIds.length) {
      await prisma.$transaction([
        prisma.aiInsight.deleteMany({ where: { patientId: { in: ownIds } } }),
        prisma.caregiverPatientLink.deleteMany({ where: { OR: [{ patientId: { in: ownIds } }, { caregiverId: { in: ownIds } }] } }),
        prisma.doseLog.deleteMany({ where: { patientId: { in: ownIds } } }),
        prisma.adherenceStat.deleteMany({ where: { patientId: { in: ownIds } } }),
        prisma.medicineInventory.deleteMany({ where: { patientId: { in: ownIds } } }),
        prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ownIds } } } }),
        prisma.medication.deleteMany({ where: { patientId: { in: ownIds } } }),
        prisma.userPreference.deleteMany({ where: { userId: { in: ownIds } } }),
        prisma.user.deleteMany({ where: { id: { in: ownIds } } }),
      ]);
    }
    await prisma.$disconnect();
  }
});
