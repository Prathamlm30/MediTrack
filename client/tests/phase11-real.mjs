// Isolated real Express/Socket.io, PostgreSQL, Redis, SMTP/Mailpit and Chrome.
// No route interception, provider stubs, server edits, or persistent test accounts.
// Run from repo root: node client/tests/phase11-real.mjs
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer as httpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import prisma from '../../server/src/prismaClient.js';
import redis from '../../server/src/config/redis.js';
import { requiredEnv } from '../../server/src/config/env.js';
import { createDashboardFixtures } from '../../server/prisma/devSeed.js';
import { installScanRuntime } from '../../server/src/routes/prescription-scans/runtime.js';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const jwt = require('jsonwebtoken');
const output = fileURLToPath(new URL('../.cache/phase11/', import.meta.url));
const mailpit = (process.env.MAILPIT_URL || 'http://127.0.0.1:8025').replace(/\/$/, '');
const mailIds = [], results = [];
let fixtures, backend, runtime, vite, browser;
const pass = (name) => { results.push(name); console.log(`PASS: ${name}`); };
try {
  assert.notEqual(process.env.NODE_ENV, 'production', 'Development verification only.');
  await mkdir(output, { recursive: true });
  assert.ok((await fetch(`${mailpit}/api/v1/info`)).ok, 'Mailpit must be available.');
  // Override only this isolated process. SMTP stays local and never emails people.
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = process.env.PHASE11_SMTP_PORT || '11025';
  process.env.SMTP_SECURE = 'false'; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  process.env.MAIL_FROM = 'MediTrack test <phase11@meditrack.local>';
  process.env.SUPPORT_INBOX = `phase11-${randomUUID()}@meditrack.local`;
  process.env.ESCALATION_GRACE_PERIOD_MINUTES = '0.001';
  const password = randomBytes(24).toString('base64url');
  fixtures = await prisma.$transaction((db) => createDashboardFixtures(db, { password }), { timeout: 30000 });
  const { patient, secondPatient, caregiver, links, schedules } = fixtures;
  // Ordinary stored fixtures keep unrelated dashboard AI generation out of this
  // test. The real route reads its normal weekly cache; no function is replaced.
  for (const person of [patient, secondPatient, caregiver]) await prisma.aiInsight.create({ data: { patientId: person.id, insightType: 'adherence_pattern', insightText: 'Phase 11 stored test insight.' } });
  await redis.connect();
  backend = httpServer();
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${backend.address().port}`;
  const token = (user) => jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '1h' });
  async function api(user, path, method = 'GET', body, status = 200) {
    const response = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${path} returned ${response.status}`);
    return response.json();
  }
  // Same-origin proxy preserves Retry-After for browser code. No backend CORS
  // configuration is changed; the existing API and socket handler remain real.
  vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)),
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/') },
    server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': base, '/socket.io': { target: base, ws: true } } }, logLevel: 'error' });
  await vite.listen(); const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  process.env.CLIENT_ORIGIN = origin;
  const { default: app } = await import('../../server/src/app.js'); backend.on('request', app);
  runtime = installScanRuntime(backend); app.locals.scanRuntime = runtime;
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'full_access' });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const careContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const patientContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const care = await careContext.newPage(), own = await patientContext.newPage();
  const errors = []; for (const page of [care, own]) page.on('pageerror', (e) => errors.push(e.message));
  let socketConnections = 0;
  const dashboardReads = [];
  care.on('request', (req) => { if (req.url().endsWith(`/api/dashboard/caregiver/${patient.id}`)) dashboardReads.push(Date.now()); });
  care.on('websocket', (ws) => { if (ws.url().includes('/socket.io/')) socketConnections++; });
  async function login(page, person) {
    await page.goto(`${origin}/login`); await page.getByLabel('Email', { exact: false }).fill(person.email);
    await page.getByLabel(/^Password/).fill(password); await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.waitForURL('**/dashboard'); await expect(page.getByRole('heading', { name: 'Your day', exact: true })).toBeVisible({ timeout: 15000 });
  }
  await login(care, caregiver); await login(own, patient);
  await care.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /^Notifications/ }).click();
  await expect(care.getByRole('heading', { name: 'No notifications yet.' })).toBeVisible();
  const documentId = await care.evaluate(() => { window.phase11Document = crypto.randomUUID(); return window.phase11Document; });
  async function escalate() {
    const dose = await api(patient, '/escalations/dev/overdue-dose', 'POST', { scheduleId: schedules[0].id }, 201);
    await api(patient, '/escalations/jobs/run', 'POST', { patientId: patient.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = await api(patient, '/escalations/jobs/run', 'POST', { patientId: patient.id });
    assert.ok(result.level2Created > 0); return dose;
  }
  const dose = await escalate(); await escalate();
  await expect(care.locator('[data-notification-id]')).toHaveCount(2, { timeout: 5000 });
  await expect(care.getByLabel('2 unread notifications')).toBeVisible();
  await expect(care.locator('[data-notification-id]').first()).toContainText('Escalation');
  const inbox = await api(caregiver, '/notifications');
  const first = inbox.notifications[0];
  await care.screenshot({ path: `${output}/01-real-escalation-inbox.png`, fullPage: true });
  await care.locator(`[data-notification-id="${first.id}"]`).getByRole('button', { name: 'Mark as read' }).click();
  await expect(care.getByLabel('1 unread notifications')).toBeVisible();
  await expect(care.getByText('Notification marked as read.')).toBeVisible();
  const once = await api(caregiver, `/notifications/${first.id}/read`, 'PATCH', {});
  const twice = await api(caregiver, `/notifications/${first.id}/read`, 'PATCH', {});
  assert.equal(once.notification.readAt, twice.notification.readAt);
  await care.screenshot({ path: `${output}/02-mark-read-badge.png`, fullPage: true });
  pass('Real escalation inbox arrives over shared socket; mark-read updates row and badge; repeated PATCH is idempotent');

  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'view_only' });
  await care.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(care.locator('[data-notification-id]')).toHaveCount(0); await expect(care.getByLabel('0 unread notifications')).toBeVisible();
  await api(caregiver, `/notifications/${first.id}/read`, 'PATCH', {}, 404);
  await care.screenshot({ path: `${output}/03-downgraded-inbox.png`, fullPage: true });
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'full_access' });
  await care.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(care.locator('[data-notification-id]')).toHaveCount(2); await expect(care.getByLabel('1 unread notifications')).toBeVisible();
  assert.equal(await care.evaluate(() => window.phase11Document), documentId);
  await care.screenshot({ path: `${output}/04-restored-inbox.png`, fullPage: true });
  pass('Downgrade removes escalation rows and unread badge; restoring access restores both without reload');

  await care.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Patients', exact: true }).click();
  // Age only this test's earlier identity-list audit so the actual dashboard read
  // is eligible under the real ten-minute throttle (no throttle override).
  await prisma.auditLog.updateMany({ where: { userId: caregiver.id, subjectPatientId: patient.id, actionType: 'caregiver_read' }, data: { timestamp: new Date(Date.now() - 660000) } });
  await care.getByRole('link', { name: `View dashboard for ${patient.fullName}` }).click();
  await expect(care.getByRole('heading', { name: `${patient.fullName}’s day` })).toBeVisible();
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId: caregiver.id, subjectPatientId: patient.id, actionType: 'caregiver_read', details: { path: ['route'], equals: '/api/dashboard/caregiver/:patientId' } }, orderBy: { id: 'desc' } });
  await own.goto(`${origin}/settings/activity`);
  await expect(own.locator(`[data-activity-id="${audit.id}"]`)).toContainText(`${caregiver.fullName} viewed your health information (dashboard).`);
  await expect(own.getByText(`You changed access for ${caregiver.fullName}: Full access to View only.`)).toBeVisible();
  await own.screenshot({ path: `${output}/05-patient-account-activity.png`, fullPage: true });
  pass('Patient Account activity displays the actual caregiver dashboard read and named permission changes');

  // Open the patient's dose controls before measuring; do not focus or refresh
  // the caregiver document. Measure while the 30-second fallback is not due.
  await own.goto(`${origin}/today`);
  const doses = await api(patient, '/dose-logs/today');
  const group = doses.filter((row) => row.schedule.medication.id === fixtures.medications[0].id);
  const index = group.findIndex((row) => row.id === dose.id); assert.ok(index >= 0);
  const articles = own.locator('section').filter({ has: own.getByRole('heading', { name: fixtures.medications[0].medicineName, exact: true }) }).locator('article');
  await expect(articles.nth(index).getByRole('button', { name: 'Taken', exact: true })).toBeEnabled();
  const marker = care.getByRole('figure').locator('[role="img"]').filter({ hasText: '' });
  const beforeDashboard = await api(caregiver, `/dashboard/caregiver/${patient.id}`);
  const doseIndex = beforeDashboard.todayDoses.findIndex((row) => row.id === dose.id); assert.ok(doseIndex >= 0);
  const doseMarker = marker.nth(doseIndex);
  await expect(doseMarker).toHaveAttribute('aria-label', /pending$/);
  assert.ok(Date.now() - dashboardReads.at(-1) < 15000, 'Dashboard poll must not be due during the five-second measurement.');
  await care.evaluate(() => { window.phase11Skeletons = 0; new MutationObserver(() => { if (document.querySelector('[aria-label="Loading dashboard"]')) window.phase11Skeletons++; }).observe(document.querySelector('main'), { childList: true, subtree: true }); });
  const start = Date.now(); await articles.nth(index).getByRole('button', { name: 'Taken', exact: true }).click();
  await expect(own.getByText('Dose marked taken.', { exact: true })).toBeVisible();
  await expect(doseMarker).toHaveAttribute('aria-label', /taken$/, { timeout: 3500 });
  const elapsed = Date.now() - start; assert.ok(elapsed < 5000, `Live update took ${elapsed}ms`);
  assert.equal(await care.evaluate(() => window.phase11Document), documentId);
  assert.equal(await care.evaluate(() => window.phase11Skeletons), 0);
  assert.equal(socketConnections, 1, 'SPA pages must share one socket connection.');
  await care.screenshot({ path: `${output}/06-live-caregiver-taken.png`, fullPage: true });
  pass(`Patient Took dose in real browser; caregiver updated in ${elapsed}ms without reload, skeleton or 30-second poll`);

  const subject = `Phase11 support ${randomUUID()}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await own.goto(`${origin}/support`);
    await own.getByLabel('Subject', { exact: false }).fill(subject);
    await own.getByLabel('Message', { exact: false }).fill(`Temporary verification message ${attempt}.`);
    const sent = own.waitForResponse((res) => res.url().endsWith('/api/support-tickets') && res.request().method() === 'POST');
    await own.getByRole('button', { name: 'Send message' }).click(); const response = await sent;
    assert.equal(response.status(), attempt <= 5 ? 201 : 429);
    if (attempt <= 5) await expect(own.getByText(`Your message was sent to support. You'll get a reply at ${patient.email} if one is needed.`)).toBeVisible();
    else { await expect(own.getByRole('alert')).toContainText('Wait 60 minutes'); await expect(own.getByLabel('Message', { exact: false })).toHaveValue('Temporary verification message 6.'); }
    if (attempt === 1) await own.screenshot({ path: `${output}/07-support-sent.png`, fullPage: true });
  }
  const mail = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${process.env.SUPPORT_INBOX}`)}`)).json();
  const messages = mail.messages.filter((m) => m.Subject === subject); mailIds.push(...messages.map((m) => m.ID));
  assert.equal(messages.length, 5);
  const message = await (await fetch(`${mailpit}/api/v1/message/${messages[0].ID}`)).json();
  assert.match(message.Text, /Temporary verification message/);
  assert.ok(JSON.stringify(message.ReplyTo).includes(patient.email));
  await own.screenshot({ path: `${output}/08-support-rate-limit.png`, fullPage: true });
  pass('Five support form submissions arrive in real Mailpit with account Reply-To; sixth shows 429 and retains contents');
  await own.setViewportSize({ width: 360, height: 900 });
  assert.equal(await own.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual((await new AxeBuilder({ page: own }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => v.id), []);
  assert.deepEqual(errors, []);
  pass('Real browser support at 360px passes axe and overflow checks; no browser runtime errors');
  await writeFile(`${output}/real-results.json`, JSON.stringify({ passed: results.length, failed: 0, results }, null, 2));
} catch (error) {
  console.error(error); process.exitCode = 1;
  const page = browser?.contexts().at(-1)?.pages()[0];
  if (page) await page.screenshot({ path: `${output}/real-failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser?.close(); await vite?.close(); await runtime?.close();
  if (backend?.listening) await new Promise((resolve) => backend.close(resolve));
  if (fixtures) {
    const ids = [fixtures.patient.id, fixtures.secondPatient.id, fixtures.caregiver.id];
    await redis.del(...ids.map((id) => `auth:refresh:${id}`));
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { subjectPatientId: { in: ids } }] } });
    await prisma.aiInsight.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.escalationAlert.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.adherenceStat.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.userPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  // Delete only messages addressed to this run's random support inbox.
  if (mailIds.length) await fetch(`${mailpit}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: mailIds }) }).catch(() => {});
  redis.disconnect(); await prisma.$disconnect();
}
