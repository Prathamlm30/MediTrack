// Run: node --test src/routes/phase2.integration.test.js (from server/).
// Uses development PostgreSQL/Redis from server/.env and a local SMTP capture.
// Creates unique test users, removes only its own rows, and exposes permission
// probes only on this temporary HTTP server, never in the production app.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import express from 'express';
import app from '../app.js';
import prisma from '../prismaClient.js';
import redis from '../config/redis.js';
import verifyJWT from '../middleware/verifyJWT.js';
import checkPermission from '../middleware/checkPermission.js';
import errorHandler from '../middleware/errorHandler.js';
import { revokeSession } from '../services/token.service.js';

test('Phase 2: reciprocal roles, invitation lifecycle, atomic accept, permission enforcement', async () => {
  const suffix = randomUUID();
  const emails = [`phase2-a-${suffix}@example.com`, `phase2-b-${suffix}@example.com`];
  const password = 'Phase-two-test-password-42';
  const mail = [];
  const ids = [];
  const smtp = net.createServer((socket) => {
    socket.setEncoding('utf8'); socket.write('220 localhost SMTP\r\n');
    let buffer = '', message = '', inData = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') { mail.push(message); message = ''; inData = false; socket.write('250 accepted\r\n'); }
          else message += line + '\n';
        } else if (/^DATA/.test(line)) { inData = true; socket.write('354 send message\r\n'); }
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
    delete process.env.SMTP_USER;
    const harness = express();
    let protectedReads = 0;
    for (const level of ['full_access', 'view_only', 'alerts_only']) {
      harness.get(`/__phase2/patients/:patientId/${level}`, verifyJWT, checkPermission(level), (req, res) => {
        protectedReads++;
        res.json({ patientId: req.patientId });
      });
    }
    harness.use(app);
    harness.use(errorHandler);
    server = harness.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(method, path, data, token, status = 200) {
      const response = await fetch(base + path, { method, redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000),
      });
      if (status === 303) {
        assert.equal(response.status, status);
        return new URL(response.headers.get('location'));
      }
      const value = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
      return value;
    }
    function mailToken(kind, recipient) {
      const raw = mail.at(-1).replace(/=\n/g, '').replace(/=3D/g, '=');
      assert.ok(raw.includes(recipient), 'Message must be addressed to the invitee');
      const pattern = kind === 'verify' ? /verify-email\/([a-f0-9]{64})/ : /\/invitations\/([a-f0-9]{64})/;
      assert.match(raw, pattern);
      return raw.match(pattern)[1];
    }
    async function register(index) {
      const email = emails[index];
      const registration = await request('POST', '/api/auth/register', { fullName: `Phase Two ${index ? 'B' : 'A'}`, email, password }, null, 201);
      ids.push(registration.user.id);
      await request('GET', `/api/auth/verify-email/${mailToken('verify', email)}`);
      return request('POST', '/api/auth/login', { email, password });
    }
    async function invite(sender, recipient, proposedRole = 'caregiver') {
      const result = await request('POST', '/api/invitations', {
        inviteeEmail: recipient, relationshipType: 'family', proposedRole,
      }, sender.accessToken, 201);
      assert.equal(result.invitation.inviteToken, undefined);
      return mailToken('invite', recipient);
    }
    const accept = (token, user, status = 201) => request('POST', `/api/invitations/${token}/accept`, null, user?.accessToken, status);
    const patch = (id, user, data, status = 200) => request('PATCH', `/api/relationships/${id}/permissions`, data, user.accessToken, status);
    const read = (patient, user, level, status = 200) => request('GET', `/__phase2/patients/${patient.user.id}/${level}`, null, user?.accessToken, status);

    const A = await register(0);
    // Exercise register-first without needing a third permanent account.
    const beforeSignup = await invite(A, emails[1]);
    const signup = await accept(beforeSignup, null, 303);
    assert.equal(signup.pathname, '/signup');
    assert.equal(signup.searchParams.get('inviteToken'), beforeSignup);
    const B = await register(1);
    const login = await accept(beforeSignup, null, 303);
    assert.equal(login.pathname, '/login');
    assert.equal(login.searchParams.get('inviteToken'), beforeSignup);
    // Both users now exist; run the exact requested reciprocal relationship flow.
    const tokenAB = await invite(A, emails[1]);
    const preview = (await request('GET', `/api/invitations/${tokenAB}`)).invitation;
    assert.equal(preview.proposedRole, 'caregiver');
    assert.equal(preview.relationshipType, 'family');
    assert.deepEqual(Object.keys(preview.inviter).sort(), ['email', 'fullName', 'id']);
    await accept(tokenAB, A, 403);
    const AB = (await accept(tokenAB, B)).relationship;
    assert.equal(AB.patientId, A.user.id); assert.equal(AB.caregiverId, B.user.id);
    assert.equal(AB.status, 'active'); assert.ok(AB.linkedAt);
    assert.equal(AB.permissionLevel, 'view_only');
    const accepted = await prisma.invitation.findUnique({ where: { inviteToken: tokenAB } });
    assert.equal(accepted.status, 'accepted'); assert.ok(accepted.respondedAt);
    await accept(tokenAB, B, 409);
    const tokenBA = await invite(B, emails[0]);
    const BA = (await accept(tokenBA, A)).relationship;
    assert.notEqual(AB.id, BA.id);
    assert.equal(BA.patientId, B.user.id); assert.equal(BA.caregiverId, A.user.id);
    for (const [name, user, perspectives] of [['A', A, ['patient', 'caregiver']], ['B', B, ['caregiver', 'patient']]]) {
      const rows = (await request('GET', '/api/relationships', null, user.accessToken)).relationships;
      assert.deepEqual(rows.map((row) => row.id), [AB.id, BA.id]);
      assert.deepEqual(rows.map((row) => row.perspective), perspectives);
      for (const row of rows) {
        assert.equal(row.patient.id, row.patientId); assert.equal(row.caregiver.id, row.caregiverId);
        assert.deepEqual(Object.keys(row.patient).sort(), ['email', 'fullName', 'id']);
        assert.deepEqual(Object.keys(row.caregiver).sort(), ['email', 'fullName', 'id']);
      }
      console.log(`PASS GET /api/relationships for ${name}: ${perspectives.join(', ')} (two distinct rows)`);
    }
    await request('GET', '/api/relationships', null, null, 401);
    await patch(AB.id, B, { permissionLevel: 'full_access' }, 403);
    await patch(BA.id, A, { status: 'revoked' }, 403);
    await patch(AB.id, A, { permissionLevel: 'invalid' }, 400);
    await patch(AB.id, A, { status: 'active' }, 400);
    await patch(AB.id, A, { permissionLevel: 'view_only', status: 'revoked' }, 400);
    await read(A, B, 'view_only');
    await read(A, B, 'full_access', 403);
    await read(A, B, 'alerts_only', 403);
    await patch(AB.id, A, { permissionLevel: 'alerts_only' });
    const beforeDenied = protectedReads;
    const denied = await read(A, B, 'full_access', 403);
    assert.equal(protectedReads, beforeDenied, 'Denied request must never execute the protected handler');
    assert.equal(denied.error, 'Insufficient permission: full_access required.');
    console.log(`PASS B (alerts_only) GET full_access read -> 403 ${JSON.stringify(denied)}; protected handler was not executed`);
    await read(A, B, 'view_only', 403);
    await read(A, B, 'alerts_only');
    await patch(AB.id, A, { permissionLevel: 'full_access' });
    for (const level of ['full_access', 'view_only', 'alerts_only']) await read(A, B, level);
    await read(A, A, 'full_access');
    await read(B, A, 'full_access', 403); // Reciprocal row's permission is independent.
    await read(A, null, 'full_access', 401);
    await request('GET', '/__phase2/patients/invalid/full_access', null, A.accessToken, 400);
    assert.throws(() => checkPermission('unknown'), /Invalid required/);
    await patch(AB.id, A, { status: 'revoked' });
    assert.ok((await prisma.caregiverPatientLink.findUnique({ where: { id: AB.id } })).revokedAt);
    await read(A, B, 'full_access', 403);
    await read(B, A, 'view_only');
    console.log('PASS patient-only updates; independent permissions, revocation, owner access, and authentication');

    // The saved pre-registration token still works after signup/verification/login.
    await accept(beforeSignup, B);
    const declined = await invite(A, emails[1]);
    await request('POST', `/api/invitations/${declined}/decline`, null, A.accessToken, 403);
    await request('POST', `/api/invitations/${declined}/decline`, null, B.accessToken);
    const declinedRow = await prisma.invitation.findUnique({ where: { inviteToken: declined } });
    assert.equal(declinedRow.status, 'declined'); assert.ok(declinedRow.respondedAt);
    await accept(declined, B, 409);
    const expired = await invite(A, emails[1]);
    await prisma.invitation.update({ where: { inviteToken: expired }, data: { expiresAt: new Date(0) } });
    await request('GET', `/api/invitations/${expired}`, null, null, 410);
    await accept(expired, B, 410);
    await request('POST', `/api/invitations/${expired}/decline`, null, B.accessToken, 410);
    await request('GET', '/api/invitations/not-a-token', null, null, 404);
    await request('POST', '/api/invitations', { inviteeEmail: emails[0], relationshipType: 'family', proposedRole: 'caregiver' }, A.accessToken, 400);
    await request('POST', '/api/invitations', { inviteeEmail: emails[1], relationshipType: 'family', proposedRole: 'invalid' }, A.accessToken, 400);
    const patientInvite = await invite(A, emails[1], 'patient');
    const asPatient = (await accept(patientInvite, B)).relationship;
    assert.equal(asPatient.patientId, B.user.id); assert.equal(asPatient.caregiverId, A.user.id);
    console.log('PASS signup token continuation, patient invite direction, decline, expiry, self-invite, and replay rejection');

    const concurrent = await invite(A, emails[1]);
    const countBefore = await prisma.caregiverPatientLink.count({ where: { invitedByUserId: A.user.id } });
    const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/invitations/${concurrent}/accept`, {
      method: 'POST', headers: { Authorization: `Bearer ${B.accessToken}` },
    })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    await Promise.all(responses.map((response) => response.json()));
    assert.equal(await prisma.caregiverPatientLink.count({ where: { invitedByUserId: A.user.id } }), countBefore + 1);

    const rollback = await invite(A, emails[1]);
    const beforeRollback = await prisma.caregiverPatientLink.count({ where: { invitedByUserId: A.user.id } });
    const transaction = prisma.$transaction;
    try {
      // Inject a failure after the callback's writes, before PostgreSQL commits.
      prisma.$transaction = (callback, ...options) => transaction.call(prisma, async (tx) => {
        await callback(tx);
        throw new Error('Injected transaction failure');
      }, ...options);
      await accept(rollback, B, 500);
    } finally { prisma.$transaction = transaction; }
    assert.equal(await prisma.caregiverPatientLink.count({ where: { invitedByUserId: A.user.id } }), beforeRollback);
    const rolledBack = await prisma.invitation.findUnique({ where: { inviteToken: rollback } });
    assert.equal(rolledBack.status, 'sent'); assert.equal(rolledBack.respondedAt, null);
    await accept(rollback, B);
    console.log('PASS simultaneous accepts create one link; injected failure rolls back BOTH invitation and link, then retry succeeds');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (smtp.listening) await new Promise((resolve) => smtp.close(resolve));
    // Email selection also catches accounts created before a registration failure.
    const ownUsers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ownIds = ownUsers.map((user) => user.id);
    for (const id of ownIds) await revokeSession(id);
    await prisma.caregiverPatientLink.deleteMany({ where: { OR: [{ patientId: { in: ownIds } }, { caregiverId: { in: ownIds } }] } });
    await prisma.invitation.deleteMany({ where: { inviterUserId: { in: ownIds } } });
    await prisma.userPreference.deleteMany({ where: { userId: { in: ownIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownIds } } });
    redis.disconnect(); await prisma.$disconnect();
  }
});
