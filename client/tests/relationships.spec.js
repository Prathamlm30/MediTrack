import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const token = 'a'.repeat(64);
const user = { id: 1, fullName: 'Alex Example', email: 'alex@example.test', emailVerified: true, preferences: { theme: 'light' } };
const other = { id: 2, fullName: 'Sam Example', email: 'sam@example.test' };
const preview = { invitation: { inviter: other, proposedRole: 'caregiver', relationshipType: 'spouse', expiresAt: '2026-09-29T00:00:00Z', status: 'sent' } };
const links = [
  { id: 1, patient: user, caregiver: other, perspective: 'patient', relationshipType: 'spouse', status: 'active', permissionLevel: 'view_only', linkedAt: '2026-09-22T00:00:00Z' },
  { id: 2, patient: other, caregiver: user, perspective: 'caregiver', relationshipType: 'spouse', status: 'active', permissionLevel: 'alerts_only', linkedAt: '2026-09-22T00:00:00Z' },
];
async function fixture(page, { signedIn = true, respond } = {}) {
  if (signedIn) await page.addInitScript(() => sessionStorage.setItem('meditrack.refresh', 'test-refresh'));
  await page.route(/\/api\/(auth|users|invitations|relationships|dashboard)(\/|$)/, async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const custom = await respond?.(path, req);
    if (custom === 'abort') return route.abort();
    const data = custom || (path.endsWith('/refresh') ? { user, accessToken: 'test-access', refreshToken: 'test-refresh' }
      : path === '/api/users/me' ? { user } : path.endsWith('/my-patients') ? { patients: [] }
        : path === '/api/relationships' ? { relationships: links } : path.includes('/invitations/') ? preview : {});
    await route.fulfill({ status: data.status || 200, contentType: 'application/json', body: JSON.stringify(data.body || data) });
  });
}

