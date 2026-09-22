import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
test.use({ baseURL: 'http://localhost:5173', locale: 'en-US', timezoneId: 'Asia/Kolkata' });

// Opt in against the development server/PostgreSQL/Redis. Each run creates fresh accounts.
test('real seeded dashboards, live permission changes, timezone and revocation', async ({ page, request }) => {
  test.skip(process.env.DASHBOARD_LIVE !== '1', 'Set DASHBOARD_LIVE=1 with the development backend running.');
  test.setTimeout(120000);
  const password = `Dashboard-${randomUUID()}`;
  const seed = JSON.parse(execFileSync(process.execPath, ['prisma/devSeed.js'], {
    cwd: fileURLToPath(new URL('../../server/', import.meta.url)), env: { ...process.env, DEV_SEED_PASSWORD: password }, encoding: 'utf8',
  }));
  const base = 'http://127.0.0.1:3000/api';
  const login = await request.post(`${base}/auth/login`, { data: { email: seed.patient.email, password } });
  expect(login.ok()).toBe(true);
  const patient = await login.json();
  const headers = { Authorization: `Bearer ${patient.accessToken}` };
  const own = await request.get(`${base}/dashboard/patient`, { headers });
  const actual = await own.json();
  expect(typeof actual.todayDoses[0].schedule.doseAmount).toBe('string');
  expect(typeof actual.refillAlerts[0].quantityRemaining).toBe('string');
  expect(typeof actual.adherence.adherencePercentage).toBe('string');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: false }).fill(seed.caregiver.email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/patients');
  await expect(page.getByRole('link', { name: /View dashboard for/ })).toHaveCount(2);
  await page.getByRole('link', { name: 'View dashboard for Demo Patient One' }).click();
  await expect(page.getByRole('figure')).toBeVisible();
  await expect(page.getByText('View only', { exact: true })).toBeVisible();
  await page.goto(`/patients/${seed.secondPatient.id}`);
  await expect(page.getByText(/You have alerts-only access/)).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
  await expect(page.getByText('6 tablets remaining')).toBeVisible();
  await page.goto(`/patients/${seed.patient.id}`);
  await expect(page.getByRole('figure')).toBeVisible();
  const permission = (data) => request.patch(`${base}/relationships/${seed.links[0].id}/permissions`, { headers, data });
  expect((await permission({ permissionLevel: 'alerts_only' })).ok()).toBe(true);
  // Allow the real 30-second poll to detect the change, without focus or manual refresh.
  await expect(page.getByText(/You have alerts-only access/)).toBeVisible({ timeout: 35000 });
  await expect(page.getByRole('figure')).toHaveCount(0);
  expect((await permission({ permissionLevel: 'view_only' })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('figure')).toBeVisible();
  expect((await request.patch(`${base}/users/me/preferences`, { headers, data: { timezone: 'America/Los_Angeles' } })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/America\/Los_Angeles/).first()).toBeVisible();
  const shifted = await (await request.get(`${base}/dashboard/patient`, { headers })).json();
  const names = await page.locator('figure [role="img"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names.length).toBe(shifted.todayDoses.length);
  for (const dose of shifted.todayDoses) {
    const expected = new Intl.DateTimeFormat('en-US', { timeZone: shifted.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(dose.scheduledDatetime));
    expect(names.some((name) => name.startsWith(`${expected},`))).toBe(true);
  }
  expect((await permission({ status: 'revoked' })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access changed', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/patients/${seed.patient.id}$`));
  await expect(page.getByRole('figure')).toHaveCount(0);
});
