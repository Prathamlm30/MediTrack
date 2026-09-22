import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const token = 'a'.repeat(64);
const user = { id: 42, fullName: 'Alex Example', email: 'alex@example.test', phoneNumber: null, address: null, dateOfBirth: '1990-01-02', gender: null, authProvider: 'local', hasPassword: true, emailVerified: true, preferences: { theme: 'light', language: 'en', preferredNotificationChannel: 'email', timezone: 'Asia/Kolkata' } };
async function fixture(page, { signedIn = false, account = structuredClone(user), respond } = {}) {
  if (signedIn) await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'test-refresh'));
  await page.route(/\/api\/(auth|users|invitations|dashboard)\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const custom = await respond?.(path, route.request());
    if (custom === 'abort') return route.abort();
    const result = custom || (path.endsWith('/refresh') || path.endsWith('/login') ? { user: account, accessToken: 'test-access', refreshToken: 'test-refresh' }
      : path === '/api/users/me' ? { user: account }
      : path.includes('/invitations/') ? { invitation: { inviter: { fullName: 'Ravi Example' } } }
      : path.endsWith('/my-patients') ? { patients: [] } : {});
    await route.fulfill({ status: result.status || 200, contentType: 'application/json', body: JSON.stringify(result.body || result) });
  });
}

test('signup carries invitation through email tab, verification and login; verification executes once', async ({ page, context }) => {
  let verifications = 0;
  const respond = (path) => { if (path.includes('/verify-email/')) verifications++; };
  await fixture(page, { respond });
  await page.goto(`/signup?inviteToken=${token}`);
  await expect(page.getByText(/Ravi Example invited you/)).toBeVisible();
  await page.getByLabel('Full name', { exact: false }).fill('Alex Example');
  await page.getByLabel('Email', { exact: false }).fill('alex@example.test');
  await page.getByLabel(/^Password/).fill('Valid-password-42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('meditrack.refresh'))).toBeNull();
  const emailTab = await context.newPage(); await fixture(emailTab, { respond });
  await emailTab.goto(`/verify-email/${token}`);
  await expect(emailTab.getByRole('heading', { name: 'Email verified', exact: true })).toBeVisible();
  expect(verifications).toBe(1);
  await emailTab.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(emailTab).toHaveURL(new RegExp(`/login\\?inviteToken=${token}`));
  await emailTab.getByLabel('Email', { exact: false }).fill('alex@example.test');
  await emailTab.getByLabel(/^Password/).fill('Valid-password-42');
  await emailTab.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(emailTab).toHaveURL(new RegExp(`/invitations/${token}`));
  expect(await emailTab.evaluate(() => sessionStorage.getItem('meditrack.refresh'))).toBe('test-refresh');
  expect(await emailTab.evaluate(() => localStorage.getItem('meditrack.refresh'))).toBeNull();
});

test('login places Google-only, credentials and verification guidance beside controls', async ({ page }) => {
  let failure = { status: 400, body: { error: 'This account uses Google Sign-In.' } };
  await fixture(page, { respond: (path) => path.endsWith('/login') ? failure : undefined });
  await page.goto('/login');
  await page.getByLabel('Email', { exact: false }).fill('alex@example.test');
  await page.getByLabel(/^Password/).fill('Valid-password-42');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('This email signs in with Google. Use the Google button above.')).toBeVisible();
  expect(await page.getByLabel('Google Sign-In', { exact: true }).evaluate((el) => el === document.activeElement || el.contains(document.activeElement))).toBe(true);
  failure = { status: 401, body: { error: 'Invalid email or password.' } };
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Invalid email or password. Check both fields and try again.')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel(/^Password/)).toHaveAttribute('aria-invalid', 'true');
  failure = { status: 403, body: { error: 'Verify your email before signing in.' } };
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText(/Open the verification email for/)).toBeVisible();
  await expect(page.getByLabel('Notifications')).toBeEmpty();
});

test('forgot-password result is identical for unknown and Google-only emails', async ({ page }) => {
  await fixture(page);
  const results = [];
  for (const email of ['missing@example.test', 'google@example.test']) {
    await page.goto('/forgot-password'); await page.getByLabel('Email', { exact: false }).fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check for a reset link' })).toBeVisible();
    results.push(await page.locator('main').innerText());
  }
  expect(results[0]).toBe(results[1]);
  expect(results[0]).toContain('If that email has a MediTrack account with a password, a reset link is on its way.');
});

