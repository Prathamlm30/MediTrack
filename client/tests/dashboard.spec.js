import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dayNumber } from '../src/components/dayTime.js';
test.use({ locale: 'en-US', timezoneId: 'Asia/Kolkata' });
const user = { id: 1, fullName: 'Demo Caregiver', preferences: { theme: 'light' } };
const patients = [2, 3].map((id) => ({ patient: { id, fullName: `Demo Patient ${id}` }, relationshipType: 'family', permissionLevel: id === 2 ? 'view_only' : 'alerts_only', readOnly: true }));
const doses = [['2026-09-22T07:00:00Z', 'pending'], ['2026-09-22T15:00:00Z', 'taken'], ['2026-09-22T15:00:00Z', 'missed'], ['2026-09-22T15:00:00Z', 'skipped'], ['2026-09-22T20:00:00Z', 'snoozed'], ['2026-09-23T03:00:00Z', 'pending'], ['2026-09-23T06:30:00Z', 'pending']].map(([scheduledDatetime, status], index) => ({ id: index + 1, scheduledDatetime, actualActionDatetime: null, status, schedule: { id: index + 1, doseAmount: '500.00', medication: { id: index + 1, medicineName: `Test medicine ${index + 1}`, medicineForm: 'tablet', dosageAmount: '500.00', dosageUnit: 'mg' } } }));
function dashboard(id = 2, permission = 'view_only') {
  return { patient: { id, fullName: `Demo Patient ${id}` }, permissionLevel: permission, readOnly: true, timezone: 'America/Los_Angeles', generatedAt: '2026-09-22T19:00:00Z',
    refillAlerts: [{ id: 1, medicationId: 1, quantityRemaining: '6.00', quantityUnit: 'tablets', estimatedRunoutDate: '2026-09-23T06:30:00Z', medication: { id: 1, medicineName: 'Refill medicine' } }],
    ...(permission === 'alerts_only' ? {} : { todayDoses: structuredClone(doses), adherence: { periodType: 'daily', periodStartDate: '2026-09-20T07:00:00Z', periodEndDate: '2026-09-21T07:00:00Z', totalScheduledDoses: 3, takenCount: 1, missedCount: 1, skippedCount: 1, adherencePercentage: '33.33', generatedAt: '2026-09-21T07:00:00Z' } }) };
}
async function fixture(page, respond) {
  const calls = [];
  await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'fixture-refresh'));
  await page.route('http://127.0.0.1:3000/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname; calls.push(path);
    if (path === '/api/insights') return route.fulfill({ json: { insights: [], interactionFlags: [] } });
    if (path === '/api/reports/weekly') return route.fulfill({ json: [] });
    if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], nextCursor: null, unreadCount: 0 } });
    const custom = respond?.(path); if (custom === 'abort') return route.abort();
    const body = custom ?? (path.endsWith('/refresh') ? { user, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' } : path === '/api/users/me' ? { user } : path.endsWith('/my-patients') ? { patients } : path.endsWith('/caregiver/3') ? dashboard(3, 'alerts_only') : path === '/api/relationships' ? { relationships: [] } : dashboard());
    await route.fulfill({ status: body.httpStatus || 200, json: body });
  }); return calls;
}
const markers = (page) => page.getByRole('figure').locator('[role="img"][tabindex="0"]');
test('timezone, decimal strings, adherence period, refill local days and DST', async ({ page }) => {
  await fixture(page); await page.goto('/patients/2');
  await expect(page.getByRole('heading', { name: 'Demo Patient 2’s day' })).toBeVisible();
  await expect(page.getByText('Tuesday, September 22, 2026 · America/Los_Angeles')).toBeVisible();
  await expect(markers(page).first()).toHaveAttribute('aria-label', '12:00 AM, Test medicine 1 500 mg, pending');
  await expect(markers(page).last()).toHaveAttribute('aria-label', '11:30 PM, Test medicine 7 500 mg, pending');
  await expect(page.getByText('33.33%')).toBeVisible(); await expect(page.getByText('Sep 20, 2026', { exact: true })).toBeVisible();
  await expect(page.getByText('6 tablets remaining')).toBeVisible(); await expect(page.getByText(/Estimated runout: Sep 22, 2026 · Today/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Taken|Skipped|Snoozed|Log dose)$/i })).toHaveCount(0);
  expect(dayNumber('2026-03-09T07:00:00Z', 'America/Los_Angeles') - dayNumber('2026-03-08T08:00:00Z', 'America/Los_Angeles')).toBe(1);
  expect(dayNumber('2026-11-02T08:00:00Z', 'America/Los_Angeles') - dayNumber('2026-11-01T07:00:00Z', 'America/Los_Angeles')).toBe(1);
});
for (const width of [360, 768, 1280]) test(`rail geometry, keyboard and accessibility at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(page); await page.goto('/patients/2'); await expect(markers(page)).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('figure').evaluate(async (el) => { await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
  const boxes = await markers(page).evaluateAll((elements) => elements.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true); }
  const positions = await markers(page).evaluateAll((elements) => elements.map((el) => el.parentElement.style.getPropertyValue('--position')));
  expect(positions[0]).toBe('0%'); expect(parseFloat(positions.at(-1))).toBeCloseTo(97.9167, 3);
  if (width < 640) expect(boxes.at(-1).y - boxes[0].y).toBeGreaterThan(500); else expect(boxes.at(-1).x - boxes[0].x).toBeGreaterThan(300);
  for (let i = 0; i < 7; i++) { await markers(page).nth(i).focus(); await expect(markers(page).nth(i)).toBeFocused(); }
  await markers(page).first().focus(); await page.keyboard.press('Tab'); await expect(markers(page).nth(1)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((el, value) => { el.dataset.theme = value; }, theme);
    await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished)); });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  }
  await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
});
test('poll in place, flip permissions both ways, focus/manual refresh and mid-session 403', async ({ page }) => {
  let body = dashboard(), revoked = false;
  const calls = await fixture(page, (path) => path.endsWith('/caregiver/2') ? revoked ? { httpStatus: 403, error: 'Forbidden' } : body : undefined);
  await page.clock.install(); await page.goto('/patients/2'); await expect(markers(page)).toHaveCount(7); await page.clock.runFor(1000);
  await page.getByRole('figure').evaluate(async (el) => { await Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
  await page.evaluate(() => { window.originalMarker = document.querySelector('figure [role="img"]'); window.entrances = 0; window.skeletons = 0; document.addEventListener('animationstart', () => window.entrances++); new MutationObserver(() => { if (document.querySelector('[aria-label="Loading dashboard"]')) window.skeletons++; }).observe(document.querySelector('main'), { childList: true, subtree: true }); });
  const railBox = await page.getByRole('figure').boundingBox(); body = structuredClone(body); body.todayDoses[0].status = 'taken';
  await page.clock.runFor(30000); await expect(markers(page).first()).toHaveAttribute('aria-label', /taken$/);
  expect(await page.getByRole('figure').boundingBox()).toEqual(railBox);
  expect(await page.evaluate(() => window.originalMarker === document.querySelector('figure [role="img"]'))).toBe(true);
  expect(await page.evaluate(() => ({ entrances: window.entrances, skeletons: window.skeletons }))).toEqual({ entrances: 0, skeletons: 0 });
  body = dashboard(2, 'alerts_only'); await page.clock.runFor(30000);
  await expect(page.getByText(/You have alerts-only access/)).toBeVisible(); await expect(page.getByRole('figure')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Adherence', exact: true })).toHaveCount(0); await expect(page.getByText('6 tablets remaining')).toBeVisible();
  body = dashboard(); body.todayDoses = []; body.adherence = null; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'No doses are scheduled for today.' })).toBeVisible(); await expect(page.getByText(/alerts-only access/)).toHaveCount(0); await expect(page.getByText('Adherence appears once doses have been logged.')).toBeVisible();
  body = dashboard(); await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(markers(page)).toHaveCount(7);
  expect(await markers(page).first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  revoked = true; const count = calls.filter((path) => path.endsWith('/my-patients')).length; await page.clock.runFor(30000);
  await expect(page.getByRole('heading', { name: 'Access changed', exact: true })).toBeVisible(); await expect(page.getByRole('figure')).toHaveCount(0); await expect(page.getByText('Refill medicine')).toHaveCount(0);
  expect(calls.filter((path) => path.endsWith('/my-patients')).length).toBeGreaterThan(count); await expect(page).toHaveURL(/\/patients\/2$/);
});
test('overview has no health fetches and selection persists across navigation and focus', async ({ page }) => {
  const calls = await fixture(page); await page.goto('/patients'); await expect(page.getByRole('link', { name: /View dashboard for/ })).toHaveCount(2);
  expect(calls.some((path) => path.includes('/caregiver/') || path === '/api/dashboard/patient')).toBe(false);
  await page.getByRole('link', { name: 'View dashboard for Demo Patient 3' }).click(); await expect(page.getByRole('button', { name: 'Demo Patient 3', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Relationships', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('link', { name: 'Caregiver dashboard', exact: true }).click(); await expect(page).toHaveURL(/\/patients\/3$/);
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByRole('button', { name: 'Demo Patient 3', exact: true })).toBeVisible();
});
test('self route, missing timezone fallback and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); const own = dashboard(); delete own.timezone; own.readOnly = false; own.patient = user;
  const calls = await fixture(page, (path) => path === '/api/dashboard/patient' ? own : undefined); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/patients/1'); await expect(page).toHaveURL(/\/dashboard$/); await expect(page.getByRole('heading', { name: 'Your day', exact: true })).toBeVisible();
  expect(calls).not.toContain('/api/dashboard/caregiver/1'); await expect(page.getByRole('figure')).toHaveAccessibleName(/Asia\/(Calcutta|Kolkata)/);
  expect(await markers(page).first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none'); expect(errors).toEqual([]);
});
test('transient refresh failure retains data and recovers; overview empty state', async ({ page }) => {
  let fail = false; await fixture(page, (path) => path.endsWith('/caregiver/2') && fail ? 'abort' : undefined);
  await page.goto('/patients/2'); await expect(markers(page)).toHaveCount(7); fail = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Could not refresh. Showing the last successful update./)).toBeVisible(); await expect(markers(page)).toHaveCount(7);
  fail = false; await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByText(/Could not refresh/)).toHaveCount(0);
  await page.route('**/api/dashboard/my-patients', (route) => route.fulfill({ json: { patients: [] } })); await page.goto('/patients');
  await expect(page.getByRole('link', { name: 'Invite someone', exact: true })).toHaveAttribute('href', '/relationships/invite');
});

