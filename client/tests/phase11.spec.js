import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const time = '2026-10-06T08:00:00Z';
const notification = (id, type = 'system') => ({ id, notificationType: type, title: `Notice ${id}`, message: 'Plain <b>text</b>\nSecond line', status: 'sent', readAt: null, sentAt: time, relatedPatientId: type === 'weekly_summary' ? 2 : null });
async function fixture(page, theme = 'light', signedIn = true) {
  const user = { id: 1, fullName: 'Alex Example', email: 'alex@example.test', hasPassword: true, authProvider: 'local', emailVerified: true, preferences: { theme, timezone: 'America/New_York', preferredNotificationChannel: 'email', language: 'en' } };
  const state = { notifications: [notification(22, 'escalation'), notification(21, 'weekly_summary'), notification(20)], audit: [
    { id: 3, actionType: 'caregiver_read', timestamp: time, subjectPatientId: 1, actor: { id: 2, fullName: 'Ravi Caregiver' }, details: { routeGroup: '/api/dashboard' }, ipAddress: 'IP_NOT_FOR_DISPLAY' },
    { id: 2, actionType: 'permission_change', timestamp: time, subjectPatientId: 1, entityType: 'CaregiverPatientLink', entityId: 12, actor: user, details: { previousPermissionLevel: 'full_access', newPermissionLevel: 'view_only' } },
    { id: 1, actionType: 'login_local', timestamp: time, actor: user, details: {} },
  ], supportStatus: 201, requests: [], count: null, fail: null, pageSize: 20, missing: false, gate: null, user };
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  if (signedIn) await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'fixture-refresh'));
  await page.route('http://127.0.0.1:3000/api/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    state.requests.push({ path, query: url.search, method, body: route.request().postDataJSON() });
    if (state.gate && (path === '/api/audit-logs' || (path === '/api/notifications' && url.searchParams.get('limit') !== '1'))) await state.gate;
    if (state.fail && path === state.fail.path && (!state.fail.cursor || url.searchParams.get('cursor') === state.fail.cursor)) return route.fulfill({ status: 503, json: { error: 'Temporary failure.' } });
    if (path === '/api/auth/refresh' || path === '/api/auth/login') return route.fulfill({ json: { user, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' } });
    if (path === '/api/users/me') return route.fulfill({ json: { user } });
    if (path === '/api/users/me/preferences') { user.preferences = { ...user.preferences, ...route.request().postDataJSON() }; return route.fulfill({ json: { preferences: user.preferences } }); }
    if (path === '/api/dashboard/my-patients') return route.fulfill({ json: { patients: [] } });
    if (path === '/api/relationships') return route.fulfill({ json: { relationships: [{ id: 12, perspective: 'patient', caregiver: { id: 2, fullName: 'Ravi Caregiver' } }] } });
    if (path === '/api/notifications') {
      const rows = state.notifications.filter((row) => (!url.searchParams.has('type') || row.notificationType === url.searchParams.get('type')) && (url.searchParams.get('unread') !== 'true' || !row.readAt) && (!url.searchParams.has('cursor') || row.id < Number(url.searchParams.get('cursor'))));
      const count = Math.min(Number(url.searchParams.get('limit')), state.pageSize);
      const pageRows = rows.slice(0, count);
      return route.fulfill({ json: { notifications: pageRows, nextCursor: rows.length > count ? pageRows.at(-1).id : null, unreadCount: state.count ?? state.notifications.filter((row) => !row.readAt).length } });
    }
    if (/\/notifications\/.+\/read$/.test(path)) {
      const id = Number(path.split('/').at(-2));
      if (state.missing) { state.notifications = state.notifications.filter((row) => row.id !== id); return route.fulfill({ status: 404, json: { error: 'Notification not found.' } }); }
      const row = state.notifications.find((row) => row.id === id); row.readAt = time; row.status = 'read';
      return route.fulfill({ json: { notification: row } });
    }
    if (path === '/api/audit-logs') {
      const rows = state.audit.filter((row) => !url.searchParams.has('cursor') || row.id < Number(url.searchParams.get('cursor')));
      const pageRows = rows.slice(0, state.pageSize);
      return route.fulfill({ json: { auditLogs: pageRows, nextCursor: rows.length > state.pageSize ? pageRows.at(-1).id : null } });
    }
    if (path === '/api/support-tickets') return route.fulfill({ status: state.supportStatus, headers: { 'Retry-After': '121', 'Access-Control-Expose-Headers': 'Retry-After' }, json: { message: 'Accepted', error: 'Support error' } });
    if (path === '/api/insights') return route.fulfill({ json: { insights: [], interactionFlags: [] } });
    if (path === '/api/dashboard/patient') return route.fulfill({ json: { patient: user, permissionLevel: 'full_access', timezone: 'America/New_York', generatedAt: time, todayDoses: [], adherence: null, refillAlerts: [] } });
    return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request.' } });
  });
  return state;
}
async function audit(page) {
  await expect(page.locator('h1')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
}
for (const width of [360, 768, 1280]) for (const theme of ['light', 'dark']) test(`Phase 11 routes and states ${width} ${theme}`, async ({ page }) => {
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 }); const state = await fixture(page, theme);
  for (const path of ['/notifications', '/settings/activity', '/support', '/faq', '/terms', '/privacy', '/medical-disclaimer', '/settings/notifications']) {
    await page.goto(path); await expect(page.locator('h1')).toBeVisible();
    if (path === '/notifications') await expect(page.locator('[data-notification-id]')).toHaveCount(3);
    if (path === '/settings/activity') await expect(page.locator('[data-activity-id]')).toHaveCount(3);
    if (path === '/settings/notifications') await expect(page.getByLabel('Preferred notification channel')).toBeVisible();
    await audit(page);
    if (path === '/faq') {
      await expect(page.locator('details')).toHaveCount(11);
      await page.locator('summary').first().focus(); await page.keyboard.press('Enter');
      await expect(page.locator('details').first()).toHaveAttribute('open', '');
      await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.activeElement.tagName)).toBe('SUMMARY');
    }
    await page.screenshot({ path: `.cache/phase11/fixture-${path.replaceAll('/', '-')}-${width}-${theme}.png`, fullPage: true });
  }
  state.notifications = []; state.audit = [];
  for (const [path, title] of [['/notifications', 'No notifications yet.'], ['/settings/activity', 'No activity recorded yet.']]) {
    await page.goto(path); await expect(page.getByRole('heading', { name: title })).toBeVisible(); await audit(page);
  }
  await page.goto('/notifications'); await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByRole('heading', { name: "You're all caught up." })).toBeVisible(); await audit(page);
  for (const [path, api] of [['/notifications', '/api/notifications'], ['/settings/activity', '/api/audit-logs']]) {
    state.fail = { path: api }; await page.goto(path); await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible(); await audit(page);
    state.fail = null; await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  }
  await page.goto('/support');
  await page.getByLabel('Subject', { exact: false }).fill('Help'); await page.getByLabel('Message', { exact: false }).fill('Please help with my account.');
  for (const status of [400, 429, 502, 503, 201]) {
    state.supportStatus = status; await page.getByRole('button', { name: 'Send message' }).click();
    if (status === 201) await expect(page.getByRole('status')).toContainText("You'll get a reply at alex@example.test if one is needed.");
    else { await expect(page.getByRole('alert').filter({ hasText: /^Your message was not sent/ })).toBeVisible(); await expect(page.getByLabel('Subject', { exact: false })).toHaveValue('Help'); }
    await audit(page);
  }
  expect(errors).toEqual([]);
});