test('password byte limits, reset mismatch, consumed reset, successful reset clears session', async ({ page }) => {
  let resetFails = true;
  await fixture(page, { respond: (path) => path.endsWith('/reset-password') && resetFails ? { status: 400, body: { error: 'Invalid or expired token.' } } : undefined });
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel(/^New password/).fill('😀'.repeat(19));
  await expect(page.getByText('Your password is 76 UTF-8 bytes. Use 72 bytes or fewer.')).toBeVisible();
  await page.getByLabel(/^New password/).fill('Valid-password-42');
  await page.getByLabel(/^Confirm new password/).fill('different');
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel(/^Confirm new password/).fill('Valid-password-42');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This reset link cannot be used' })).toBeVisible();
  resetFails = false; await page.goto(`/reset-password?token=${token}`);
  await page.evaluate(() => sessionStorage.setItem('meditrack.refresh', 'stale-session'));
  await page.getByLabel(/^New password/).fill('Valid-password-42');
  await page.getByLabel(/^Confirm new password/).fill('Valid-password-42');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/Any existing session was signed out/)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('meditrack.refresh'))).toBeNull();
});

test('verification invalid/expired state and network retry', async ({ page }) => {
  let failure = 'abort';
  await fixture(page, { respond: (path) => path.includes('/verify-email/') ? failure : undefined });
  await page.goto(`/verify-email/${token}`);
  await expect(page.getByText('Could not reach MediTrack. Check your connection and try again.')).toBeVisible();
  failure = { status: 400, body: { error: 'Invalid or expired token.' } };
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('The link is invalid, has already been used, or expired after 24 hours.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to sign in' })).toBeVisible();
});

test('profile displays fields; edit confirms discard and sends only allowed fields', async ({ page }) => {
  let payload;
  await fixture(page, { signedIn: true, respond: (path, request) => {
    if (path === '/api/users/me' && request.method() === 'PATCH') { payload = request.postDataJSON(); return { user: { ...user, ...payload } }; }
  } });
  await page.goto('/profile');
  await expect(page.getByText('January 2, 1990')).toBeVisible();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByLabel('Full name', { exact: false }).fill('Alex Updated');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard profile changes?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile updated.', { exact: true })).toBeVisible();
  expect(Object.keys(payload).sort()).toEqual(['address', 'fullName', 'phoneNumber', 'profilePictureUrl']);
  expect(payload.phoneNumber).toBeNull();
});

test('theme saves immediately; preferences whitelist and persistence', async ({ page }) => {
  const account = structuredClone(user); const payloads = [];
  await fixture(page, { signedIn: true, account, respond: (path, request) => {
    if (path.endsWith('/preferences')) { const body = request.postDataJSON(); payloads.push(body); Object.assign(account.preferences, body); return { preferences: account.preferences }; }
  } });
  await page.goto('/settings/notifications');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(payloads[0]).toEqual({ theme: 'dark' });
  await page.getByLabel('Timezone', { exact: true }).selectOption('America/New_York');
  await page.getByLabel('Preferred notification channel').selectOption('sms');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  expect(payloads[1]).toEqual({ preferredNotificationChannel: 'sms', language: 'en', timezone: 'America/New_York' });
  await page.reload(); await expect(page.getByLabel('Timezone', { exact: true })).toHaveValue('America/New_York');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('settings derives both linked and hides password reset for Google-only', async ({ page }) => {
  const account = { ...structuredClone(user), googleId: 'google-fixture' };
  await fixture(page, { signedIn: true, account }); await page.goto('/settings');
  await expect(page.getByText('Both linked', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a password reset' })).toBeVisible();
  account.hasPassword = false; account.authProvider = 'google'; await page.reload();
  await expect(page.getByText('Google', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a password reset' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /delete|deactivate|change password/i })).toHaveCount(0);
});

for (const theme of ['light', 'dark']) test(`all ten pages: 360px, ${theme}, accessible forms and no overflow`, async ({ page }) => {
  const account = structuredClone(user); account.preferences.theme = theme;
  await fixture(page, { account }); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/', '/signup', '/login', '/forgot-password', `/reset-password?token=${token}`, `/verify-email/${token}`, '/profile', '/profile/edit', '/settings', '/settings/notifications']) {
    if (path === '/profile') await page.evaluate(() => sessionStorage.setItem('meditrack.refresh', 'test-refresh'));
    await page.goto(path); await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).disableRules(['region']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
    await page.screenshot({ path: `test-results/account-${theme}-${path.split('?')[0].replaceAll('/', '-') || 'landing'}.png`, fullPage: true });
  }
});
