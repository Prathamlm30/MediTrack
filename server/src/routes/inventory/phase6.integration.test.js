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
import { decrementInventory } from '../../services/inventory.service.js';
import { dailyUsage, patientDate, runInventoryJob } from '../../jobs/inventoryJob.js';

test('weekly schedule averages and current taper step', () => {
  assert.equal(patientDate(new Date('2026-10-01T20:00:00Z'), 'Asia/Kolkata'), '2026-10-02');
  assert.equal(patientDate(new Date('2026-10-01T20:00:00Z'), 'invalid'), '2026-10-01');
  const ordinary = { isActive: true, doseAmount: 2, daysOfWeek: '1,3,5' };
  assert.ok(Math.abs(Number(dailyUsage([ordinary], '2026-10-02')) - 6 / 7) < 1e-12);
  const taper = { ...ordinary, daysOfWeek: '0,1,2,3,4,5,6', isTaperSchedule: true, taperDetails: [
    { fromDate: '2026-10-01', toDate: '2026-10-03', doseAmount: 3 },
    { fromDate: '2026-10-04', toDate: '2026-10-06', doseAmount: 1 },
  ] };
  assert.equal(Number(dailyUsage([taper], '2026-10-03')), 3);
  assert.equal(Number(dailyUsage([taper], '2026-10-04')), 1);
  assert.equal(Number(dailyUsage([taper], '2026-10-07')), 0);
  assert.equal(Number(dailyUsage([{ ...ordinary, isActive: false }], '2026-10-02')), 0);
});

