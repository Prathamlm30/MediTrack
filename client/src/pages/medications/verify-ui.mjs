// Run from repo root: node client/src/pages/medications/verify-ui.mjs
// Real browser + isolated Express port + development PostgreSQL; removes its own fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { storage } from '../../../../server/src/routes/prescription-scans/storage.js';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import app from '../../../../server/src/app.js';
import prisma from '../../../../server/src/prismaClient.js';
import { requiredEnv } from '../../../../server/src/config/env.js';
import { trackingByForm } from './medicineForm.js';
const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const jwt = require('jsonwebtoken');
let user, backend, vite, browser, imageUrl;
try {
  user = await prisma.user.create({ data: { fullName: 'Phase Five UI', email: `phase5-ui-${randomUUID()}@example.test`, emailVerified: true } });
  const accessToken = jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '10m' });
  backend = app.listen(0, '127.0.0.1'); await new Promise((resolve) => backend.once('listening', resolve));
  vite = await createServer({ root: fileURLToPath(new URL('../../../', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await vite.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
  const errors = []; page.on('pageerror', (err) => { errors.push(err.message); console.error('Browser error:', err.message); });
  await page.route((url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/'), async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://127.0.0.1:${backend.address().port}${url.pathname}${url.search}` });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  console.log('UI server ready:', vite.resolvedUrls.local[0]);
  await page.goto(vite.resolvedUrls.local[0]);
  console.log('UI loaded:', await page.title());
  await page.getByRole('button', { name: 'Log in', exact: true }).waitFor();
  await page.evaluate(async ({ accessToken, user }) => {
    const { setSession } = await import('/src/api/client.js'); setSession({ accessToken, user });
  }, { accessToken, user: { id: user.id, fullName: user.fullName } });
  console.log('Session initialized');
  await page.waitForURL('**/dashboard');
  console.log('Dashboard ready');
  const navigate = async (path) => { await page.evaluate((path) => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path); };
  await navigate('/doctors');
  await page.getByRole('link', { name: 'Add doctor', exact: true }).click();
  await page.getByLabel('Doctor name').fill('Browser Doctor');
  await page.getByLabel('Clinic or hospital').fill('Browser Clinic');
  await page.getByRole('button', { name: 'Save doctor', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser Doctor', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Edit doctor', exact: true }).click();
  await page.getByLabel('Specialization').fill('General');
  await page.getByRole('button', { name: 'Save doctor', exact: true }).click();
  await page.getByText('General', { exact: true }).waitFor();
  await navigate('/medications');
  const ids = [];
  for (const [form, tracking] of [['tablet', 'countable'], ['syrup', 'volume_ml'], ['ointment', 'weight_grams']]) {
    await page.getByRole('link', { name: 'Add medication', exact: true }).click();
    await page.getByLabel('Medicine name', { exact: false }).fill(`Browser ${form}`);
    await page.getByLabel('Dose amount').fill('1');
    await page.getByLabel('Dose unit').fill('unit');
    await page.getByLabel('Frequency').fill('Daily');
    for (const [option, expected] of Object.entries(trackingByForm)) {
      await page.getByLabel('Medicine form').selectOption(option);
      await expect(page.getByLabel('Inventory tracking')).toHaveValue(expected);
    }
    await page.getByLabel('Medicine form').selectOption(form);
    await expect(page.getByLabel('Inventory tracking')).toHaveValue(tracking);
    await page.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Browser Doctor' });
    if (form === 'tablet') {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const screenshot = join(tmpdir(), 'meditrack-phase5-mobile.png');
      await page.screenshot({ path: screenshot, fullPage: true }); console.log(`Mobile screenshot: ${screenshot}`);
      await page.setViewportSize({ width: 1440, height: 1050 });
    }
    await page.getByRole('button', { name: 'Save medication', exact: true }).click();
    await page.getByRole('heading', { name: `Browser ${form}`, exact: true }).waitFor();
    const id = Number(new URL(page.url()).pathname.split('/').at(-1)); ids.push(id);
    assert.equal((await prisma.medication.findUnique({ where: { id } })).trackingType, tracking);
    console.log(`Browser saved ${form} -> ${tracking}`);
    await navigate('/medications');
  }
  await page.getByRole('link', { name: 'Browser tablet', exact: true }).click();
  await page.getByRole('link', { name: 'Edit medication', exact: true }).click();
  await page.getByLabel('Inventory tracking').selectOption('weight_grams');
  await page.getByLabel('Instructions and duration').fill('Reviewed override');
  await page.getByRole('button', { name: 'Save medication', exact: true }).click();
  await page.getByText('Reviewed override', { exact: true }).waitFor();
  assert.equal((await prisma.medication.findUnique({ where: { id: ids[0] } })).trackingType, 'weight_grams');
  const screenshot = join(tmpdir(), 'meditrack-phase5-detail.png'); await page.screenshot({ path: screenshot, fullPage: true }); console.log(`Detail screenshot: ${screenshot}`);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discontinue medication' }).click();
  await expect(page.getByRole('button', { name: 'Discontinue medication' })).toBeDisabled();
  await navigate('/medications'); await page.getByLabel('Status', { exact: true }).selectOption('discontinued');
  await page.getByRole('link', { name: 'Browser tablet', exact: true }).waitFor();
  await navigate('/doctors'); await page.getByRole('button', { name: 'Delete doctor', exact: true }).click();
  await page.getByText('No doctors yet.', { exact: true }).waitFor();
  imageUrl = await storage.save(await readFile(new URL('../../../../ocr-service/tests/rx_04.jpg', import.meta.url)), 'jpg');
  const scan = await prisma.prescriptionScan.create({ data: { patientId: user.id, imageUrl, scanStatus: 'needs_review', ocrExtractedData: { doctor: { doctorName: 'OCR Browser Doctor' }, medicines: ['tablet', 'syrup', 'ointment'].map((medicineForm) => ({ medicineName: `OCR ${medicineForm}`, medicineForm, dosageAmount: '1', dosageUnit: 'unit', frequencyText: 'Daily' })) } } });
  await navigate(`/prescription-scans/${scan.id}`);
  const tracking = page.getByLabel('Inventory tracking');
  for (const [i, value] of ['countable', 'volume_ml', 'weight_grams'].entries()) await expect(tracking.nth(i)).toHaveValue(value);
  await page.getByLabel('Medicine form').first().selectOption('syrup'); await expect(tracking.first()).toHaveValue('volume_ml');
  await tracking.first().selectOption('countable');
  await page.getByRole('checkbox').check();
  await page.getByLabel('Instructions and duration').first().fill('Human confirmed');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Confirm and save medicines' }).click();
  await page.getByText('Confirmed. Your doctor and 3 medicine records have been saved.', { exact: true }).waitFor();
  const saved = await prisma.medication.findFirst({ where: { patientId: user.id, medicineName: 'OCR tablet' } });
  assert.equal(saved.medicineForm, 'syrup'); assert.equal(saved.trackingType, 'countable');
  assert.deepEqual(errors, []);
  console.log('PASS browser CRUD, all form defaults, overrides, mobile overflow, and OCR review/confirmation.');
} finally {
  await browser?.close(); await vite?.close();
  if (backend) await new Promise((resolve) => backend.close(resolve));
  if (user) {
    await prisma.prescriptionScan.deleteMany({ where: { patientId: user.id } });
    await prisma.medication.deleteMany({ where: { patientId: user.id } });
    await prisma.doctor.deleteMany({ where: { patientId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  if (imageUrl) await storage.remove(imageUrl);
  await prisma.$disconnect();
}