test('inbox plain text, viewer timezone, filtering, cursor Retry, stale refresh, mark-read and hidden row', async ({ page }) => {
  const state = await fixture(page); state.pageSize = 1;
  await page.goto('/notifications');
  const rows = page.locator('[data-notification-id]'); await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('time')).toContainText('4:00 AM');
  await expect(rows.first()).toContainText('Plain <b>text</b>'); await expect(rows.locator('b')).toHaveCount(0);
  expect(await rows.locator('p').first().evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  await expect(rows.first().getByRole('link')).toHaveCount(0);
  state.fail = { path: '/api/notifications', cursor: '22' };
  await page.getByRole('button', { name: 'Load more' }).click(); await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  state.fail = null; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(rows).toHaveCount(2);
  const calls = state.requests.filter((r) => r.path === '/api/notifications' && r.query.includes('cursor=22')); expect(calls).toHaveLength(2);
  await expect(rows.nth(1).getByRole('link')).toHaveAttribute('href', '/patients/2#weekly-reports');
  await page.getByRole('button', { name: 'Load more' }).click(); await expect(rows).toHaveCount(3); await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  state.fail = { path: '/api/notifications' }; await page.getByRole('button', { name: 'Refresh notifications' }).click();
  await expect(page.getByText(/Showing the last successful update/)).toBeVisible(); await expect(rows).toHaveCount(3);
  state.fail = null; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await rows.first().getByRole('button', { name: 'Mark as read' }).click(); await expect(page.getByText('Notification marked as read.')).toBeVisible();
  await expect(page.getByLabel('2 unread notifications')).toBeVisible(); await expect(rows.first().getByText('Unread', { exact: true })).toHaveCount(0);
  state.missing = true; await rows.nth(1).getByRole('button', { name: 'Mark as read' }).click();
  await expect(page.getByText('This notification is no longer available.')).toBeVisible(); await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'Unread', exact: true }).click(); await expect(rows).toHaveCount(1);
  await page.getByLabel('Notification type').selectOption('refill'); await expect(page.getByRole('heading', { name: "You're all caught up." })).toBeVisible();
  expect(state.requests.some((r) => r.query.includes('type=refill') && r.query.includes('unread=true'))).toBe(true);
});

