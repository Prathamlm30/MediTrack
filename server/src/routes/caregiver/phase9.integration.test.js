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
import { runEscalationJob } from '../../jobs/escalationJob.js';
import { reportWindow } from '../../jobs/weeklyReportData.js';
import { startWeeklyReportJob, runWeeklyReportJob } from '../../jobs/weeklyReportJob.js';

test('Phase 9 real database, multi-patient switching and shared Phase 8 live feed', { timeout: 180000 }, async () => {
  const users = [], sockets = [], schedules = [];
  let server, runtime, reportJob;
  const oldGrace = process.env.ESCALATION_GRACE_PERIOD_MINUTES;
  process.env.ESCALATION_GRACE_PERIOD_MINUTES = '1';
  try {
    for (const fullName of ['Phase 9 Patient A', 'Phase 9 Patient B', 'Phase 9 Caregiver', 'Phase 9 Stranger']) {
      users.push(await prisma.user.create({ data: { fullName, email: `phase9-${randomUUID()}@example.test`, emailVerified: true } }));
    }
    const [a, b, caregiver, stranger] = users;
    await prisma.userPreference.create({ data: { userId: caregiver.id, preferredNotificationChannel: 'in_app' } });
    for (const patient of [a, b]) {
      await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: caregiver.id,
        status: 'active', permissionLevel: 'full_access', relationshipType: 'family' } });
      const medication = await prisma.medication.create({ data: { patientId: patient.id,
        medicineName: `${patient.fullName} medicine`, medicineForm: 'tablet', trackingType: 'countable',
        dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'daily', startDate: new Date('2026-01-01'), addedVia: 'manual' } });
      schedules.push(await prisma.medicationSchedule.create({ data: { medicationId: medication.id,
        timeOfDay: new Date('1970-01-01T08:00:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } }));
    }
    server = createServer(app);
    runtime = installScanRuntime(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = (user) => jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), {
      subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m', algorithm: 'HS256',
    });
    async function call(path, user = caregiver, expected = 200, options = {}) {
      const response = await fetch(`${base}/api${path}`, { ...options, headers: {
        'Content-Type': 'application/json', ...(user && { Authorization: `Bearer ${token(user)}` }),
      } });
      const value = await response.json();
      assert.equal(response.status, expected, JSON.stringify(value));
      return value;
    }
    await call('/caregiver/patients', null, 401);
    const cards = await call('/caregiver/patients');
    assert.deepEqual(cards, await call('/dashboard/my-patients'));
    assert.deepEqual(cards.patients.map((card) => card.patient.id), [a.id, b.id]);
    assert.deepEqual(Object.keys(cards.patients[0].patient).sort(), ['fullName', 'id']);
    for (const patient of [a, b, a]) {
      const dashboard = await call(`/dashboard/caregiver/${patient.id}`);
      assert.equal(dashboard.patient.id, patient.id);
      console.log(`SWITCH patient=${dashboard.patient.id} name=${dashboard.patient.fullName}`);
    }
    await call(`/dashboard/caregiver/${a.id}`, stranger, 403);
    const events = [];
    const socket = io(base, { auth: { token: token(caregiver) }, reconnection: false, autoConnect: false });
    sockets.push(socket);
    socket.on('missed-dose-alert', (payload) => events.push(payload));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect();
    });
    const connection = socket.id;
    const now = new Date();
    for (const [i, patient] of [a, b].entries()) {
      await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: schedules[i].id,
        scheduledDatetime: new Date(now.getTime() - 120000), status: 'pending' } });
      await runEscalationJob({ now, patientId: patient.id, runtime });
      await runEscalationJob({ now: new Date(now.getTime() + 61000), patientId: patient.id, runtime });
    }
    for (let i = 0; i < 50 && events.length < 2; i++) await delay(20);
    assert.deepEqual(events.map((event) => event.patientId).sort(), [a.id, b.id].sort());
    assert.equal(socket.id, connection);
    const feed = await call('/caregiver/alerts-feed');
    assert.equal(feed.length, 2);
    assert.deepEqual(new Set(feed.map((alert) => alert.patientId)), new Set([a.id, b.id]));
    assert.ok(feed.every((alert) => alert.caregiverId === caregiver.id));
    assert.deepEqual(await call('/caregiver/alerts-feed', stranger), []);
    console.log(`LIVE one connection=${connection} room=user:${caregiver.id} events=${JSON.stringify(events)}`);

    // The report fixture deliberately distinguishes missed, skipped, pending and snoozed.
    const window = reportWindow();
    const statuses = [['taken', 'taken', 'taken', 'missed', 'missed', 'skipped', 'pending', 'snoozed'], ['taken', 'missed']];
    for (const [index, patient] of [a, b].entries()) {
      for (const [i, status] of statuses[index].entries()) {
        await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: schedules[index].id,
          scheduledDatetime: new Date(window.start.getTime() + (i + 1) * 3600000), status } });
      }
      // These missed doses must not be counted: one just before start, one at exclusive end.
      for (const scheduledDatetime of [new Date(window.start.getTime() - 1), window.end]) {
        await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: schedules[index].id, scheduledDatetime, status: 'missed' } });
      }
      await prisma.adherenceStat.create({ data: { patientId: patient.id, periodType: 'daily',
        periodStartDate: new Date(window.start.toISOString().slice(0, 10)), periodEndDate: new Date(window.start.toISOString().slice(0, 10)),
        totalScheduledDoses: statuses[index].length, takenCount: index === 0 ? 3 : 1,
        missedCount: index === 0 ? 2 : 1, skippedCount: index === 0 ? 1 : 0, adherencePercentage: index === 0 ? 37.5 : 50 } });
    }

    // Exercise the real cron runner and real Gemini with persisted fixture rows.
    reportJob = startWeeklyReportJob({ schedule: '* * * * * *', patientId: a.id, caregiverId: caregiver.id });
    let reportA;
    for (let i = 0; i < 1200; i++) {
      reportA = await prisma.weeklySummaryReport.findFirst({ where: { patientId: a.id, caregiverId: caregiver.id, sentStatus: 'sent' } });
      if (reportA) break;
      await delay(100);
    }
    await reportJob.destroy(); reportJob = undefined;
    assert.ok(reportA, 'Real scheduled Gemini report must be delivered.');
    const runs = await Promise.all([1, 2].map(() => call('/reports/weekly/jobs/run', caregiver, 200, { method: 'POST', body: '{}' })));
    assert.equal(runs.reduce((count, run) => count + run.created, 0), 1);
    assert.equal(runs.reduce((count, run) => count + run.sent, 0), 1);
    assert.equal(runs.reduce((count, run) => count + run.existing, 0), 3);
    const reportB = (await call(`/reports/weekly?patientId=${b.id}`))[0];
    for (const [patient, report, missed, total] of [[a, reportA, 2, 8], [b, reportB, 1, 2]]) {
      const rows = await prisma.doseLog.findMany({ where: { patientId: patient.id,
        scheduledDatetime: { gte: window.start, lt: window.end } }, orderBy: { id: 'asc' } });
      assert.equal(rows.length, total);
      assert.equal(rows.filter((row) => row.status === 'missed').length, missed);
      assert.ok(report.summaryText.includes(`there were ${total} recorded doses:`));
      assert.ok(report.summaryText.includes(`The patient missed ${missed} ${missed === 1 ? 'dose' : 'doses'} during this week.`));
      const archive = await call(`/reports/weekly/${report.id}`);
      assert.equal(archive.summaryText, report.summaryText);
      assert.equal(archive.sentStatus, 'sent');
      const notification = await prisma.notification.findFirst({ where: { userId: caregiver.id,
        notificationType: 'weekly_summary', message: report.summaryText } });
      assert.equal(notification.channel, 'in_app');
      console.log(`REAL REPORT ${report.id} patient=${patient.id} SOURCE=${JSON.stringify(rows.map(({ id, status, scheduledDatetime }) => ({ id, status, scheduledDatetime })))} TEXT=${report.summaryText}`);
    }
    assert.ok(reportA.summaryText.includes('3 taken, 2 missed, 1 skipped, 1 pending, and 1 snoozed'));
    await call('/reports/weekly', caregiver, 400);
    await call('/reports/weekly?patientId=0', caregiver, 400);
    await call(`/reports/weekly?patientId=${a.id}`, stranger, 403);
    await call(`/reports/weekly/${reportA.id}`, stranger, 404);
    await call(`/reports/weekly/${reportA.id}?patientId=${b.id}`, stranger, 404);
    const repeats = await Promise.all([runWeeklyReportJob({ caregiverId: caregiver.id }), runWeeklyReportJob({ caregiverId: caregiver.id })]);
    assert.ok(repeats.every((run) => run.created === 0 && run.sent === 0));
    assert.equal(await prisma.weeklySummaryReport.count({ where: { caregiverId: caregiver.id } }), 2);
    assert.equal(await prisma.notification.count({ where: { userId: caregiver.id, notificationType: 'weekly_summary' } }), 2);

    // Failed channels are explicit and retryable without another Gemini report.
    await prisma.userPreference.update({ where: { userId: caregiver.id }, data: { preferredNotificationChannel: 'sms' } });
    await prisma.weeklySummaryReport.update({ where: { id: reportA.id }, data: { sentStatus: 'failed', sentAt: null } });
    const failed = await runWeeklyReportJob({ caregiverId: caregiver.id, patientId: a.id });
    assert.match(failed.errors[0].error, /sms is not configured/);
    assert.equal((await call(`/reports/weekly/${reportA.id}`)).sentStatus, 'failed');
    await prisma.userPreference.update({ where: { userId: caregiver.id }, data: { preferredNotificationChannel: 'in_app' } });
    const retried = await runWeeklyReportJob({ caregiverId: caregiver.id, patientId: a.id });
    assert.equal(retried.created, 0); assert.equal(retried.sent, 1);
    await prisma.caregiverPatientLink.updateMany({ where: { patientId: a.id, caregiverId: caregiver.id }, data: { permissionLevel: 'alerts_only' } });
    await call(`/reports/weekly/${reportA.id}`, caregiver, 403);
    await call(`/reports/weekly?patientId=${a.id}`, caregiver, 403);
    assert.deepEqual((await runWeeklyReportJob({ patientId: a.id })).reportIds, []);
    const oldMode = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try { await call('/reports/weekly/jobs/run', caregiver, 404, { method: 'POST', body: '{}' }); }
    finally { if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode; }
    console.log('PASS real Gemini counts, archive isolation, automated delivery, retries, unsupported channels, and production trigger guard.');

    await prisma.caregiverPatientLink.updateMany({ where: { patientId: a.id, caregiverId: caregiver.id }, data: { status: 'revoked' } });
    assert.deepEqual((await call('/caregiver/alerts-feed')).map((alert) => alert.patientId), [b.id]);
    assert.deepEqual((await call('/caregiver/patients')).patients.map((card) => card.patient.id), [b.id]);
    await prisma.caregiverPatientLink.updateMany({ where: { patientId: b.id, caregiverId: caregiver.id }, data: { permissionLevel: 'view_only' } });
    assert.deepEqual(await call('/caregiver/alerts-feed'), []);
    console.log('PASS active-link permissions, revocation and view-only alert exclusion.');
  } finally {
    await reportJob?.destroy();
    for (const socket of sockets) socket.disconnect();
    await runtime?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    if (oldGrace === undefined) delete process.env.ESCALATION_GRACE_PERIOD_MINUTES;
    else process.env.ESCALATION_GRACE_PERIOD_MINUTES = oldGrace;
    const ids = users.map((user) => user.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.weeklySummaryReport.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.escalationAlert.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.adherenceStat.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.userPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
