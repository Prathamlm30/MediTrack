// Real Express, PostgreSQL, Redis, Socket.io, Gemini, and browser verification.
// From the repository root: node client/tests/phase89-real.mjs [--keep]
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
import { reportWindow } from '../../server/src/jobs/weeklyReportData.js';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const jwt = require('jsonwebtoken');
const keep = process.argv.includes('--keep');
const output = fileURLToPath(new URL('../.cache/phase89/', import.meta.url));
let fixtures, backend, runtime, vite, browser;
try {
  if (process.env.NODE_ENV === 'production') throw new Error('Development verification only.');
  await mkdir(output, { recursive: true });
  const password = randomBytes(24).toString('base64url');
  fixtures = await prisma.$transaction((db) => createDashboardFixtures(db, {
    password, now: new Date(reportWindow().end.getTime() - 86400000),
  }), { timeout: 30000 });
  const { patient, secondPatient, caregiver, links, schedules } = fixtures;
  if (keep) await writeFile(fileURLToPath(new URL('../.env.phase89-demo', import.meta.url)),
    `DEMO_PASSWORD=${password}\nPATIENT_EMAIL=${patient.email}\nPATIENT_ID=${patient.id}\nSECOND_PATIENT_EMAIL=${secondPatient.email}\nSECOND_PATIENT_ID=${secondPatient.id}\nCAREGIVER_EMAIL=${caregiver.email}\nCAREGIVER_ID=${caregiver.id}\nFIRST_LINK_ID=${links[0].id}\nSECOND_LINK_ID=${links[1].id}\nFIRST_SCHEDULE_ID=${schedules[0].id}\nSECOND_SCHEDULE_ID=${schedules[3].id}\n`);
  // This isolated process uses a short grace period; the running dev server is unchanged.
  process.env.ESCALATION_GRACE_PERIOD_MINUTES = '0.001';
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
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'full_access' });

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const sockets = new Set(); let connections = 0;
  page.on('websocket', (ws) => { if (ws.url().includes('/socket.io/')) { connections++; sockets.add(ws); ws.on('close', () => sockets.delete(ws)); } });
  const seenResponses = [];
  page.on('response', (response) => { if (response.url().includes('/api/')) seenResponses.push([new URL(response.url()).pathname, response.status()]); });
  await page.goto(`${origin}/login`);
  console.log('Browser loaded; signing in through the real login form.');
  await page.getByRole('textbox', { name: /^Email/ }).fill(caregiver.email);
  await page.getByLabel(/^Password/, { exact: false }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Alerts', exact: true }).click();
  await expect(page.getByText('Live updates connected.', { exact: true })).toBeVisible();
  await expect(page.getByText('No open alerts for this patient.')).toHaveCount(2);
  const documentIdentity = await page.evaluate(() => { window.phase89Document = crypto.randomUUID(); return window.phase89Document; });
  async function escalate(person, scheduleId) {
    const dose = await api(person, '/escalations/dev/overdue-dose', 'POST', { scheduleId }, 201);
    await api(person, '/escalations/jobs/run', 'POST', { patientId: person.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const delivered = await api(person, '/escalations/jobs/run', 'POST', { patientId: person.id });
    assert.ok(delivered.level2Created > 0);
    const alerts = await api(caregiver, `/escalations/active?patientId=${person.id}`);
    return { dose, alert: alerts.find((row) => row.doseLogId === dose.id) };
  }
  const second = await escalate(secondPatient, schedules[3].id);
  const secondRow = page.locator(`[data-alert-id="${second.alert.id}"]`);
  await expect(secondRow).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Missed dose alert for Demo Patient Two');
  await expect(secondRow).toContainText('Level 2');
  await page.screenshot({ path: `${output}/01-live-alert.png`, fullPage: true });
  const connectionsAtAlerts = connections;
  await secondRow.getByRole('button', { name: /Resolve/ }).click();
  await expect(secondRow).toContainText('Log the dose as taken before resolving its alert.');
  assert.ok(seenResponses.some(([path, status]) => path === `/api/escalations/${second.alert.id}/resolve` && status === 409));
  await page.screenshot({ path: `${output}/02-resolve-409.png`, fullPage: true });
  await api(secondPatient, `/dose-logs/${second.dose.id}`, 'PATCH', { status: 'taken' });
  await secondRow.getByRole('button', { name: /Resolve/ }).click();
  await expect(secondRow).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Alert resolved.');
  assert.equal(await page.evaluate(() => window.phase89Document), documentIdentity);
  assert.equal((await api(caregiver, `/escalations/active?patientId=${secondPatient.id}`)).some((row) => row.id === second.alert.id), false);
  await page.screenshot({ path: `${output}/03-resolved-without-reload.png`, fullPage: true });
  console.log('PASS: alerts_only received a real socket alert and toast, saw the exact 409, and resolved after the patient logged taken; the row disappeared without reload.');

  const first = await escalate(patient, schedules[0].id);
  const firstRow = page.locator(`[data-alert-id="${first.alert.id}"]`);
  await expect(firstRow).toBeVisible();
  await api(patient, `/dose-logs/${first.dose.id}`, 'PATCH', { status: 'taken' });
  await firstRow.getByRole('button', { name: /Resolve/ }).click();
  await expect(firstRow).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Patients', exact: true }).click();
  await page.getByRole('link', { name: 'View dashboard for Demo Patient Two', exact: true }).click();
  await expect(page.locator('#weekly-reports')).toContainText('Restricted access. Weekly reports include adherence details');
  await expect.poll(() => seenResponses.some(([path, status]) => path === '/api/reports/weekly' && status === 403)).toBe(true);
  await expect(page.getByRole('button', { name: 'Open report', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${output}/04-reports-restricted.png`, fullPage: true });
  console.log('PASS: the same alerts_only caregiver receives a real weekly-report 403 and sees a clear restricted section.');

  console.log('Generating a real Gemini weekly report through the existing dev route…');
  const job = await api(caregiver, '/reports/weekly/jobs/run', 'POST', { patientId: patient.id });
  assert.ok(job.reportIds.length > 0);
  const archive = await api(caregiver, `/reports/weekly?patientId=${patient.id}`);
  const report = await api(caregiver, `/reports/weekly/${archive[0].id}`);
  assert.ok(report.summaryText.length > 0); assert.equal(report.sentStatus, 'sent');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Patients', exact: true }).click();
  await page.getByRole('link', { name: 'Weekly reports for Demo Patient One', exact: true }).click();
  await page.getByRole('button', { name: /Open weekly report/ }).first().click();
  const summary = page.getByRole('dialog').locator('[class*="summary"]');
  await expect(summary).toHaveText(report.summaryText);
  assert.equal(await summary.evaluate((element) => getComputedStyle(element).whiteSpace), 'pre-wrap');
  assert.equal(await summary.textContent(), report.summaryText);
  await page.screenshot({ path: `${output}/05-full-report.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'view_only' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: /Open weekly report/ }).first().click();
  await expect(summary).toHaveText(report.summaryText);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole('button', { name: /Open weekly report/ }).first().click();
  await expect(summary).toHaveText(report.summaryText);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const reportA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  assert.deepEqual(reportA11y.violations.map((v) => v.id), []);
  await page.screenshot({ path: `${output}/06-report-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  assert.equal(connections, connectionsAtAlerts, 'SPA navigation must reuse the existing socket.');
  assert.equal(sockets.size, 1);
  console.log('PASS: full_access and view_only opened the complete real Gemini summary, matching summaryText byte-for-byte, with sentStatus shown. Mobile report passes axe and has no horizontal overflow. Navigation reused one socket.');

  // Remove previously visible details promptly when a permission changes.
  await page.getByRole('button', { name: /Open weekly report/ }).first().click();
  await expect(summary).toHaveText(report.summaryText);
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'alerts_only' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#weekly-reports')).toContainText('Restricted access.');
  await api(patient, `/relationships/${links[0].id}/permissions`, 'PATCH', { permissionLevel: 'full_access' });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Patients', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh patients' }).click();
  await page.getByRole('link', { name: 'View alerts for Demo Patient Two', exact: true }).click();
  await expect(page.getByText('Live updates connected.', { exact: true })).toBeVisible();
  const retained = await escalate(secondPatient, schedules[3].id);
  await expect(page.locator(`[data-alert-id="${retained.alert.id}"]`)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const alertsA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  assert.deepEqual(alertsA11y.violations.map((v) => v.id), []);
  await page.screenshot({ path: `${output}/07-alerts-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: live permission downgrade removes report text, patient-card shortcuts work, and mobile alerts pass axe without overflow.');
  if (keep) console.log(`Retained test accounts: ${caregiver.email} (caregiver), ${patient.email} (full_access patient), ${secondPatient.email} (alerts_only patient). Password and IDs are in client/.env.phase89-demo. Screenshots: client/.cache/phase89/.`);
} catch (error) {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await vite?.close(); await runtime?.close();
  if (backend?.listening) await new Promise((resolve) => backend.close(resolve));
  if (fixtures && !keep) {
    const ids = [fixtures.patient.id, fixtures.secondPatient.id, fixtures.caregiver.id];
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.weeklySummaryReport.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.escalationAlert.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.adherenceStat.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
    await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  redis.disconnect(); await prisma.$disconnect();
}
