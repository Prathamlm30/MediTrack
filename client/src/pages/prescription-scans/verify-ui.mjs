// Real browser verification. First run server/.../verify-real.mjs to create the demo account.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const tests = new URL('../../../../ocr-service/tests/', import.meta.url);
const credentials = Object.fromEntries((await readFile(new URL('.env.demo', tests), 'utf8')).trim().split(/\r?\n/).map((line) => line.split('=')));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:5173/login');
  await page.getByLabel('Email', { exact: false }).fill(credentials.DEMO_EMAIL);
  await page.getByLabel(/^Password/).fill(credentials.DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('link', { name: 'Scan', exact: true }).first().click();
  await page.getByLabel('Prescription image').setInputFiles(fileURLToPath(new URL('rx_04.jpg', tests)));
  await page.getByRole('button', { name: 'Upload and scan' }).click();
  await page.waitForURL(/\/prescription-scans\/\d+$/);
  const scanId = Number(page.url().split('/').at(-1));
  await page.getByLabel('Doctor name').waitFor({ timeout: 150000 });
  assert.equal(await page.getByLabel('Doctor name').inputValue(), 'Arjun Mehta');
  await expect(page.getByLabel(/^Medicine name/)).toHaveCount(5);
  assert.equal(await page.getByRole('button', { name: 'Confirm and save medicines' }).isDisabled(), true);
  await expect.poll(() => page.locator('img[alt^="Uploaded prescription"]').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: fileURLToPath(new URL('results/review-desktop.png', tests)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL('results/review-mobile.png', tests)), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  const tracking = page.getByLabel('Inventory tracking');
  for (const [index, value] of ['countable', 'countable', 'volume_ml', 'weight_grams', 'countable'].entries()) await tracking.nth(index).selectOption(value);
  await page.getByLabel('Instructions and duration').first().fill('7 days; reviewed against synthetic fixture');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm and save medicines' }).click();
  await page.getByText('Confirmed. Your doctor and 5 medicine records have been saved.').waitFor();
  assert.deepEqual(errors, []);
  const evidence = { scanId, reviewUrl: page.url(), editedInstructions: '7 days; reviewed against synthetic fixture',
    desktopWidth: 1440, mobileWidth: 390, overflow: false, browserErrors: errors, confirmed: true };
  await writeFile(new URL('results/ui-verification.json', tests), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
