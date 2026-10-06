// Uses the configured development PostgreSQL/Redis and a loopback SMTP capture.
// Google resolution is tested with fixture claims; real Google token verification is never bypassed by HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../prismaClient.js';
import redis from '../config/redis.js';
import app from '../app.js';
import { resolveGoogleAccount } from '../services/auth.service.js';
import { revokeSession } from '../services/token.service.js';

test('Phase 1 local HTTP sequence and Google account resolution', async (t) => {
  // The SDK fetches certificates even for a malformed token. Stub only that
  // network boundary; the real verifier must still reject the invalid token.
  t.mock.method(OAuth2Client.prototype, 'getFederatedSignonCertsAsync', async () => ({ certs: {} }));
  const suffix = randomUUID();
  const email = `phase1-${suffix}@example.com`;
  const googleEmail = `google-${suffix}@example.com`;
  const mail = [];
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
  const ids = [];
  try {
    await Promise.all([prisma.$connect(), redis.connect()]);
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(smtp.address().port);
    process.env.SMTP_SECURE = 'false'; process.env.MAIL_FROM = 'test@meditrack.local';
    process.env.GOOGLE_CLIENT_ID ||= 'integration-test.apps.googleusercontent.com';
    delete process.env.SMTP_USER;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(method, path, data, token, status = 200) {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
      const value = await res.json();
      assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
      return value;
    }
    function actionToken(kind) {
      const message = mail.at(-1).replace(/=\n/g, '').replace(/=3D/g, '=');
      const pattern = kind === 'verify' ? /verify-email\/([a-f0-9]{64})/ : /token=([a-f0-9]{64})/;
      assert.match(message, pattern); return message.match(pattern)[1];
    }
    await request('GET', '/api/users/me', null, null, 401);
    await request('POST', '/api/auth/google', { idToken: 'not-a-google-token' }, null, 401);
    await request('POST', '/api/auth/register', { fullName: 'Test', email, password: 'short' }, null, 400);
    const registered = await request('POST', '/api/auth/register', { fullName: 'Phase One', email, password: 'Initial-password-42' }, null, 201);
    ids.push(registered.user.id);
    assert.ok(registered.user.preferences); assert.equal(registered.user.passwordHash, undefined);
    const stored = await prisma.user.findUnique({ where: { email } }); assert.match(stored.passwordHash, /^\$2b\$12\$/);
    const verification = actionToken('verify');
    const verificationMail = mail.at(-1).replace(/=\n/g, '').replace(/=3D/g, '=');
    assert.ok(verificationMail.includes(`${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/verify-email/${verification}`));
    await request('POST', '/api/auth/login', { email, password: 'Initial-password-42' }, null, 403);
    await request('GET', `/api/auth/verify-email/${verification}`);
    await request('GET', `/api/auth/verify-email/${verification}`, null, null, 400);
    const login = await request('POST', '/api/auth/login', { email, password: 'Initial-password-42' });
    const rotated = await request('POST', '/api/auth/refresh', { refreshToken: login.refreshToken });
    assert.notEqual(rotated.refreshToken, login.refreshToken);
    await request('POST', '/api/auth/refresh', { refreshToken: login.refreshToken }, null, 401);
    await request('GET', '/api/users/me', null, rotated.refreshToken, 401);
    const edited = await request('PATCH', '/api/users/me', { fullName: 'Edited User', phoneNumber: '+911234567890', address: 'Test address' }, rotated.accessToken);
    assert.equal(edited.user.fullName, 'Edited User');
    await request('PATCH', '/api/users/me', { emailVerified: true }, rotated.accessToken, 400);
    const prefs = await request('PATCH', '/api/users/me/preferences', { preferredNotificationChannel: 'email', language: 'en', theme: 'dark', timezone: 'Asia/Kolkata' }, rotated.accessToken);
    assert.equal(prefs.preferences.theme, 'dark');
    await request('PATCH', '/api/users/me/preferences', { theme: 'invalid' }, rotated.accessToken, 400);
    await request('POST', '/api/auth/forgot-password', { email }); const reset = actionToken('reset');
    await request('POST', '/api/auth/reset-password', { token: reset, newPassword: 'Changed-password-42' });
    await request('POST', '/api/auth/reset-password', { token: reset, newPassword: 'Changed-password-42' }, null, 400);
    await request('POST', '/api/auth/refresh', { refreshToken: rotated.refreshToken }, null, 401);
    await request('POST', '/api/auth/login', { email, password: 'Initial-password-42' }, null, 401);
    const afterReset = await request('POST', '/api/auth/login', { email, password: 'Changed-password-42' });
    await request('POST', '/api/auth/logout', null, afterReset.accessToken);
    await request('POST', '/api/auth/refresh', { refreshToken: afterReset.refreshToken }, null, 401);
    console.log('PASS: register -> verify -> login -> refresh -> edit profile -> preferences -> forgot -> reset -> login -> logout; revoked/reused tokens rejected.');

    const claims = { sub: `local-${suffix}`, email, name: 'Google Name', email_verified: true };
    const linked = await resolveGoogleAccount(claims);
    assert.equal(linked.id, registered.user.id); assert.equal(linked.authProvider, 'local'); assert.ok(linked.passwordHash);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    assert.equal((await resolveGoogleAccount(claims)).id, linked.id);
    await request('POST', '/api/auth/login', { email, password: 'Changed-password-42' });
    const freshClaims = { ...claims, sub: `google-${suffix}`, email: googleEmail, picture: 'https://example.com/avatar.png' };
    const creations = await Promise.all([resolveGoogleAccount(freshClaims), resolveGoogleAccount(freshClaims)]);
    const created = creations[0]; ids.push(created.id);
    assert.equal(creations[1].id, created.id);
    assert.equal(await prisma.user.count({ where: { email: googleEmail } }), 1);
    assert.equal(created.authProvider, 'google'); assert.equal(created.passwordHash, null); assert.equal(created.emailVerified, true);
    assert.ok(await prisma.userPreference.findUnique({ where: { userId: created.id } }));
    const concurrent = await Promise.all([resolveGoogleAccount(freshClaims), resolveGoogleAccount(freshClaims)]);
    assert.ok(concurrent.every((user) => user.id === created.id));
    const denied = await request('POST', '/api/auth/login', { email: googleEmail, password: 'Any-password-42' }, null, 400);
    assert.match(denied.error, /Google Sign-In/);
    const before = mail.length; await request('POST', '/api/auth/forgot-password', { email: googleEmail }); assert.equal(mail.length, before);
    await assert.rejects(resolveGoogleAccount({ ...claims, sub: `other-${suffix}` }), /another Google account/);
    await assert.rejects(resolveGoogleAccount({ ...freshClaims, email_verified: false }), /verified email/);
    await prisma.user.update({ where: { id: created.id }, data: { isActive: false } });
    await assert.rejects(resolveGoogleAccount(freshClaims), /unavailable/);
    console.log('PASS: Google (a) existing identity, (b) local link without duplicate, (c) new Google-only user; Google-only password/reset restrictions. Real Google browser flow remains separate.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => smtp.close(resolve));
    for (const id of ids) await revokeSession(id);
    await prisma.userPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    redis.disconnect(); await prisma.$disconnect();
  }
});
