// Real PostgreSQL/Redis and HTTP; only Google verification is stubbed. SMTP is
// captured/rejected over a real loopback connection. No production bypasses.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import app from '../../app.js';
import prisma from '../../prismaClient.js';
import redis from '../../config/redis.js';
import { issueTokens, revokeSession } from '../../services/token.service.js';
import { deliverWeeklyReport } from '../../jobs/weeklyReportDelivery.js';
import { backfillWeeklyNotificationPatients } from '../../../scripts/backfill-weekly-notification-patients.js';

test('Phase 11 backend: durable inbox, audit trail and support delivery', async (t) => {
  const suffix = randomUUID();
  const ids = [];
  const mail = [];
  let rejectMail = false;
  const smtp = net.createServer((socket) => {
    socket.setEncoding('utf8'); socket.write('220 localhost SMTP\r\n');
    let buffer = '', message = '', inData = false;
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') { mail.push(message); message = ''; inData = false; socket.write('250 accepted\r\n'); }
          else message += line + '\n';
        } else if (/^RCPT TO/i.test(line) && rejectMail) socket.write('550 recipient rejected\r\n');
        else if (/^DATA/.test(line)) { inData = true; socket.write('354 send message\r\n'); }
        else if (/^QUIT/.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  let server;
  try {
    await Promise.all([prisma.$connect(), redis.connect()]);
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(smtp.address().port);
    process.env.SMTP_SECURE = 'false'; process.env.MAIL_FROM = 'test@meditrack.local';
    process.env.SUPPORT_INBOX = 'support@meditrack.local';
    process.env.GOOGLE_CLIENT_ID ||= 'integration-test.apps.googleusercontent.com';
    delete process.env.SMTP_USER;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const password = 'Phase-eleven-password-42';
    async function user(name) {
      const row = await prisma.user.create({ data: { fullName: `Phase 11 ${name}`, email: `phase11-${name}-${suffix}@example.com`,
        emailVerified: true, passwordHash: await bcrypt.hash(password, 4), preferences: { create: { preferredNotificationChannel: 'in_app' } } } });
      ids.push(row.id);
      return { ...row, token: (await issueTokens(row.id)).accessToken };
    }
    const patient = await user('patient');
    const caregiver = await user('caregiver');
    const stranger = await user('stranger');
    async function request(method, path, actor, data, status = 200) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
        ...(actor && { Authorization: `Bearer ${actor.token}` }) },
      ...(data !== undefined && { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    }
    const get = (path, actor = patient, status = 200) => request('GET', path, actor, undefined, status);
    const patch = (path, actor, data, status) => request('PATCH', path, actor, data, status);
    const inbox = (actor = patient, query = '') => get(`/api/notifications${query}`, actor);
    const notification = (owner, type, extra = {}) => prisma.notification.create({ data: {
      userId: owner.id, notificationType: type, channel: 'in_app', title: type, message: 'fixture', ...extra,
    } });
    const link = await prisma.caregiverPatientLink.create({ data: {
      patientId: patient.id, caregiverId: caregiver.id, relationshipType: 'family', permissionLevel: 'full_access', status: 'active',
    } });
    const medication = await prisma.medication.create({ data: { patientId: patient.id, medicineName: 'Private fixture medicine',
      medicineForm: 'tablet', trackingType: 'countable', dosageAmount: 1, dosageUnit: 'tablet', frequencyText: 'daily',
      startDate: new Date(), addedVia: 'manual', schedules: { create: { timeOfDay: new Date('1970-01-01T08:00:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } } }, include: { schedules: true } });
    const dose = await prisma.doseLog.create({ data: { patientId: patient.id, scheduleId: medication.schedules[0].id, scheduledDatetime: new Date() } });

    await t.test('owner isolation, unread count, type filtering and cursor pages', async () => {
      await get('/api/notifications', null, 401);
      const first = await notification(patient, 'reminder');
      const second = await notification(patient, 'system');
      const third = await notification(patient, 'refill');
      const other = await notification(stranger, 'system');
      const page = await inbox(patient, '?limit=2');
      assert.deepEqual(page.notifications.map((row) => row.id), [third.id, second.id]);
      assert.equal(page.unreadCount, 3); assert.equal(page.nextCursor, second.id);
      const tail = await inbox(patient, `?limit=2&cursor=${page.nextCursor}`);
      assert.deepEqual(tail.notifications.map((row) => row.id), [first.id]); assert.equal(tail.nextCursor, null);
      const filtered = await inbox(patient, '?type=system');
      assert.deepEqual(filtered.notifications.map((row) => row.id), [second.id]); assert.equal(filtered.unreadCount, 3);
      const absent = await patch('/api/notifications/2147483647/read', patient, {}, 404);
      assert.deepEqual(await patch(`/api/notifications/${other.id}/read`, patient, {}, 404), absent);
      assert.ok((await inbox(patient, `?cursor=${other.id}`)).notifications.every((row) => row.userId === patient.id));
      const marked = await patch(`/api/notifications/${second.id}/read`, patient, {});
      const again = await patch(`/api/notifications/${second.id}/read`, patient, {});
      assert.equal(marked.notification.readAt, again.notification.readAt); assert.equal(again.notification.status, 'read');
      const unread = await inbox(patient, '?unread=true&type=reminder');
      assert.deepEqual(unread.notifications.map((row) => row.id), [first.id]); assert.equal(unread.unreadCount, 2);
      for (const query of ['limit=0', 'limit=x', 'cursor=-1', 'type=bad', 'unread=1', 'limit=2&limit=3']) await get(`/api/notifications?${query}`, patient, 400);
      await prisma.notification.createMany({ data: Array.from({ length: 101 }, () => ({ userId: stranger.id, notificationType: 'system', channel: 'in_app', title: 'cap', message: 'fixture' })) });
      assert.equal((await inbox(stranger)).notifications.length, 20);
      assert.equal((await inbox(stranger, '?limit=500')).notifications.length, 100);
    });

    await t.test('revoked and view-only links hide dose-related health messages; restoration restores them', async () => {
      const notice = await notification(caregiver, 'escalation', { relatedDoseLogId: dose.id });
      const ownDose = await notification(patient, 'reminder', { relatedDoseLogId: dose.id });
      const check = async (visible) => {
        const result = await inbox(caregiver);
        assert.equal(result.notifications.some((row) => row.id === notice.id), visible);
        assert.equal(result.unreadCount, visible ? 1 : 0);
      };
      await check(true);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { status: 'revoked' } }); await check(false);
      await patch(`/api/notifications/${notice.id}/read`, caregiver, {}, 404);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { status: 'active', permissionLevel: 'view_only' } }); await check(false);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'alerts_only' } }); await check(true);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'full_access' } }); await check(true);
      assert.ok(await prisma.notification.findUnique({ where: { id: notice.id } }));
      assert.ok((await inbox(patient)).notifications.some((row) => row.id === ownDose.id));
    });

    await t.test('weekly summaries require current view access, fail closed, and backfill only unambiguous patients', async () => {
      const report = await prisma.weeklySummaryReport.create({ data: { patientId: patient.id, caregiverId: caregiver.id,
        weekStartDate: new Date(), weekEndDate: new Date(), summaryText: `Weekly fixture ${suffix}` } });
      await deliverWeeklyReport(report, caregiver);
      const notice = await prisma.notification.findFirstOrThrow({ where: { userId: caregiver.id, notificationType: 'weekly_summary' } });
      assert.equal(notice.relatedPatientId, patient.id);
      const legacy = await notification(caregiver, 'weekly_summary', { message: report.summaryText });
      const unknown = await notification(caregiver, 'weekly_summary');
      const check = async (visible, count) => {
        const result = await inbox(caregiver, '?type=weekly_summary&limit=1');
        assert.equal(result.notifications.length, visible ? 1 : 0);
        assert.equal(result.unreadCount, count);
        assert.ok(!result.notifications.some((row) => row.id === unknown.id));
      };
      await check(true, 2); // existing escalation plus the referenced weekly row
      await patch(`/api/notifications/${legacy.id}/read`, caregiver, {}, 404);
      assert.deepEqual(await backfillWeeklyNotificationPatients(caregiver.id), { examined: 2, updated: 1, unresolved: 1 });
      assert.equal((await prisma.notification.findUnique({ where: { id: legacy.id } })).relatedPatientId, patient.id);
      await check(true, 3);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { status: 'revoked' } });
      await check(false, 0);
      await patch(`/api/notifications/${notice.id}/read`, caregiver, {}, 404);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { status: 'active', permissionLevel: 'alerts_only' } });
      await check(false, 1);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'view_only' } });
      await check(true, 2);
      await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'full_access' } });
      await check(true, 3);
      await patch(`/api/notifications/${notice.id}/read`, caregiver, {});
      await check(true, 2);
      assert.equal(await prisma.notification.count({ where: { id: { in: [notice.id, legacy.id, unknown.id] } } }), 3);
      // Same timestamp/text for two subjects must not guess a patient.
      await prisma.weeklySummaryReport.create({ data: { patientId: stranger.id, caregiverId: caregiver.id,
        weekStartDate: new Date(), weekEndDate: new Date(), summaryText: report.summaryText } });
      const ambiguous = await notification(caregiver, 'weekly_summary', { message: report.summaryText });
      await backfillWeeklyNotificationPatients(caregiver.id);
      assert.equal((await prisma.notification.findUnique({ where: { id: ambiguous.id } })).relatedPatientId, null);
    });

    await t.test('successful local and all three Google login branches audit; failures do not', async () => {
      const login = (email, supplied = password, status = 200) => request('POST', '/api/auth/login', null, { email, password: supplied }, status);
      await login(patient.email);
      await login(patient.email, 'Wrong-password-42', 401);
      assert.equal(await prisma.auditLog.count({ where: { userId: patient.id, actionType: 'login_local' } }), 1);
      const claims = { sub: `phase11-google-${suffix}`, email: patient.email, email_verified: true, name: 'Google Fixture' };
      const fresh = { ...claims, sub: `${claims.sub}-new`, email: `phase11-new-${suffix}@example.com` };
      const verification = t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async ({ idToken }) => {
        if (idToken === 'bad') throw new Error('invalid fixture');
        return { getPayload: () => idToken === 'new' ? fresh : claims };
      });
      try {
        const linked = await request('POST', '/api/auth/google', null, { idToken: 'link' });
        const existing = await request('POST', '/api/auth/google', null, { idToken: 'existing' });
        const created = await request('POST', '/api/auth/google', null, { idToken: 'new' }); ids.push(created.user.id);
        assert.equal(linked.user.id, patient.id); assert.equal(existing.user.id, patient.id);
        assert.equal(await prisma.user.count({ where: { email: patient.email } }), 1);
        await request('POST', '/api/auth/google', null, { idToken: 'bad' }, 401);
        assert.equal(await prisma.auditLog.count({ where: { userId: patient.id, actionType: 'login_google' } }), 2);
        assert.equal(await prisma.auditLog.count({ where: { userId: created.user.id, actionType: 'login_google' } }), 1);
        console.log(`AUDIT PROOF login_local actor=${patient.id}; login_google link/existing actor=${patient.id}, new actor=${created.user.id}`);
      } finally { verification.mock.restore(); }
    });

    await t.test('caregiver reads throttle by patient and route group; audit trail is private', async () => {
      const path = `/api/medications?patientId=${patient.id}`;
      await get(path, caregiver); await get(path, caregiver);
      let reads = await prisma.auditLog.findMany({ where: { userId: caregiver.id, subjectPatientId: patient.id, actionType: 'caregiver_read', details: { path: ['routeGroup'], equals: '/api/medications' } } });
      assert.equal(reads.length, 1);
      assert.equal(reads[0].details.permissionLevel, 'full_access'); assert.equal(reads[0].details.method, 'GET');
      assert.equal(reads[0].ipAddress, null); assert.ok(!JSON.stringify(reads).includes(medication.medicineName));
      await get(`/api/doctors?patientId=${patient.id}`, caregiver);
      assert.equal(await prisma.auditLog.count({ where: { userId: caregiver.id, subjectPatientId: patient.id, actionType: 'caregiver_read', details: { path: ['routeGroup'], equals: '/api/doctors' } } }), 1);
      await prisma.escalationAlert.create({ data: { patientId: patient.id, caregiverId: caregiver.id, doseLogId: dose.id, escalationLevel: 2 } });
      await get('/api/caregiver/alerts-feed', caregiver); await get('/api/caregiver/alerts-feed', caregiver);
      const aggregate = await prisma.auditLog.findMany({ where: { userId: caregiver.id, subjectPatientId: patient.id,
        actionType: 'caregiver_read', details: { path: ['routeGroup'], equals: '/api/caregiver/alerts-feed' } } });
      assert.equal(aggregate.length, 1); assert.equal(aggregate[0].details.method, 'GET');
      await get('/api/caregiver/patients', caregiver);
      assert.equal(await prisma.auditLog.count({ where: { userId: caregiver.id, subjectPatientId: patient.id,
        actionType: 'caregiver_read', details: { path: ['routeGroup'], equals: '/api/caregiver/patients' } } }), 1);
      await get(`/api/medications/${medication.id}/schedules`, caregiver);
      await get(`/api/medications/${medication.id}/inventory/notifications`, caregiver);
      const groups = await prisma.auditLog.findMany({ where: { userId: caregiver.id, actionType: 'caregiver_read' } });
      assert.ok(groups.some((row) => row.details.routeGroup === '/api/schedules'));
      assert.ok(groups.some((row) => row.details.routeGroup === '/api/inventory'));
      await prisma.auditLog.update({ where: { id: reads[0].id }, data: { timestamp: new Date(Date.now() - 11 * 60000) } });
      await get(path, caregiver);
      process.env.CAREGIVER_READ_THROTTLE_MS = '0';
      try { await get(path, caregiver); } finally { delete process.env.CAREGIVER_READ_THROTTLE_MS; }
      assert.equal(await prisma.auditLog.count({ where: { userId: caregiver.id, subjectPatientId: patient.id, actionType: 'caregiver_read', details: { path: ['routeGroup'], equals: '/api/medications' } } }), 3);
      await get(path, stranger, 403);
      assert.equal(await prisma.auditLog.count({ where: { userId: stranger.id, actionType: 'caregiver_read' } }), 0);
      await get(`/api/audit-logs?userId=${caregiver.id}`, patient, 403);
      const trail = await get('/api/audit-logs', patient);
      const read = trail.auditLogs.find((row) => row.id === reads[0].id);
      assert.equal(read.actor.fullName, caregiver.fullName); assert.equal(read.actor.email, undefined);
      assert.ok(trail.auditLogs.every((row) => row.userId === patient.id || row.subjectPatientId === patient.id));
      const head = await get('/api/audit-logs?limit=1', patient);
      const rest = await get(`/api/audit-logs?limit=100&cursor=${head.nextCursor}`, patient);
      assert.ok(rest.auditLogs.every((row) => row.id !== head.auditLogs[0].id));
      assert.deepEqual((await get('/api/audit-logs', stranger)).auditLogs, []);
      assert.deepEqual((await get(`/api/audit-logs?cursor=${head.nextCursor}`, stranger)).auditLogs, []);
      console.log(`AUDIT PROOF caregiver_read row=${read.id} actor=${read.userId} subject=${read.subjectPatientId}; patient sees actor '${read.actor.fullName}'; second read added zero rows`);
    });

    await t.test('permission changes audit atomically; audit outages never block login/reads', async () => {
      const path = `/api/relationships/${link.id}/permissions`;
      await patch(path, patient, { permissionLevel: 'view_only' });
      const row = await prisma.auditLog.findFirst({ where: { userId: patient.id, actionType: 'permission_change' }, orderBy: { id: 'desc' } });
      assert.equal(row.entityId, link.id); assert.equal(row.subjectPatientId, patient.id);
      assert.equal(row.details.previousPermissionLevel, 'full_access'); assert.equal(row.details.newPermissionLevel, 'view_only');
      const original = prisma.$transaction;
      try {
        prisma.$transaction = (callback, options) => original.call(prisma, async (tx) => callback(new Proxy(tx, {
          get(target, key) { return key === 'auditLog' ? { create: async () => { throw new Error('Injected audit failure'); } } : target[key]; },
        })), options);
        await patch(path, patient, { permissionLevel: 'full_access' }, 500);
      } finally { prisma.$transaction = original; }
      assert.equal((await prisma.caregiverPatientLink.findUnique({ where: { id: link.id } })).permissionLevel, 'view_only');
      assert.equal(await prisma.auditLog.count({ where: { userId: patient.id, actionType: 'permission_change' } }), 1);
      await patch(path, patient, { permissionLevel: 'full_access' });
      const create = prisma.auditLog.create;
      const findFirst = prisma.auditLog.findFirst;
      try {
        prisma.auditLog.create = async () => { throw new Error('Injected audit write outage'); };
        await request('POST', '/api/auth/login', null, { email: patient.email, password });
        await get(`/api/adherence/stats?patientId=${patient.id}`, caregiver);
        prisma.auditLog.findFirst = async () => { throw new Error('Injected audit lookup outage'); };
        await get(`/api/doctors?patientId=${patient.id}`, caregiver);
      } finally { prisma.auditLog.create = create; prisma.auditLog.findFirst = findFirst; }
      await patch(path, patient, { status: 'revoked' });
      const revoked = await prisma.auditLog.findFirst({ where: { userId: patient.id, actionType: 'permission_change' }, orderBy: { id: 'desc' } });
      assert.equal(revoked.details.previousStatus, 'active'); assert.equal(revoked.details.newStatus, 'revoked');
      console.log(`AUDIT PROOF permission_change row=${row.id} link=${link.id} full_access -> view_only; injected audit failure rolled back the link`);
    });

    await t.test('preferences round-trip and support validates, rejects failed mail, sanitizes and limits by user', async () => {
      for (const channel of ['in_app', 'email', 'push', 'sms']) {
        await patch('/api/users/me/preferences', patient, { preferredNotificationChannel: channel, language: 'en', theme: 'dark', timezone: 'Asia/Kolkata' });
        const { preferences } = (await get('/api/users/me', patient)).user;
        assert.equal(preferences.preferredNotificationChannel, channel); assert.equal(preferences.timezone, 'Asia/Kolkata'); assert.equal(preferences.theme, 'dark');
      }
      const ticket = (actor, data, status = 201) => request('POST', '/api/support-tickets', actor, data, status);
      await ticket(null, { subject: 'Help', message: 'Hello' }, 401);
      for (const data of [{}, { subject: '\r\n\u0000', message: 'x' }, { subject: 'x'.repeat(121), message: 'x' },
        { subject: 'x', message: '' }, { subject: 'x', message: 'x'.repeat(2001) }, { subject: [], message: 'x' }]) await ticket(patient, data, 400);
      rejectMail = true;
      await ticket(patient, { subject: 'Rejected', message: 'fixture' }, 502); assert.equal(mail.length, 0);
      rejectMail = false;
      await ticket(patient, { subject: 'Help\r\nBcc: intruder@example.com\u0000', message: 'Fixture support body' });
      assert.equal(mail.length, 1);
      assert.match(mail[0], /Reply-To: phase11-patient-/); assert.match(mail[0], /To: support@meditrack.local/);
      assert.doesNotMatch(mail[0], /^Bcc:/mi); assert.match(mail[0], /Subject: HelpBcc: intruder@example.com/);
      for (let i = 0; i < 3; i++) await ticket(patient, { subject: 'Help', message: 'fixture' });
      await ticket(patient, { subject: 'Too many', message: 'fixture' }, 429);
      await ticket(stranger, { subject: 'x'.repeat(120), message: 'x'.repeat(2000) });
      const priorNow = Date.now;
      try {
        Date.now = () => priorNow() + 3600001;
        // Issue a fresh token at the advanced clock, since existing access JWTs expire.
        const renewed = { ...patient, token: (await issueTokens(patient.id)).accessToken };
        await ticket(renewed, { subject: 'Next window', message: 'fixture' });
      } finally { Date.now = priorNow; }
      const mode = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production'; delete process.env.SUPPORT_INBOX;
      try { await ticket(caregiver, { subject: 'Missing inbox', message: 'fixture' }, 503); }
      finally {
        if (mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = mode;
        process.env.SUPPORT_INBOX = 'support@meditrack.local';
      }
      await new Promise((resolve) => smtp.close(resolve));
      await ticket(caregiver, { subject: 'SMTP offline', message: 'fixture' }, 502);
    });

    await t.test('nullable subject relation preserves audit rows when a subject is deleted', async () => {
      const subject = await user('subject-delete');
      const row = await prisma.auditLog.create({ data: { userId: caregiver.id, subjectPatientId: subject.id, actionType: 'caregiver_read', entityType: 'User' } });
      await prisma.userPreference.deleteMany({ where: { userId: subject.id } });
      await prisma.user.delete({ where: { id: subject.id } });
      const retained = await prisma.auditLog.findUnique({ where: { id: row.id } });
      assert.equal(retained.subjectPatientId, null); assert.equal(retained.userId, caregiver.id); assert.equal(retained.details, null);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (smtp.listening) await new Promise((resolve) => smtp.close(resolve));
    for (const id of ids) await revokeSession(id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.weeklySummaryReport.deleteMany({ where: { caregiverId: { in: ids } } });
    await prisma.escalationAlert.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.userPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    redis.disconnect(); await prisma.$disconnect();
  }
});