test('badge focus and 60-second refresh, capping, and mobile keyboard navigation', async ({ page }) => {
  const state = await fixture(page); state.count = 120;
  await page.clock.install(); await page.goto('/notifications'); await expect(page.getByLabel('120 unread notifications')).toHaveText('99+ unread');
  state.count = 7; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByLabel('7 unread notifications')).toBeVisible();
  state.count = 6; await page.clock.runFor(60000); await expect(page.getByLabel('6 unread notifications')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole('button', { name: 'Open navigation menu' }).focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  // Walk the menu with Tab, including every legal destination, then activate Notifications.
  let found = false;
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement.getAttribute('href') === '/notifications')) { found = true; break; } }
  expect(found).toBe(true); await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0);
});

test('unsupported stored channel requires a deliberate real choice and sends existing keys only', async ({ page }) => {
  const state = await fixture(page); state.user.preferences.preferredNotificationChannel = 'sms';
  await page.goto('/settings/notifications'); await expect(page.getByText(/Your saved channel is not available yet/)).toBeVisible();
  const select = page.getByLabel('Preferred notification channel'); await expect(select).toHaveValue('');
  await expect(select.locator('option')).toHaveText(['Choose a channel', 'In the app', 'Email']);
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  await select.selectOption('in_app'); await page.getByRole('button', { name: 'Save preferences' }).click();
  expect(state.requests.find((r) => r.path.endsWith('/preferences')).body).toEqual({ preferredNotificationChannel: 'in_app', language: 'en', timezone: 'America/New_York' });
});

test('activity pagination and refresh preserve sentences; unknown areas and IP stay hidden', async ({ page }) => {
  const state = await fixture(page); state.pageSize = 1;
  await page.goto('/settings/activity'); const rows = page.locator('[data-activity-id]');
  await expect(rows.first()).toContainText('Ravi Caregiver viewed your health information (dashboard).');
  await expect(rows.locator('time')).toContainText('4:00 AM');
  await page.getByRole('button', { name: 'Load more' }).click(); await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('You changed access for Ravi Caregiver: Full access to View only.');
  state.fail = { path: '/api/audit-logs' }; await page.getByRole('button', { name: 'Refresh activity' }).click();
  await expect(rows).toHaveCount(2); await expect(page.getByText(/Showing the last successful update/)).toBeVisible();
  state.fail = null; state.audit[0].details.routeGroup = 'SECRET_RAW'; await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(rows.first()).toContainText('an area of your record');
  await expect(page.getByText(/IP_NOT_FOR_DISPLAY|SECRET_RAW/)).toHaveCount(0);
  expect(state.requests.filter((r) => r.path === '/api/audit-logs').every((r) => !r.query.includes('userId'))).toBe(true);
});

test('first-load skeletons, loading controls, support bounds and signed-out return destination', async ({ page }) => {
  const state = await fixture(page, 'light', false);
  for (const path of ['/faq', '/terms', '/privacy', '/medical-disclaimer']) { await page.goto(path); await expect(page.locator('h1')).toBeVisible(); await expect(page.getByText('Last updated 6 October 2026')).toBeVisible(); }
  await page.goto('/support'); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email', { exact: false }).fill('alex@example.test'); await page.getByLabel(/^Password/).fill('password'); await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByLabel('Reply email')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByLabel('Subject', { exact: false }).fill('x'.repeat(121)); await page.getByLabel('Message', { exact: false }).fill('x'.repeat(2001));
  await expect(page.getByText('Use 120 characters or fewer.')).toBeVisible(); await expect(page.getByText('Use 2,000 characters or fewer.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  for (const [path, label] of [['/notifications', 'Loading notifications'], ['/settings/activity', 'Loading activity']]) {
    let release; state.gate = new Promise((done) => { release = done; });
    await page.goto(path); await expect(page.getByRole('status', { name: label })).toBeVisible(); await audit(page);
    release(); state.gate = null; await expect(page.getByRole('status', { name: label })).toHaveCount(0);
  }
});