test('Phase 6 real database, API permissions, generation, inventory concurrency and refill notifications', async () => {
  const users = []; let server;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let generated = [{ timeOfDay: '08:30', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 }, { timeOfDay: '20:30', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 }];
  try {
    for (const name of ['Patient', 'Other', 'Caregiver']) users.push(await prisma.user.create({ data: { fullName: name, email: `phase6-${randomUUID()}@example.test`, emailVerified: true, timezone: 'Asia/Kolkata' } }));
    const [patient, other, caregiver] = users;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(path, method = 'GET', body, status = 200, user = patient) {
      const token = user && jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m' });
      const response = await originalFetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      const text = await response.text();
      assert.equal(response.status, status, `${method} ${path}: ${text}`);
      return text && status !== 204 ? JSON.parse(text) : null;
    }
    const med = await call('/medications', 'POST', { medicineName: 'Phase Six Test', medicineForm: 'tablet', trackingType: 'countable', dosageAmount: '500', dosageUnit: 'mg', frequencyText: 'twice daily after meals', startDate: '2026-01-01' }, 201);
    const path = `/medications/${med.id}`;
    const live = process.env.PHASE6_REAL_GEMINI === '1';
    if (!live) {
      process.env.GEMINI_API_KEY = 'test-only';
      globalThis.fetch = async (url, options) => {
        assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
        assert.equal(JSON.parse(options.body).contents[0].parts[0].text, 'twice daily after meals');
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(generated) }] } }] }), { status: 200 });
      };
    }
    const rows = await call(path + '/schedules/generate', 'POST', { frequencyText: 'twice daily after meals' }, 201);
    assert.equal(rows.length, 2);
    for (const row of rows) { assert.match(row.timeOfDay, /T\d{2}:\d{2}:00\.000Z$/); assert.equal(Number(row.doseAmount), 1); }
    console.log(`${live ? 'REAL GEMINI' : 'Mock Gemini'} persisted times:`, rows.map((row) => row.timeOfDay.slice(11, 16)));
    assert.equal((await call(path + '/schedules')).length, 2);
    await call(path + '/schedules/generate', 'POST', { frequencyText: 'twice daily after meals' }, 409);
    await call(path + '/schedules', 'POST', { timeOfDay: '25:00', daysOfWeek: '1' }, 400);
    await call(`/schedules/${rows[0].id}`, 'PATCH', { daysOfWeek: '1,1' }, 400);
    await call(`/schedules/${rows[0].id}`, 'PATCH', { doseAmount: 0 }, 400);
    await call(`/schedules/${rows[0].id}`, 'PATCH', { isTaperSchedule: true, taperDetails: [{ fromDate: '2026-02-30', toDate: '2026-03-05', doseAmount: 1 }] }, 400);
    await call(path + '/inventory', 'POST', { quantityTotal: 1, quantityUnit: 'ml', refillThreshold: 2, refillAmount: 30 }, 400);
    const inv = await call(path + '/inventory', 'POST', { quantityTotal: 1, refillThreshold: 2, refillAmount: 30 }, 201);
    assert.equal(inv.quantityUnit, 'units');
    await call(path + '/inventory', 'POST', { quantityTotal: 20, refillThreshold: 2, refillAmount: 30 }, 409);
    const now = new Date('2026-10-02T06:00:00Z');
    const job = await runInventoryJob({ now, patientId: patient.id });
    assert.deepEqual(job, { processed: 1, notificationsCreated: 1, errors: [] });
    const stored = await call(path + '/inventory');
    assert.equal(stored.estimatedRunoutDate, '2026-10-02T18:00:00.000Z');
    assert.equal(Number(stored.quantityRemaining), 1);
    assert.equal((await call(path + '/inventory/notifications')).length, 1);
    assert.equal((await runInventoryJob({ now, patientId: patient.id })).notificationsCreated, 0);
    const tomorrow = new Date('2026-10-03T06:00:00Z');
    const concurrentJobs = await Promise.all([runInventoryJob({ now: tomorrow, patientId: patient.id }), runInventoryJob({ now: tomorrow, patientId: patient.id })]);
    assert.equal(concurrentJobs.reduce((sum, result) => sum + result.notificationsCreated, 0), 1);
    assert.ok(concurrentJobs.every((result) => !result.errors.length));
    console.log('Real refill Notification row:', (await call(path + '/inventory/notifications'))[0].id);
    for (const endpoint of [path + '/schedules', path + '/inventory', path + '/inventory/notifications', `/schedules/${rows[0].id}`]) {
      await call(endpoint, 'GET', undefined, 403, other);
      await call(endpoint, 'GET', undefined, 401, null);
    }
    const link = await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: caregiver.id, relationshipType: 'family', permissionLevel: 'view_only', status: 'active' } });
    await call(path + '/schedules', 'GET', undefined, 200, caregiver);
    await call(`/schedules/${rows[0].id}`, 'PATCH', { doseAmount: 2 }, 403, caregiver);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'alerts_only' } });
    await call(path + '/inventory', 'GET', undefined, 403, caregiver);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'full_access' } });
    await call(`/schedules/${rows[0].id}`, 'PATCH', { doseAmount: 2 }, 200, caregiver);
    await assert.rejects(decrementInventory(med.id, other.id, 1), { status: 404 });
    await assert.rejects(decrementInventory(med.id, patient.id, -1), { status: 400 });
    await Promise.all([decrementInventory(med.id, patient.id, 0.25), decrementInventory(med.id, patient.id, 0.25)]);
    assert.equal(Number((await call(path + '/inventory')).quantityRemaining), 0.5);
    assert.equal(Number((await decrementInventory(med.id, patient.id, 10)).quantityRemaining), 0);
    await call(`/schedules/${rows[1].id}`, 'DELETE', undefined, 204);
    const taper = await call(`/schedules/${rows[0].id}`, 'PATCH', { isTaperSchedule: true, taperDetails: [{ fromDate: '2026-10-01', toDate: '2026-10-03', doseAmount: 3 }, { fromDate: '2026-10-04', toDate: '2026-10-07', doseAmount: 1 }] });
    assert.equal(taper.taperDetails.length, 2);
    const plain = await call(`/schedules/${rows[0].id}`, 'PATCH', { isTaperSchedule: false });
    assert.equal(plain.taperDetails, null);
    for (const [medicineForm, trackingType, dosageUnit, amount] of [['syrup', 'volume_ml', 'ml', 5], ['cream', 'weight_grams', 'g', 0.5]]) {
      const m = await call('/medications', 'POST', { medicineName: `Test ${medicineForm}`, medicineForm, trackingType, dosageAmount: amount, dosageUnit, frequencyText: 'daily', startDate: '2026-01-01' }, 201);
      await call(`/medications/${m.id}/schedules`, 'POST', { timeOfDay: '09:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: amount }, 201);
      const stock = await call(`/medications/${m.id}/inventory`, 'POST', { quantityTotal: 20, refillThreshold: 0, refillAmount: 20, estimatedUsagePerDose: amount }, 201);
      assert.equal(stock.quantityUnit, dosageUnit);
      assert.equal(Number((await decrementInventory(m.id, patient.id, amount)).quantityRemaining), 20 - amount);
    }
    const taperMed = await call('/medications', 'POST', { medicineName: 'Current taper test', medicineForm: 'tablet', trackingType: 'countable', dosageAmount: 10, dosageUnit: 'mg', frequencyText: 'taper', startDate: '2026-01-01' }, 201);
    const taperPath = `/medications/${taperMed.id}`;
    const taperRow = await call(taperPath + '/schedules', 'POST', { timeOfDay: '09:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 9, isTaperSchedule: true, taperDetails: [{ fromDate: '2026-10-01', toDate: '2026-10-03', doseAmount: 3 }, { fromDate: '2026-10-04', toDate: '2026-10-06', doseAmount: 1 }] }, 201);
    await call(taperPath + '/inventory', 'POST', { quantityTotal: 30, refillThreshold: 30, refillAmount: 30 }, 201);
    await runInventoryJob({ now, patientId: patient.id });
    assert.equal((await call(taperPath + '/inventory')).estimatedRunoutDate, '2026-10-12T06:00:00.000Z');
    assert.equal((await call(taperPath + '/inventory/notifications')).length, 0); // Strictly below, not equal.
    await call(`/schedules/${taperRow.id}`, 'PATCH', { isTaperSchedule: false, doseAmount: 2, daysOfWeek: '1,3,5' });
    await runInventoryJob({ now, patientId: patient.id });
    assert.equal((await call(taperPath + '/inventory')).estimatedRunoutDate, '2026-11-06T06:00:00.000Z');
    await call(`/schedules/${taperRow.id}`, 'DELETE', undefined, 204);
    await runInventoryJob({ now, patientId: patient.id });
    assert.equal((await call(taperPath + '/inventory')).estimatedRunoutDate, null);
    const cli = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../jobs/inventoryJob.js', import.meta.url)), String(patient.id)]);
    assert.deepEqual(JSON.parse(cli.stdout).errors, []);
    console.log('On-demand CLI verified.');
    await call(`/schedules/${rows[0].id}`, 'DELETE', undefined, 204);
    if (!live) {
      generated = [{ timeOfDay: 'after meals', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 }];
      await call(path + '/schedules/generate', 'POST', { frequencyText: 'twice daily after meals' }, 502);
      assert.equal(await prisma.medicationSchedule.count({ where: { medicationId: med.id, isActive: true } }), 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    if (server) await new Promise((resolve) => server.close(resolve));
    const ids = users.map((row) => row.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
