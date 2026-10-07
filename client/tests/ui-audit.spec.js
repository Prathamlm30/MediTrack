import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const token = 'a'.repeat(64);
const routes = ['/', '/login', '/signup', '/forgot-password', `/reset-password?token=${token}`, `/verify-email/${token}`, `/invitations/${token}`, '/dashboard', '/patients', '/patients/2', '/relationships', '/relationships/invite', '/profile', '/profile/edit', '/settings', '/settings/notifications', '/missing'];
async function fixture(page, theme, mode = 'ready') {
  const user = { id: 1, fullName: 'Alex Example', email: 'alex@example.test', hasPassword: true, authProvider: 'local', emailVerified: true, preferences: { theme, timezone: 'Asia/Kolkata', language: 'en', preferredNotificationChannel: 'email' } };
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.route('http://127.0.0.1:3000/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/insights') return route.fulfill({ json: { insights: [], interactionFlags: [] } });
    if (path === '/api/reports/weekly') return route.fulfill({ json: [] });
    if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], nextCursor: null, unreadCount: 0 } });
    if (mode === 'error' && !path.endsWith('/refresh') && path !== '/api/users/me') return route.fulfill({ status: 503, json: { error: 'Could not reach MediTrack. Check your connection and try again.' } });
    const patient = { id: 2, fullName: 'Ravi Example', email: 'ravi@example.test' };
    const body = path.endsWith('/refresh') ? { user, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
      : path === '/api/users/me' ? { user }
      : path.endsWith('/my-patients') ? { patients: mode === 'empty' ? [] : [{ patient, permissionLevel: 'view_only', relationshipType: 'family', readOnly: true }] }
      : path === '/api/relationships' ? { relationships: mode === 'empty' ? [] : [{ id: 1, perspective: 'patient', patient: user, caregiver: patient, relationshipType: 'family', status: 'active', permissionLevel: 'view_only', linkedAt: '2026-09-22T00:00:00Z' }] }
      : path.includes('/invitations/') ? { invitation: { inviter: patient, relationshipType: 'family', proposedRole: 'caregiver' } }
      : path.includes('/dashboard/') ? { patient: path.endsWith('/patient') ? user : patient, readOnly: !path.endsWith('/patient'), permissionLevel: 'view_only', timezone: 'Asia/Kolkata', generatedAt: '2026-09-22T08:00:00Z', todayDoses: [], adherence: null, refillAlerts: [] }
      : {};
    await route.fulfill({ json: body });
  });
}
async function audit(page, route) {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('status', { name: /Loading|Checking|Verifying/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, route).toEqual([]);
}
for (const width of [360, 768, 1280]) for (const theme of ['light', 'dark']) test(`all routes ${width} ${theme}`, async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width, height: 900 }); await fixture(page, theme);
  for (const route of routes) {
    if (route === '/dashboard') await page.evaluate(() => sessionStorage.setItem('meditrack.refresh', 'fixture-refresh'));
    await page.goto(route); await audit(page, route);
    if (['/dashboard', '/profile/edit', '/relationships'].includes(route)) await page.screenshot({ path: `test-results/audit-${route.replaceAll('/', '-')}-${width}-${theme}.png`, fullPage: true });
  }
});
for (const width of [360, 768, 1280]) test(`empty and error routes ${width}`, async ({ browser }) => {
  test.setTimeout(180000);
  for (const theme of ['light', 'dark']) for (const mode of ['empty', 'error']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'fixture-refresh'));
    await fixture(page, theme, mode);
    for (const route of ['/dashboard', '/patients', '/patients/2', '/relationships', `/invitations/${token}`]) {
      await page.goto(`http://127.0.0.1:5173${route}`); await audit(page, route);
      if (mode === 'error') await expect(page.getByRole('button', { name: 'Retry', exact: true }).first()).toBeVisible();
    }
    await context.close();
  }
});


test('loading, request retry, nested focus restoration and scroll unlock', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'fixture-refresh'));
  await fixture(page, 'dark');
  let release, fail = false, reads = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/relationships', async route => {
    reads++; await pending;
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Could not reach MediTrack. Check your connection and try again.' } : { relationships: [{ id: 1, perspective: 'patient', caregiver: { id: 2, fullName: 'Ravi Example', email: 'ravi@example.test' }, relationshipType: 'family', status: 'active', permissionLevel: 'view_only' }] } });
  });
  await page.goto('/relationships');
  await expect(page.getByRole('status', { name: 'Loading relationships' })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  fail = true; release();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  const before = reads; fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  const trigger = page.getByRole('button', { name: 'Manage permissions' });
  await trigger.click(); expect(reads).toBe(before + 1);
  const revoke = page.getByRole('button', { name: 'Revoke access', exact: true }); await revoke.click();
  const dialog = page.getByRole('dialog', { name: "Revoke Ravi Example's access?" });
  await dialog.getByRole('button', { name: 'Revoke access' }).focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(revoke).toBeFocused();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
