import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
const gallery = '/dev/ui?frame=1&theme=light';
test('gallery interactions, modal focus, tabs, read-only controls, toast limit', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(gallery);
  await expect(page.getByRole('heading', { name: 'Light component gallery' })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Open modal', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await page.getByRole('tab', { name: 'First section' }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Second section' })).toHaveAttribute('aria-selected', 'true');
  const readOnly = page.getByLabel('Checkbox · read-only', { exact: true }); await expect(readOnly).toBeChecked(); await readOnly.click(); await expect(readOnly).toBeChecked();
  await page.getByRole('button', { name: 'Show password', exact: true }).first().click();
  await expect(page.getByLabel('Password input · default', { exact: false })).toHaveAttribute('type', 'text');
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Show success toast' }).click();
  await expect(page.getByLabel('Notifications').getByRole('status')).toHaveCount(3);
  await page.getByRole('button', { name: 'Asha Rao' }).click(); await page.getByRole('menuitemradio', { name: 'Ravi Rao' }).click();
  await expect(page.getByRole('button', { name: 'Ravi Rao' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile light and dark gallery has no overflow and patient selector becomes a sheet', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const theme of ['light', 'dark']) {
    await page.goto(`/dev/ui?frame=1&theme=${theme}`); await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Asha Rao' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose patient' }); await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox(); expect(Math.round(box.y + box.height)).toBe(800);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `test-results/gallery-${theme}-360.png`, fullPage: true });
  }
});
async function mockSession(page, { delayed = false } = {}) {
  await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'fixture-refresh'));
  let release; const wait = delayed ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  const user = { id: 1, fullName: 'Alex Example', preferences: { theme: 'dark' } };
  const calls = [];
  await page.route('http://127.0.0.1:3000/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname; calls.push(path);
    let body;
    if (path === '/api/auth/refresh') { await wait; body = { accessToken: 'fixture-access', refreshToken: 'fixture-rotated' }; }
    else if (path === '/api/users/me') body = { user };
    else if (path === '/api/users/me/preferences') body = { preferences: { theme: route.request().postDataJSON().theme } };
    else if (path === '/api/dashboard/my-patients') body = { patients: [{ patient: { id: 2, fullName: 'Asha Example' }, permissionLevel: 'alerts_only', relationshipType: 'parent' }] };
    else body = { patient: { id: 2, fullName: 'Asha Example' }, timezone: 'Asia/Kolkata', generatedAt: '2026-09-21T06:00:00Z', readOnly: path.includes('caregiver'), refillAlerts: [], ...(path.includes('caregiver') ? {} : { todayDoses: [], adherence: null }) };
    await route.fulfill({ json: body });
  });
  return { release, calls };
}
test('session check does not flash login; dashboard refresh and saved theme work', async ({ page }) => {
  const { release, calls } = await mockSession(page, { delayed: true });
  await page.goto('/dashboard'); await expect(page.getByRole('status', { name: 'Checking your session' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toHaveCount(0);
  release(); await expect(page.getByText('No doses scheduled today.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Toggle theme' }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const before = calls.filter((path) => path === '/api/dashboard/patient').length;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => calls.filter((path) => path === '/api/dashboard/patient').length).toBeGreaterThan(before);
  await page.getByRole('link', { name: 'Caregiver dashboard', exact: true }).click();
  await expect(page.getByText(/has not shared their dose schedule/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Asha Example' })).toBeVisible();
});
test('public route contract and protected redirect', async ({ page }) => {
  for (const [path, title] of [['/signup?inviteToken=sample', 'Sign up'], ['/reset-password?token=sample', 'Reset password'], ['/verify-email/sample', 'Verify email'], ['/invitations/sample', 'Invitation']]) {
    await page.goto(path); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  await page.goto('/profile'); await expect(page).toHaveURL(/\/login$/);
});


test('component gallery meets automated WCAG A/AA checks in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`/dev/ui?frame=1&theme=${theme}`);
    await expect(page.getByRole('heading', { name: /component gallery/ })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  }
});
