// Smoke test the NORMAL running server and its .env SMTP settings via Mailpit.
// Does not override SMTP settings or start an in-process API/SMTP fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../prismaClient.js';

const base = process.env.API_ORIGIN || 'http://localhost:3000';
const inbox = 'http://127.0.0.1:8025';
const email = `live-check-${randomUUID()}@example.com`;
const password = 'Local-check-password-42';
let userId;
const capturedMessages = [];

async function request(method, route, data, access, expected = 200) {
  const response = await fetch(base + route, {
    method, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
  console.log(`PASS ${method} ${route.startsWith('/api/auth/verify-email/') ? '/api/auth/verify-email/:token' : route} (${response.status})`);
  return result;
}

async function emailToken(subject, pattern) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(`${inbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    assert.ok(response.ok, 'Mailpit search must succeed');
    const found = (await response.json()).messages.find((message) => message.Subject === subject);
    if (found) {
      const message = await (await fetch(`${inbox}/api/v1/message/${found.ID}`)).json();
      const match = message.Text.match(pattern);
      assert.ok(match, 'Delivered email must contain the action token');
      capturedMessages.push(found.ID);
      console.log(`PASS Mailpit received: ${subject}`);
      return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Mailpit did not receive ${subject}`);
}

try {
  const registered = await request('POST', '/api/auth/register', { fullName: 'Live SMTP Check', email, password }, null, 201);
  userId = registered.user.id;
  assert.ok(registered.user.preferences);
  const verifyToken = await emailToken('Verify your MediTrack email', /verify-email\/([a-f0-9]{64})/);
  await request('GET', `/api/auth/verify-email/${verifyToken}`);
  const login = await request('POST', '/api/auth/login', { email, password });
  const rotated = await request('POST', '/api/auth/refresh', { refreshToken: login.refreshToken });
  await request('POST', '/api/auth/refresh', { refreshToken: login.refreshToken }, null, 401);
  await request('GET', '/api/users/me', null, rotated.accessToken);
  const profile = await request('PATCH', '/api/users/me', { fullName: 'Updated Live Check', address: 'Test address' }, rotated.accessToken);
  assert.equal(profile.user.fullName, 'Updated Live Check');
  const prefs = await request('PATCH', '/api/users/me/preferences', { preferredNotificationChannel: 'email', language: 'en', theme: 'dark', timezone: 'Asia/Kolkata' }, rotated.accessToken);
  assert.equal(prefs.preferences.theme, 'dark');
  await request('POST', '/api/auth/forgot-password', { email });
  const token = await emailToken('Reset your MediTrack password', /token=([a-f0-9]{64})/);
  await request('POST', '/api/auth/reset-password', { token, newPassword: 'Changed-live-password-42' });
  await request('POST', '/api/auth/refresh', { refreshToken: rotated.refreshToken }, null, 401);
  await request('POST', '/api/auth/login', { email, password }, null, 401);
  const resetLogin = await request('POST', '/api/auth/login', { email, password: 'Changed-live-password-42' });
  await request('POST', '/api/auth/logout', null, resetLogin.accessToken);
  await request('POST', '/api/auth/refresh', { refreshToken: resetLogin.refreshToken }, null, 401);
  console.log('PASS: complete local flow using the running API and actual .env SMTP configuration.');
} finally {
  // Remove only this run's generated test account and captured emails.
  if (userId) {
    await prisma.userPreference.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }
  for (const id of capturedMessages) await fetch(`${inbox}/api/v1/messages`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [id] }),
  });
  await prisma.$disconnect();
}
