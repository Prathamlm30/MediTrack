import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { io } from '../../../../client/node_modules/socket.io-client/build/esm/index.js';
import app from '../../app.js';
import prisma from '../../prismaClient.js';
import { requiredEnv } from '../../config/env.js';
import { installScanRuntime } from '../prescription-scans/runtime.js';
import { runEscalationJob, startEscalationJob } from '../../jobs/escalationJob.js';

test('Phase 8 live PostgreSQL/API/Socket.io demo, cron, concurrency and permissions', { timeout: 60000 }, async () => {
  const users = [], sockets = [];
  let server, runtime, job;
  const oldGrace = process.env.ESCALATION_GRACE_PERIOD_MINUTES;
  const oldMode = process.env.NODE_ENV;
  const oldRuntime = app.locals.scanRuntime;
  process.env.NODE_ENV = 'test';
  const token = (user, extra = {}) => jwt.sign({ kind: 'access', ...extra }, requiredEnv('JWT_ACCESS_SECRET'), {
    algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m',
  });
  try {
    for (const fullName of ['Patient', 'Full', 'Alerts', 'View', 'Revoked', 'Other', 'Inactive']) {
      users.push(await prisma.user.create({ data: { fullName, email: `phase8-${randomUUID()}@example.test`, emailVerified: true } }));
    }
    const [patient, full, alerts, view, revoked, other, inactive] = users;
    await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    for (const [caregiver, permissionLevel, status] of [
      [full, 'full_access', 'active'], [full, 'full_access', 'active'], // Duplicate links must not duplicate recipients.
      [alerts, 'alerts_only', 'active'], [view, 'view_only', 'active'],
      [revoked, 'full_access', 'revoked'], [inactive, 'full_access', 'active'],
    ]) await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: caregiver.id, permissionLevel, status, relationshipType: 'family' } });
    const medication = await prisma.medication.create({ data: {
      patientId: patient.id, medicineName: 'Phase 8 Demo Medicine', medicineForm: 'tablet', trackingType: 'countable',
      dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'daily', startDate: new Date(), addedVia: 'manual',
    } });
    const schedule = await prisma.medicationSchedule.create({ data: {
      medicationId: medication.id, timeOfDay: new Date('1970-01-01T08:00:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1,
    } });
    await prisma.medicineInventory.create({ data: { medicationId: medication.id, patientId: patient.id,
      quantityUnit: 'tablet', quantityTotal: 10, quantityRemaining: 10, refillThreshold: 1, refillAmount: 10 } });
    server = createServer(app);
    runtime = installScanRuntime(server);
    app.locals.scanRuntime = runtime;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(path, { method = 'GET', body, user = patient, expected = 200 } = {}) {
      const response = await fetch(`${base}/api${path}`, { method,
        headers: { 'Content-Type': 'application/json', ...(user && { Authorization: `Bearer ${token(user)}` }) },
        ...(body !== undefined && { body: JSON.stringify(body) }) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    }
    async function connect(user, authToken = user ? token(user) : '') {
      const socket = io(base, { auth: { token: authToken }, reconnection: false, autoConnect: false });
      sockets.push(socket);
      const events = [], reminders = [], stats = [];
      socket.on('missed-dose-alert', (payload) => { events.push(payload); console.log(`LIVE ${user?.fullName ?? 'Unauthenticated'} missed-dose-alert ${JSON.stringify(payload)}`); });
      socket.on('dose-reminder', (payload) => { reminders.push(payload); console.log(`LIVE patient dose-reminder ${JSON.stringify(payload)}`); });
      socket.on('stats-updated', (payload) => stats.push(payload));
      const outcome = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Socket connect timed out')), 5000);
        socket.once('connect', () => { clearTimeout(timeout); resolve('connected'); });
        socket.once('connect_error', (error) => { clearTimeout(timeout); resolve(error.message); });
      });
      socket.connect();
      return { socket, events, reminders, stats, outcome: await outcome };
    }
    const patientSocket = await connect(patient);
    const fullSocket = await connect(full);
    const alertsSocket = await connect(alerts);
    const viewSocket = await connect(view);
    const revokedSocket = await connect(revoked);
    const otherSocket = await connect(other);
    const anonymousSocket = await connect(null);
    for (const item of [patientSocket, fullSocket, alertsSocket, viewSocket, revokedSocket, otherSocket]) assert.equal(item.outcome, 'connected');
    assert.equal(anonymousSocket.outcome, 'Authentication required.');
    assert.equal((await connect(null, 'invalid')).outcome, 'Authentication required.');
    assert.equal((await connect(full, token(full, { kind: 'refresh' }))).outcome, 'Authentication required.');
    assert.equal((await connect(inactive)).outcome, 'Authentication required.');
    await call('/escalation-settings', { user: null, expected: 401 });
    await call('/escalation-settings', { method: 'PATCH', body: { gracePeriodMinutes: 0 }, expected: 400 });
    await call('/escalation-settings', { method: 'PATCH', body: { gracePeriodMinutes: '3' }, expected: 400 });
    await call('/escalation-settings', { method: 'PATCH', body: { gracePeriodMinutes: 0.05 } }); // Real three-second window.
    assert.equal((await call('/escalation-settings')).gracePeriodMinutes, 0.05);
    const overdue = () => call('/escalations/dev/overdue-dose', { method: 'POST', body: { scheduleId: schedule.id }, expected: 201 });
    const run = () => call('/escalations/jobs/run', { method: 'POST', body: {} });
    const dose = await overdue();
    const start = performance.now();
    const first = await run();
    const second = await run();
    assert.equal(first.level1Created, 1);
    assert.equal(second.level1Created, 0);
    assert.equal(second.level2Created, 0);
    assert.equal(await prisma.escalationAlert.count({ where: { doseLogId: dose.id } }), 1);
    console.log(`IDEMPOTENCY L1 dose=${dose.id}: run1=${first.level1Created}, run2=${second.level1Created}, database rows=1`);
    // This part uses node-cron and wall time: no fake clock or manually aged L1.
    job = startEscalationJob(runtime, { schedule: '* * * * * *', patientId: patient.id });
    const deadline = Date.now() + 8000;
    while ((!fullSocket.events.length || !alertsSocket.events.length) && Date.now() < deadline) await delay(50);
    await job.destroy(); job = null;
    assert.equal(fullSocket.events.length, 1);
    assert.equal(alertsSocket.events.length, 1);
    assert.equal(patientSocket.reminders.length, 1);
    assert.deepEqual(fullSocket.events[0], { patientId: patient.id, medicineName: medication.medicineName, scheduledDatetime: dose.scheduledDatetime });
    const elapsed = Math.round(performance.now() - start);
    const repeat1 = await run(), repeat2 = await run();
    assert.equal(repeat1.notificationsCreated + repeat2.notificationsCreated, 0);
    const persisted = await prisma.escalationAlert.findMany({ where: { doseLogId: dose.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(persisted.map((row) => [row.escalationLevel, row.caregiverId]), [[1, null], [2, full.id], [2, alerts.id]]);
    const notifications = await prisma.notification.findMany({ where: { relatedDoseLogId: dose.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(notifications.map((row) => [row.userId, row.notificationType, row.channel]), [
      [patient.id, 'reminder', 'push'], [full.id, 'escalation', 'in_app'], [alerts.id, 'escalation', 'in_app'],
    ]);
    console.log(`LIVE DELIVERABLE: cron delivered caregiver events plus durable Notification rows in ${elapsed}ms.`);
    console.log('IDEMPOTENCY after two more runs:', JSON.stringify(persisted.map(({ id, doseLogId, escalationLevel, caregiverId }) => ({ id, doseLogId, escalationLevel, caregiverId }))));
    console.log('DURABLE NOTIFICATIONS:', JSON.stringify(notifications.map(({ id, userId, relatedDoseLogId, channel }) => ({ id, userId, relatedDoseLogId, channel }))));
    for (const item of [anonymousSocket, patientSocket, viewSocket, revokedSocket, otherSocket]) assert.equal(item.events.length, 0);
    assert.equal(anonymousSocket.socket.connected, false);
    console.log('UNAUTHENTICATED: Authentication required.; connected=false; missed-dose-alert count=0. View-only/revoked/unrelated rooms: 0.');

    assert.equal((await call(`/escalations/active?patientId=${patient.id}`, { user: alerts })).length, 1);
    await call(`/escalations/active?patientId=${patient.id}`, { user: view, expected: 403 });
    await call(`/escalations/active?patientId=${patient.id}`, { user: revoked, expected: 403 });
    await call(`/escalations/active?patientId=${patient.id}`, { user: other, expected: 403 });
    await call('/escalations/jobs/run', { method: 'POST', body: { patientId: patient.id }, user: alerts, expected: 403 });
    await call(`/escalations/${persisted[0].id}/resolve`, { method: 'PATCH', body: {}, expected: 409 });
    await call(`/escalations/${persisted[1].id}/resolve`, { method: 'PATCH', body: {}, user: other, expected: 403 });
    await call(`/escalations/${persisted[1].id}/resolve`, { method: 'PATCH', body: {}, user: alerts, expected: 403 });
    await call(`/dose-logs/${dose.id}`, { method: 'PATCH', body: { status: 'taken' } });
    const resolved = await call(`/escalations/${persisted[1].id}/resolve`, { method: 'PATCH', body: {}, user: full });
    assert.equal(resolved.resolutionStatus, 'resolved');
    assert.ok(resolved.resolvedAt);
    assert.equal((await call(`/escalations/${persisted[1].id}/resolve`, { method: 'PATCH', body: {}, user: full })).resolvedAt, resolved.resolvedAt);
    await call(`/escalations/${persisted[0].id}/resolve`, { method: 'PATCH', body: {} });
    await call(`/escalations/${persisted[2].id}/resolve`, { method: 'PATCH', body: {}, user: alerts });
    assert.equal((await call('/escalations/active')).length, 0);
    assert.equal((await run()).notificationsCreated, 0);
    await delay(50);
    assert.equal(patientSocket.stats.length, 1); // Existing Phase 7 event still works on this same socket.

    const concurrentDose = await overdue();
    const concurrent1 = await Promise.all([run(), run()]);
    assert.equal(concurrent1.reduce((n, r) => n + r.level1Created, 0), 1);
    await prisma.escalationAlert.updateMany({ where: { doseLogId: concurrentDose.id }, data: { triggeredAt: new Date(Date.now() - 4000) } });
    const concurrent2 = await Promise.all([run(), run()]);
    assert.equal(concurrent2.reduce((n, r) => n + r.level2Created, 0), 2);
    assert.equal(await prisma.escalationAlert.count({ where: { doseLogId: concurrentDose.id } }), 3);
    assert.equal(await prisma.notification.count({ where: { relatedDoseLogId: concurrentDose.id } }), 3);
    console.log(`CONCURRENCY dose=${concurrentDose.id}: two simultaneous runs per level => L1=1, L2=1 per caregiver, notifications=3.`);

    // Resolved history must not be recreated if a dose later becomes pending.
    await prisma.doseLog.update({ where: { id: dose.id }, data: { status: 'pending' } });
    assert.equal((await run()).notificationsCreated, 0);
    for (const status of ['taken', 'skipped', 'snoozed', 'missed']) {
      await prisma.doseLog.create({ data: { scheduleId: schedule.id, patientId: patient.id, status, scheduledDatetime: new Date(0) } });
    }
    const future = await prisma.doseLog.create({ data: { scheduleId: schedule.id, patientId: patient.id, scheduledDatetime: new Date(Date.now() + 60000) } });
    assert.equal((await run()).notificationsCreated, 0);
    assert.equal(await prisma.escalationAlert.count({ where: { doseLogId: future.id } }), 0);

    // Inject a notification failure inside the real transaction: no orphan alert.
    const rollbackDose = await overdue();
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = (work, options) => originalTransaction.call(prisma, (tx) => work(new Proxy(tx, {
      get(target, key) {
        if (key === 'notification') return { create: async () => { throw new Error('Injected notification failure'); } };
        return target[key];
      },
    })), options);
    try {
      const failed = await runEscalationJob({ patientId: patient.id, runtime });
      assert.equal(failed.errors.length, 1);
      assert.equal(await prisma.escalationAlert.count({ where: { doseLogId: rollbackDose.id } }), 0);
    } finally { prisma.$transaction = originalTransaction; }
    assert.equal((await run()).level1Created, 1);

    // The emitter checks a link again at send time.
    await prisma.caregiverPatientLink.updateMany({ where: { patientId: patient.id, caregiverId: alerts.id }, data: { status: 'revoked' } });
    await delay(50);
    const beforeRevokedSend = alertsSocket.events.length;
    await runtime.emitMissedDoseAlert(alerts.id, fullSocket.events[0]);
    await delay(50);
    assert.equal(alertsSocket.events.length, beforeRevokedSend);
    await call(`/escalations/active?patientId=${patient.id}`, { user: alerts, expected: 403 });
    process.env.NODE_ENV = 'production';
    await call('/escalation-settings', { method: 'PATCH', body: { gracePeriodMinutes: 1 }, expected: 403 });
    await call('/escalations/jobs/run', { method: 'POST', body: {}, expected: 404 });
    await call('/escalations/dev/overdue-dose', { method: 'POST', body: { scheduleId: schedule.id }, expected: 404 });
    console.log('PASS: permissions, resolve after logging, stable resolvedAt, no reopened duplicates, rollback, production dev-route guards, and existing stats-updated event.');
  } finally {
    await job?.destroy();
    for (const socket of sockets) socket.disconnect();
    await runtime?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    app.locals.scanRuntime = oldRuntime;
    if (oldGrace === undefined) delete process.env.ESCALATION_GRACE_PERIOD_MINUTES;
    else process.env.ESCALATION_GRACE_PERIOD_MINUTES = oldGrace;
    if (oldMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldMode;
    const ids = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.escalationAlert.deleteMany({ where: { patientId: { in: ids } } });
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
