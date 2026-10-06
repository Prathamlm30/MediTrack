import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { io } from '../../../client/node_modules/socket.io-client/build/esm/index.js';
import app from '../app.js';
import prisma from '../prismaClient.js';
import { requiredEnv } from '../config/env.js';
import { installScanRuntime } from '../routes/prescription-scans/runtime.js';
import { runDoseLogJob, startDoseLogJob } from '../jobs/doseLogJob.js';

test('data-changed uses authenticated rooms, view permissions and committed writes only', async (t) => {
  const users = [], clients = [];
  const oldRuntime = app.locals.scanRuntime, realFetch = globalThis.fetch, oldKey = process.env.GEMINI_API_KEY;
  let runtime, server, job;
  const medicine = { medicineName: 'Socket private medicine', medicineForm: 'tablet', trackingType: 'countable', dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'daily', startDate: '2020-01-01' };
  try {
    for (const name of ['patient', 'view', 'alerts', 'unlinked', 'full', 'revoked']) {
      users.push(await prisma.user.create({ data: { fullName: name, email: `${randomUUID()}@example.test`, emailVerified: true, timezone: 'UTC' } }));
    }
    const [patient, view, alerts, unlinked, full, revoked] = users;
    const links = [];
    for (const [user, permissionLevel, status] of [[view, 'view_only', 'active'], [alerts, 'alerts_only', 'active'], [full, 'full_access', 'active'], [revoked, 'view_only', 'revoked']]) {
      links.push(await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: user.id, permissionLevel, status, relationshipType: 'family' } }));
    }
    // Duplicate eligible links still produce one event per recipient.
    await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: full.id, permissionLevel: 'view_only', status: 'active', relationshipType: 'family' } });
    const med = await prisma.medication.create({ data: { ...medicine, startDate: new Date(medicine.startDate), patientId: patient.id, addedVia: 'manual' } });
    const schedule = await prisma.medicationSchedule.create({ data: { medicationId: med.id, timeOfDay: new Date('1970-01-01T08:00:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } });
    const dose = await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: schedule.id, scheduledDatetime: new Date() } });
    server = createServer(app);
    runtime = installScanRuntime(server);
    app.locals.scanRuntime = runtime;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = (user) => jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m' });
    for (const user of users) {
      const socket = io(base, { auth: { token: token(user) }, reconnection: false, autoConnect: false });
      const events = [];
      socket.on('data-changed', (payload) => events.push(payload));
      clients.push({ socket, events, user });
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    }
    async function call(path, method, body, status = 200, user = patient) {
      const response = await realFetch(base + '/api' + path, { method, headers: { Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }) });
      const text = await response.text();
      assert.equal(response.status, status, text);
      return text ? JSON.parse(text) : null;
    }
    const clear = () => clients.forEach(({ events }) => { events.length = 0; });
    async function expectEvents(expected, viewEligible = true) {
      const recipients = new Set([patient.id, full.id, ...(viewEligible ? [view.id] : [])]);
      const deadline = Date.now() + 3000;
      while (clients.some(({ user, events }) => recipients.has(user.id) && events.length < expected.length) && Date.now() < deadline) await delay(10);
      await delay(60);
      for (const { user, events } of clients) {
        assert.deepEqual(events, recipients.has(user.id) ? expected : [], user.fullName);
        for (const event of events) assert.deepEqual(Object.keys(event).sort(), ['action', 'id', 'patientId', 'resource']);
      }
    }
    const event = (resource, id, action) => ({ patientId: patient.id, resource, id, action });

    await t.test('dose commits reach patient and view caregivers; revoke and failed writes emit nothing', async () => {
      const send = runtime.emitDataChanged;
      runtime.emitDataChanged = async (payload) => {
        assert.equal((await prisma.doseLog.findUnique({ where: { id: dose.id } })).status, 'skipped');
        await send(payload);
      };
      await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped', notes: 'Private note must never enter event' });
      await expectEvents([event('dose_log', dose.id, 'updated')]);
      clear();
      // Revoke after commit, before the emitter queries eligibility.
      runtime.emitDataChanged = async (payload) => {
        await prisma.caregiverPatientLink.update({ where: { id: links[0].id }, data: { status: 'revoked' } });
        await send(payload);
      };
      await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'snoozed' });
      await expectEvents([event('dose_log', dose.id, 'updated')], false);
      runtime.emitDataChanged = send;
      clear();
      await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' }, 403, unlinked);
      await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'invalid' }, 400);
      await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' }, 403, view);
      const original = prisma.$transaction;
      prisma.$transaction = (work, options) => original.call(prisma, async (tx) => work(new Proxy(tx, {
        get(target, key) {
          return key === 'adherenceStat' ? new Proxy(target[key], { get(model, method) {
            if (['create', 'update'].includes(method)) return async () => { throw new Error('Injected rollback'); };
            return model[method];
          } }) : target[key];
        },
      })), options);
      try { await call(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' }, 500); }
      finally { prisma.$transaction = original; }
      assert.equal((await prisma.doseLog.findUnique({ where: { id: dose.id } })).status, 'snoozed');
      await expectEvents([], false);
      await prisma.caregiverPatientLink.update({ where: { id: links[0].id }, data: { status: 'active' } });
    });

    await t.test('medication, schedule, inventory and both insight dismissals publish their identifiers', async () => {
      clear();
      const created = await call('/medications', 'POST', medicine, 201);
      await expectEvents([event('medication', created.id, 'created')]); clear();
      await call(`/medications/${created.id}`, 'PATCH', { medicineName: 'Changed private name' });
      await expectEvents([event('medication', created.id, 'updated')]); clear();
      const stock = await call(`/medications/${created.id}/inventory`, 'POST', { quantityTotal: 10, refillThreshold: 1, refillAmount: 10 }, 201);
      await expectEvents([event('inventory', stock.id, 'created')]); clear();
      await call(`/medications/${created.id}/inventory`, 'PATCH', { refillThreshold: 2 });
      await expectEvents([event('inventory', stock.id, 'updated')]); clear();
      const added = await call(`/medications/${created.id}/schedules`, 'POST', { timeOfDay: '23:00', daysOfWeek: '0,1,2,3,4,5,6' }, 201);
      await expectEvents([event('schedule', added.id, 'created')]); clear();
      await call(`/schedules/${added.id}`, 'PATCH', { timeOfDay: '22:00' });
      await expectEvents([event('schedule', added.id, 'updated')]); clear();
      await call(`/schedules/${added.id}`, 'DELETE', undefined, 204);
      await expectEvents([event('schedule', added.id, 'deleted')]); clear();
      process.env.GEMINI_API_KEY = 'test-only';
      globalThis.fetch = async (url) => {
        assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify([
          { timeOfDay: '08:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 },
          { timeOfDay: '20:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 },
        ]) }] } }] });
      };
      const generated = await call(`/medications/${created.id}/schedules/generate`, 'POST', { frequencyText: 'twice daily' }, 201);
      await expectEvents(generated.map((row) => event('schedule', row.id, 'created'))); clear();
      globalThis.fetch = realFetch;
      const insight = await prisma.aiInsight.create({ data: { patientId: patient.id, insightType: 'adherence_pattern', insightText: 'Private insight' } });
      await call(`/insights/adherence-${insight.id}/dismiss`, 'PATCH', {});
      await expectEvents([event('insight', `adherence-${insight.id}`, 'updated')]); clear();
      await call(`/insights/adherence-${insight.id}/dismiss`, 'PATCH', {});
      await expectEvents([]); // no new write on idempotent repeat
      const interaction = await prisma.drugInteraction.findFirstOrThrow();
      const flag = await prisma.medicationInteractionFlag.create({ data: { patientId: patient.id, medicationId1: med.id, medicationId2: created.id, interactionId: interaction.id } });
      await call(`/insights/interaction-${flag.id}/dismiss`, 'PATCH', {});
      await expectEvents([event('insight', `interaction-${flag.id}`, 'updated')]); clear();
      await call(`/medications/${created.id}`, 'DELETE');
      await expectEvents([event('medication', created.id, 'deleted')]); clear();
    });

    await t.test('generation emits once per changed patient after commit, including startup; empty rerun is silent', async () => {
      clear();
      await prisma.medicationSchedule.updateMany({ where: { medicationId: med.id }, data: { isActive: false } });
      const schedules = [];
      for (const time of ['07:00', '08:00']) schedules.push(await prisma.medicationSchedule.create({ data: { medicationId: med.id,
        timeOfDay: new Date(`1970-01-01T${time}:00Z`), createdAt: new Date('2020-01-01'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } }));
      const original = runtime.emitDataChanged;
      runtime.emitDataChanged = async (payload) => {
        assert.equal(await prisma.doseLog.count({ where: { scheduleId: { in: schedules.map((row) => row.id) } } }), 2);
        assert.equal((await prisma.doseLog.findUnique({ where: { id: payload.id } })).patientId, patient.id);
        await original(payload);
      };
      const auditBefore = await prisma.auditLog.count({ where: { OR: [{ userId: { in: users.map((user) => user.id) } }, { subjectPatientId: patient.id }] } });
      job = startDoseLogJob({ patientId: patient.id, runtime, schedule: '0 0 1 1 *' });
      assert.equal((await job.ready).created, 2);
      const [first] = await prisma.doseLog.findMany({ where: { scheduleId: { in: schedules.map((row) => row.id) } }, orderBy: { id: 'asc' } });
      await expectEvents([event('dose_log', first.id, 'created')]); clear();
      assert.equal((await job.tick()).created, 0);
      assert.equal((await runDoseLogJob({ patientId: patient.id, runtime })).created, 0);
      await expectEvents([]);
      assert.equal(await prisma.auditLog.count({ where: { OR: [{ userId: { in: users.map((user) => user.id) } }, { subjectPatientId: patient.id }] } }), auditBefore);
      runtime.emitDataChanged = original;
    });
  } finally {
    globalThis.fetch = realFetch;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    await job?.destroy();
    for (const { socket } of clients) socket.disconnect();
    await runtime?.close();
    app.locals.scanRuntime = oldRuntime;
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    const ids = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.adherenceStat.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationInteractionFlag.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.aiInsight.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
