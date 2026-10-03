// Real API/browser verification. Run: node client/tests/phase10-real.mjs
// Requires the existing development PostgreSQL, Redis, seed data and Gemini key.
// Creates and removes only its own temporary accounts; no intercepted API data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer as httpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
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
const output = fileURLToPath(new URL('../.cache/phase10/', import.meta.url));
const disclaimer = 'This is not medical advice. Consult your doctor.';
let fixtures, backend, runtime, vite, browser;
try {
  assert.notEqual(process.env.NODE_ENV, 'production');
  await mkdir(output, { recursive: true });
  const seeded = await prisma.drugInteraction.findFirst({ where: { medicineNameA: 'simvastatin', medicineNameB: 'clarithromycin' } });
  assert.ok(seeded, 'Run the existing static seed before verification.');
  const password = randomBytes(24).toString('base64url');
  fixtures = await prisma.$transaction((db) => createDashboardFixtures(db, { password, now: new Date(Date.now() - 86400000) }), { timeout: 30000 });
  const { patient, caregiver, links } = fixtures;
  await redis.connect();
  backend = httpServer();
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${backend.address().port}`;
  const token = (user) => jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), {
    algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '1h',
  });
  async function api(user, path, method = 'GET', body, expected = 200) {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json',
    }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  vite = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)),
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(base) },
    server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
  process.env.CLIENT_ORIGIN = origin;
  const { default: app } = await import('../../server/src/app.js');
  backend.on('request', app);
  runtime = installScanRuntime(backend); app.locals.scanRuntime = runtime;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  async function login(target, user) {
    await target.goto(`${origin}/login`);
    await target.getByRole('textbox', { name: /^Email/ }).fill(user.email);
    await target.getByLabel(/^Password/).fill(password);
    await target.getByRole('button', { name: 'Log in', exact: true }).click();
    await target.waitForURL('**/dashboard');
  }
  await login(page, patient);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Chat', exact: true })).toBeVisible();
  const medicationIds = [];
  for (const name of ['simvastatin', 'clarithromycin']) {
    await page.goto(`${origin}/medications/add`);
    await page.getByLabel('Medicine name', { exact: false }).fill(name);
    await page.getByLabel('Medicine form', { exact: false }).selectOption('tablet');
    await page.getByLabel('Dose amount', { exact: false }).fill('1');
    await page.getByLabel('Dose unit', { exact: false }).fill('test unit');
    await page.getByLabel('Frequency', { exact: false }).fill('Test only');
    await page.getByRole('button', { name: 'Save medication', exact: true }).click();
    await page.waitForURL(/\/medications\/\d+\?patientId=/);
    medicationIds.push(Number(new URL(page.url()).pathname.split('/').at(-1)));
  }
  const combined = await api(patient, '/insights');
  const flag = combined.interactionFlags.find((row) => row.interactionId === seeded.id);
  assert.ok(flag); assert.equal(flag.kind, 'interaction');
  const warning = page.locator(`[data-insight-id="${flag.dismissId}"]`);
  await expect(warning).toContainText('Interaction warning · severe');
  await expect(warning).toContainText('clarithromycin');
  await expect(warning).toContainText('simvastatin');
  await expect(warning).toContainText(seeded.description);
  const source = seeded.sourceReference.match(/https?:\/\/[^\s<>]+/)[0];
  await expect(warning.getByRole('link')).toHaveAttribute('href', source);
  const sourceResponse = await fetch(source, { signal: AbortSignal.timeout(30000) });
  assert.ok(sourceResponse.ok, 'Seed source URL must load.');
  await page.screenshot({ path: `${output}/01-medication-warning.png`, fullPage: true });
  await page.goto(`${origin}/medications`);
  await expect(warning).toBeVisible();
  await page.goto(`${origin}/dashboard`);
  await expect(warning).toBeVisible();
  console.log('PASS: adding real seeded simvastatin + clarithromycin through the form produces a severe warning on detail, list and dashboard; the exact source link returns HTTP success.');

  await page.goto(`${origin}/medications/${medicationIds[0]}`);
  await page.getByRole('link', { name: 'Ask about this medication' }).click();
  await page.getByRole('button', { name: 'Start medication conversation' }).click();
  await page.waitForURL(/\/chat\/\d+$/);
  const conversationId = Number(new URL(page.url()).pathname.split('/').at(-1));
  const own = await api(patient, '/chat/conversations');
  assert.equal(own.conversations.find((row) => row.id === conversationId).relatedMedicationId, medicationIds[0]);
  const composer = page.getByRole('textbox', { name: 'Message', exact: false });
  await composer.fill(' ');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await composer.fill('x'.repeat(4001));
  await expect(page.getByText('Use 4,000 characters or fewer.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await composer.fill('x'.repeat(4000));
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  for (const [index, message] of ['What is this medication generally used for?', 'Tell me a short joke about a penguin.'].entries()) {
    await composer.fill(message);
    const response = page.waitForResponse((r) => r.url().endsWith(`/chat/conversations/${conversationId}/messages`) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(composer).toBeDisabled();
    await expect(page.getByText('Generating a reply… You can send another message when it finishes.')).toBeVisible();
    const sent = await response;
    assert.equal(sent.status(), 201, JSON.stringify(await sent.json()));
    await expect(page.locator('[data-disclaimer-shown="true"]')).toHaveCount(index + 1, { timeout: 10000 });
    for (const element of await page.locator('[data-disclaimer-shown]').all()) await expect(element).toHaveText(disclaimer);
  }
  await page.getByRole('button', { name: 'Refresh messages' }).click();
  await expect(page.locator('[data-disclaimer-shown="true"]')).toHaveCount(2);
  const stored = await api(patient, `/chat/conversations/${conversationId}/messages`);
  assert.ok(stored.messages.every((message) => message.disclaimerShown === true));
  for (const message of stored.messages) {
    const text = page.locator(`[data-message-id="${message.id}"] [class*="summary"]`);
    const expectedBody = message.senderType === 'ai' && message.messageText.startsWith(stored.disclaimer)
      ? message.messageText.slice(stored.disclaimer.length).replace(/^\n+/, '') : message.messageText;
    await expect(text).toHaveText(expectedBody, { useInnerText: true });
    assert.equal(await text.textContent(), expectedBody);
    if (message.senderType === 'ai') {
      const reply = page.locator(`[data-message-id="${message.id}"]`);
      const shownDisclaimer = reply.locator('[data-disclaimer-shown="true"]');
      await expect(shownDisclaimer).toHaveCount(1);
      await expect(shownDisclaimer).toBeVisible();
      assert.equal(await shownDisclaimer.textContent(), disclaimer);
      assert.equal((await reply.innerText()).split(disclaimer).length - 1, 1);
    }
    assert.equal(await text.evaluate((node) => getComputedStyle(node).whiteSpace), 'pre-wrap');
    assert.equal(await text.locator('*').count(), 0);
  }
  await page.screenshot({ path: `${output}/02-chat-disclaimers.png`, fullPage: true });
  console.log('PASS: medication and unrelated Gemini replies both show the exact unconditional disclaimer; stored flags are true, history persists, and all content is plain text. 1–4000 validation and in-flight disabling passed.');

  // A real concurrent request exercises the server's 409 without mocking it.
  const inFlight = api(patient, `/chat/conversations/${conversationId}/messages`, 'POST', { messageText: 'Say hello briefly.' }, 201);
  await expect.poll(async () => (await api(patient, `/chat/conversations/${conversationId}/messages`)).messages.length).toBe(5);
  await composer.fill('Another message while the reply is pending.');
  const conflictResponse = page.waitForResponse((r) => r.url().endsWith(`/chat/conversations/${conversationId}/messages`) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send message' }).click();
  assert.equal((await conflictResponse).status(), 409);
  await expect(composer).toBeDisabled();
  await expect(page.getByText('Composer paused while a reply is being generated.')).toBeVisible();
  await inFlight;
  await page.getByRole('button', { name: 'Refresh messages' }).click();
  await expect(page.locator('[data-disclaimer-shown="true"]')).toHaveCount(3);
  await expect(composer).toBeEnabled();
  await composer.fill('');
  console.log('PASS: real concurrent generation returns 409; the composer pauses and recovers through Refresh messages.');

  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/03-chat-mobile.png`, fullPage: true });
  assert.deepEqual((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => v.id), []);
  await page.setViewportSize({ width: 1440, height: 1050 });

  console.log('Generating the real weekly adherence insight…');
  const generated = await api(patient, '/insights/generate', 'POST', {});
  assert.ok(generated.insight?.insightText);
  const adherenceId = `adherence-${generated.insight.id}`;
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator(`[data-insight-id="${adherenceId}"]`)).toContainText(generated.insight.insightText);
  await page.screenshot({ path: `${output}/04-dashboard-insights.png`, fullPage: true });

  const caregiverContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const care = await caregiverContext.newPage();
  await login(care, caregiver);
  for (const level of ['view_only', 'full_access', 'alerts_only']) {
    await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: level });
    await care.goto(`${origin}/patients/${patient.id}`);
    await expect(care.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Chat', exact: true })).toHaveCount(0);
    const archive = await api(caregiver, `/chat/conversations?patientId=${patient.id}`);
    assert.equal(archive.conversations.some((row) => row.id === conversationId), false);
    await api(caregiver, `/chat/conversations/${conversationId}/messages`, 'GET', undefined, 404);
    await api(caregiver, `/chat/conversations/${conversationId}/messages`, 'POST', { messageText: 'Unauthorized' }, 404);
    await api(caregiver, '/chat/conversations', 'POST', { relatedMedicationId: medicationIds[0] }, 404);
    if (level === 'alerts_only') {
      await expect(care.locator('#insights')).toContainText('Alerts-only access does not include Insights.');
      await api(caregiver, `/insights?patientId=${patient.id}`, 'GET', undefined, 403);
      await care.screenshot({ path: `${output}/05-alerts-only-restricted.png`, fullPage: true });
    } else {
      await expect(care.locator(`[data-insight-id="${flag.dismissId}"]`)).toBeVisible();
      await expect(care.locator(`[data-insight-id="${adherenceId}"]`)).toBeVisible();
      await expect(care.getByRole('button', { name: 'Acknowledge interaction' })).toHaveCount(level === 'full_access' ? 1 : 0);
    }
    if (level !== 'full_access') await api(caregiver, `/insights/${flag.dismissId}/dismiss`, 'PATCH', { kind: 'interaction' }, 403);
  }
  await care.goto(`${origin}/chat/${conversationId}`);
  await expect(care.getByText('Conversation not found.', { exact: true })).toBeVisible();
  await expect(care.locator('[data-message-id]')).toHaveCount(0);
  await care.goto(`${origin}/chat?patientId=${patient.id}`);
  await expect(care.getByText('Chat is private to its owner. Caregivers cannot view a patient’s conversations.')).toBeVisible();
  await care.goto(`${origin}/chat?relatedMedicationId=${medicationIds[0]}`);
  // Even full-access medication reading must never enable a patient chat.
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'full_access' });
  await care.reload();
  await expect(care.getByText('You can only start chats about your own medications.')).toBeVisible();
  await care.goto(`${origin}/medications/${medicationIds[0]}?patientId=${patient.id}`);
  await expect(care.getByRole('link', { name: 'Ask about this medication' })).toHaveCount(0);
  console.log('PASS: all three caregiver permission levels are denied patient chat GET/POST and medication-scoped creation. Alerts-only sees an explicit Insights restriction; view-only cannot dismiss.');

  await care.goto(`${origin}/patients/${patient.id}`);
  const identity = await care.evaluate(() => { window.phase10Document = crypto.randomUUID(); return window.phase10Document; });
  await care.getByRole('button', { name: 'Dismiss adherence insight' }).click();
  await expect(care.locator(`[data-insight-id="${adherenceId}"]`)).toHaveCount(0);
  await care.getByRole('button', { name: 'Acknowledge interaction' }).click();
  await expect(care.locator(`[data-insight-id="${flag.dismissId}"]`)).toHaveCount(0);
  assert.equal(await care.evaluate(() => window.phase10Document), identity);
  for (const [id, kind, field] of [[adherenceId, 'adherence', 'dismissedAt'], [flag.dismissId, 'interaction', 'acknowledgedAt']]) {
    const first = await api(caregiver, `/insights/${id}/dismiss`, 'PATCH', { kind });
    const second = await api(caregiver, `/insights/${id}/dismiss`, 'PATCH', { kind });
    assert.equal(first[field], second[field]);
  }
  await care.getByRole('button', { name: 'Refresh insights' }).click();
  await expect(care.locator('#insights')).toContainText('No unacknowledged interaction flags.');
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'alerts_only' });
  await care.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(care.locator('#insights')).toContainText('Restricted access.');
  await page.goto(`${origin}/dashboard`);
  await expect(page.locator(`[data-insight-id="${flag.dismissId}"]`)).toHaveCount(0);
  console.log('PASS: full-access caregiver dismisses both types without a document reload; repeated PATCH calls preserve timestamps. Refresh and permission downgrade are handled.');
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual((await new AxeBuilder({ page }).include('#insights').withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => v.id), []);
  assert.deepEqual(errors, []);
  console.log('PASS: mobile chat and Insights accessibility checks; no browser runtime errors. Screenshots: client/.cache/phase10/.');
} catch (error) {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await vite?.close(); await runtime?.close();
  if (backend?.listening) await new Promise((resolve) => backend.close(resolve));
  if (fixtures) {
    const ids = [fixtures.patient.id, fixtures.secondPatient.id, fixtures.caregiver.id];
    await prisma.aiChatMessage.deleteMany({ where: { conversation: { userId: { in: ids } } } });
    await prisma.aiChatConversation.deleteMany({ where: { userId: { in: ids } } });
    await prisma.aiInsight.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationInteractionFlag.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.weeklySummaryReport.deleteMany({ where: { patientId: { in: ids } } });
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
  redis.disconnect(); await prisma.$disconnect();
}
