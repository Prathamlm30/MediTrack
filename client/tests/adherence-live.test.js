import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer as createVite } from 'vite';
import app from '../../server/src/app.js';
import prisma from '../../server/src/prismaClient.js';
import { requiredEnv } from '../../server/src/config/env.js';
import { installScanRuntime } from '../../server/src/routes/prescription-scans/runtime.js';
import { runDoseLogJob } from '../../server/src/jobs/doseLogJob.js';
import { patientDate } from '../../server/src/jobs/adherenceCalendar.js';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const jwt = require('jsonwebtoken');

test('real socket refreshes adherence immediately; 30-second fallback survives missed events', async (t) => {
  let patient, backend, runtime, vite, browser;
  const previousRuntime = app.locals.scanRuntime;
  const previousOrigin = process.env.CLIENT_ORIGIN;
  // This test exercises the existing socket server, without processing unrelated OCR work.
  const originalScanLookup = prisma.prescriptionScan.findFirst;
  prisma.prescriptionScan.findFirst = async () => null;
  t.after(() => { prisma.prescriptionScan.findFirst = originalScanLookup; });
  try {
    patient = await prisma.user.create({ data: { fullName: 'Live adherence test', email: `adherence-live-${randomUUID()}@example.test`, emailVerified: true, timezone: 'Asia/Kolkata' } });
    const token = jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(patient.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '10m' });
    backend = createServer(app);
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${backend.address().port}`;
    vite = await createVite({ root: fileURLToPath(new URL('../', import.meta.url)), define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(base) }, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
    await vite.listen();
    process.env.CLIENT_ORIGIN = vite.resolvedUrls.local[0].replace(/\/$/, '');
    runtime = installScanRuntime(backend);
    app.locals.scanRuntime = runtime;
    async function api(path, method = 'GET', body) {
      const response = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
      const result = await response.json();
      assert.ok(response.ok, JSON.stringify(result));
      return result;
    }
    const today = patientDate(new Date(), patient.timezone);
    const med = await api('/medications', 'POST', { medicineName: 'Live test tablet', medicineForm: 'tablet', trackingType: 'countable', dosageAmount: 10, dosageUnit: 'mg', frequencyText: 'daily', startDate: today });
    await api(`/medications/${med.id}/schedules`, 'POST', { timeOfDay: '08:00', daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 });
    await api(`/medications/${med.id}/inventory`, 'POST', { quantityTotal: 20, refillThreshold: 2, refillAmount: 20 });
    await runDoseLogJob({ patientId: patient.id, date: today });
    const [dose] = await api('/dose-logs/today');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.clock.install();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
    await page.goto(vite.resolvedUrls.local[0]);
    await page.getByRole('button', { name: 'Log in', exact: true }).waitFor();
    await page.evaluate(async (session) => { const { setSession } = await import('/src/api/client.js'); setSession(session); }, { accessToken: token, user: { id: patient.id, fullName: patient.fullName } });
    await page.waitForURL('**/dashboard');
    const socketConnected = page.waitForResponse(async (response) => new URL(response.url()).pathname === '/socket.io/' && (await response.text()).includes('40{'));
    await page.evaluate(() => { history.pushState(null, '', '/adherence'); dispatchEvent(new PopStateEvent('popstate')); });
    const streak = page.locator('dt').filter({ hasText: /^Current streak$/ }).locator('+ dd');
    await expect(streak).toHaveText('0 days');
    // Wait for the authenticated Socket.io connection, then pause polling.
    await socketConnected;
    await page.clock.pauseAt(new Date());
    const statsRequest = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/adherence/stats');
    await api(`/dose-logs/${dose.id}`, 'PATCH', { status: 'taken' });
    await statsRequest;
    await expect(streak).toHaveText('1 days');
    await expect(page.getByLabel(`${today}: 100% adherence`, { exact: true })).toBeVisible();
    const requests = [];
    page.on('request', (request) => { if (request.url().includes('/api/adherence/')) requests.push(request.url()); });
    // Miss a notification deliberately: only the unchanged 30-second interval can recover.
    const emit = runtime.emitStatsUpdated;
    runtime.emitStatsUpdated = () => {};
    await api(`/dose-logs/${dose.id}`, 'PATCH', { status: 'skipped' });
    assert.equal(requests.length, 0);
    await expect(streak).toHaveText('1 days');
    await page.clock.fastForward(30000);
    await expect(streak).toHaveText('0 days');
    await expect(page.getByLabel(`${today}: 0% adherence`, { exact: true })).toBeVisible();
    runtime.emitStatsUpdated = emit;
    assert.deepEqual(errors, []);
  } finally {
    app.locals.scanRuntime = previousRuntime;
    if (previousOrigin === undefined) delete process.env.CLIENT_ORIGIN; else process.env.CLIENT_ORIGIN = previousOrigin;
    await browser?.close();
    await vite?.close();
    if (runtime) await runtime.close();
    if (backend?.listening) await new Promise((resolve) => backend.close(resolve));
    if (patient) {
      const patientId = patient.id;
      await prisma.adherenceStat.deleteMany({ where: { patientId } });
      await prisma.doseLog.deleteMany({ where: { patientId } });
      await prisma.medicineInventory.deleteMany({ where: { patientId } });
      await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId } } });
      await prisma.medication.deleteMany({ where: { patientId } });
      await prisma.user.delete({ where: { id: patientId } });
    }
    await prisma.$disconnect();
  }
});