test('dual perspective, exact permission/revoke bodies, refetch, keyboard modal and mobile accessibility', async ({ page }) => {
  let rows = structuredClone(links); const patches = []; let reads = 0;
  await fixture(page, { respond: (path, req) => {
    if (path === '/api/relationships') { reads++; return { relationships: rows }; }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); patches.push(body); rows[0] = { ...rows[0], ...body }; return { relationship: rows[0] }; }
  } });
  await page.goto('/relationships');
  const patient = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People who care for me', exact: true }) });
  const caregiver = page.locator('section').filter({ has: page.getByRole('heading', { name: 'People I care for', exact: true }) });
  await expect(patient.getByRole('heading', { name: 'Sam Example' })).toBeVisible();
  await expect(caregiver.getByRole('heading', { name: 'Sam Example' })).toBeVisible();
  await expect(caregiver.getByRole('button')).toHaveCount(0);
  const trigger = patient.getByRole('button', { name: 'Manage permissions' });
  await trigger.click();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('radio', { name: /^Full access/ }).check();
  const before = reads;
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(reads).toBeGreaterThan(before); expect(patches).toEqual([{ permissionLevel: 'full_access' }]);
  await expect(patient.getByText('Full access', { exact: true })).toBeVisible();
  await trigger.click(); await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: "Revoke Sam Example's access?" });
  await expect(confirm.getByText('They will stop seeing your information immediately.')).toBeVisible();
  await confirm.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(patches[1]).toEqual({ status: 'revoked' });
  await expect(patient.getByText('Revoked', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await trigger.click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('invite sends only three keys, self-invite is inline, success has no copy-link and refetches', async ({ page }) => {
  let body; let reads = 0; let self = true;
  await fixture(page, { respond: (path, req) => {
    if (path === '/api/relationships') reads++;
    if (path === '/api/invitations') { body = req.postDataJSON(); return self ? { status: 400, body: { error: 'You cannot invite yourself.' } } : { status: 201, body: { invitation: { inviteeEmail: body.inviteeEmail }, message: 'Invitation emailed.' } }; }
  } });
  await page.goto('/relationships/invite');
  await page.getByLabel('Invitee email').fill('alex@example.test');
  await page.getByRole('button', { name: 'Daughter', exact: true }).click();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByLabel('Invitee email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('You cannot invite yourself.')).toBeVisible();
  self = false; await page.getByLabel('Invitee email').fill('new@example.test');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent to new@example.test. The link works for 7 days.')).toBeVisible();
  expect(body).toEqual({ inviteeEmail: 'new@example.test', relationshipType: 'daughter', proposedRole: 'caregiver' });
  expect(reads).toBeGreaterThan(0);
  await expect(page.getByText('For security, the invitation link is only in the email.')).toBeVisible();
  await expect(page.getByRole('button', { name: /copy/i })).toHaveCount(0);
});

for (const [status, message, title] of [[404, 'Invitation not found.', 'Invitation not found'], [409, 'Invitation already answered.', 'Invitation already answered'], [410, 'Invitation expired.', 'Invitation expired']]) {
  test(`public preview ${status} has a distinct terminal state`, async ({ page }) => {
    await fixture(page, { signedIn: false, respond: (path, req) => {
      if (path.includes('/invitations/')) { expect(req.headers().authorization).toBeUndefined(); return { status, body: { error: message } }; }
    } });
    await page.goto(`/invitations/${token}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  });
}

test('public preview stays unauthenticated; wrong-account 403 offers switching with token intact', async ({ page }) => {
  await fixture(page, { respond: (path, req) => {
    if (path.endsWith(`/invitations/${token}`)) expect(req.headers().authorization).toBeUndefined();
    if (path.endsWith('/accept')) return { status: 403, body: { error: 'Sign in with the verified email this invitation was sent to.' } };
  } });
  await page.goto(`/invitations/${token}`);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByText(/Sign in with the verified email this invitation was sent to/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out and switch account' }).click();
  await expect(page).toHaveURL(new RegExp(`/login\\?inviteToken=${token}`));
});

test('decline commits once even if relationships refresh fails; retry only reads', async ({ page }) => {
  let declined = 0; let fail = true;
  await fixture(page, { respond: (path) => {
    if (path.endsWith('/decline')) { declined++; return { message: 'Invitation declined.' }; }
    if (path === '/api/relationships' && fail) return 'abort';
  } });
  await page.goto(`/invitations/${token}`);
  await page.getByRole('button', { name: 'Decline invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Invitation declined', exact: true })).toBeVisible();
  await expect(page.getByText('Could not reach MediTrack. Check your connection and try again.')).toBeVisible();
  fail = false; await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0); expect(declined).toBe(1);
});

test('accept refetches before navigating; answer race 409 stays distinct', async ({ page }) => {
  let race = true; let reads = 0;
  await fixture(page, { respond: (path) => {
    if (path.endsWith('/accept')) return race ? { status: 409, body: { error: 'Invitation is no longer available.' } } : { status: 201, body: { relationship: links[1] } };
    if (path === '/api/relationships') reads++;
  } });
  await page.goto(`/invitations/${token}`); await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Invitation already answered', exact: true })).toBeVisible();
  race = false; await page.reload(); await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page).toHaveURL(/\/relationships$/); expect(reads).toBeGreaterThan(0);
});

test('permission rejection preserves the modal and exact backend error', async ({ page }) => {
  await fixture(page, { respond: (path, req) => req.method() === 'PATCH' ? { status: 403, body: { error: 'Only the patient may manage this relationship.' } } : undefined });
  await page.goto('/relationships');
  await page.getByRole('button', { name: 'Manage permissions' }).click();
  await page.getByRole('radio', { name: /^Full access/ }).check();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Only the patient may manage this relationship.')).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: invite and public preview fit 360px and pass accessibility checks`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await fixture(page, { respond: (path) => path === '/api/users/me' ? { user: { ...user, preferences: { theme } } } : undefined });
    for (const path of ['/relationships/invite', `/invitations/${token}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: path === '/relationships/invite' ? 'Invite someone' : 'Invitation', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });
}
