import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test.use({ locale: 'en-US', timezoneId: 'America/Los_Angeles' });
const preview = (theme) => `/dev/ui?frame=1&theme=${theme}`;
const card = (page, name) => page.getByRole('heading', { name, exact: true }).locator('..').locator('..');
async function ready(page, theme) {
  await page.goto(preview(theme));
  await expect(page.getByRole('heading', { name: `${theme === 'dark' ? 'Dark' : 'Light'} component gallery` })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function save(name, data) {
  await writeFile(`test-results/ui1-${name}.json`, JSON.stringify(data, null, 2));
}
for (const theme of ['light', 'dark']) {
  test(`${theme}: input heights, error semantics, avatars and button states`, async ({ page }) => {
    const consoleIssues = []; page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) consoleIssues.push(message.text()); });
    page.on('pageerror', (error) => consoleIssues.push(error.message));
    await ready(page, theme);
    const heights = {};
    for (const type of ['Text input', 'Password input']) {
      heights[type] = {};
      for (const state of ['default', 'focus', 'error', 'disabled', 'read-only']) {
        const input = page.getByLabel(`${type} · ${state}`, { exact: false });
        const dimensions = await input.evaluate((element) => ({ height: element.getBoundingClientRect().height, token: Number.parseFloat(getComputedStyle(element).getPropertyValue('--h-control')) }));
        expect(dimensions.height).toBe(dimensions.token); expect(dimensions.height).toBe(48); heights[type][state] = dimensions.height;
      }
      const error = page.getByLabel(`${type} · error`, { exact: true });
      await expect(error).toHaveAttribute('aria-invalid', 'true');
      const description = await error.getAttribute('aria-describedby');
      await expect(page.locator(`[id="${description}"]`)).toHaveText('Check this example value.');
      const border = await error.evaluate((element) => ({ color: getComputedStyle(element).borderTopColor, width: getComputedStyle(element).borderTopWidth }));
      expect(border.width).toBe('1px');
      expect(border.color).not.toBe(await page.getByLabel(`${type} · default`, { exact: false }).evaluate((element) => getComputedStyle(element).borderTopColor));
    }
    const image = page.getByRole('img', { name: 'Image example', exact: true });
    await expect.poll(() => image.evaluate((element) => element.tagName === 'IMG' && element.complete && element.naturalWidth > 0)).toBe(true);
    expect(await image.getAttribute('src')).not.toContain('%3Ctext');
    const widths = [];
    for (const variant of ['primary', 'secondary', 'ghost', 'danger']) {
      const group = page.getByRole('heading', { name: variant, exact: true }).locator('..');
      for (let index = 0; index < 2; index++) {
        const normal = group.locator('button[data-preview="default"]').nth(index);
        const loading = group.locator('button[data-preview="loading"]').nth(index);
        const disabled = group.locator('button[data-preview="disabled"]').nth(index);
        await expect(normal).toHaveAttribute('type', 'button'); await expect(disabled).toBeDisabled(); await expect(loading).toHaveAttribute('aria-busy', 'true');
        const width = (await normal.boundingBox()).width; expect((await loading.boundingBox()).width).toBe(width);
        widths.push({ variant, size: index ? 'md' : 'sm', width });
      }
    }
    const danger = page.getByRole('heading', { name: 'danger', exact: true }).locator('..').locator('button[data-preview="default"]').first();
    const originalColor = await danger.evaluate((element) => getComputedStyle(element).color);
    await danger.hover();
    await expect.poll(() => danger.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(await danger.evaluate((element) => {
      const probe = document.createElement('span'); probe.style.background = 'var(--danger)'; element.append(probe); const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value;
    }));
    expect(await danger.evaluate((element) => getComputedStyle(element).color)).toBe(originalColor);
    expect(consoleIssues).toEqual([]);
    await save(`${theme}-controls`, { heights, widths, consoleIssues });
    await card(page, 'Form controls').screenshot({ path: `test-results/ui1-${theme}-inputs.png` });
  });
  test(`${theme}: all three dialogs trap focus, lock scroll, close and restore focus`, async ({ page }) => {
    await ready(page, theme);
    const results = [];
    for (const label of ['Open modal', 'Open confirmation', 'Open destructive confirmation']) {
      const trigger = page.getByRole('button', { name: label, exact: true }); await trigger.click();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      const buttons = dialog.locator('button:not(:disabled), input:not(:disabled)');
      await buttons.last().focus(); await page.keyboard.press('Tab'); await expect(buttons.first()).toBeFocused();
      expect(await buttons.first().evaluate((element) => getComputedStyle(element).boxShadow !== 'none')).toBe(true);
      await page.keyboard.press('Shift+Tab'); await expect(buttons.last()).toBeFocused();
      const scroll = await page.evaluate(() => window.scrollY);
      await page.mouse.move(1, 1); await page.mouse.wheel(0, 600);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      await trigger.click(); await page.mouse.click(1, 1); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      results.push({ dialog: label, entered: true, trappedBothDirections: true, scrollLocked: true, escapeAndBackdropClosed: true, focusRestored: true });
    }
    await save(`${theme}-dialogs`, results);
  });
  test(`${theme}: DayRail timezone, midnight chronology, mobile axis and glyphs`, async ({ page }) => {
    await ready(page, theme);
    const regular = card(page, 'Day rail').getByRole('figure');
    const names = await regular.locator('[tabindex="0"][role="img"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
    expect(names).toEqual(['8:00 AM, Example 1 1 tablet, taken', '12:00 PM, Example 2 1 tablet, missed', '4:00 PM, Example 3 1 tablet, skipped', '8:00 PM, Example 4 1 tablet, snoozed', '11:30 PM, Example 5 1 tablet, pending']);
    const boundary = card(page, 'Midnight and late evening').getByRole('figure');
    await expect(boundary.locator('time')).toHaveText(['12:00 AM', '11:30 PM']);
    const markers = boundary.locator('[tabindex="0"][role="img"]');
    const first = await markers.first().boundingBox(); const last = await markers.last().boundingBox(); expect(first.x).toBeLessThan(last.x); expect(first.y).toBe(last.y);
    const positions = await markers.evaluateAll((elements) => elements.map((element) => element.parentElement.style.getPropertyValue('--position')));
    expect(positions).toEqual(['0%', '100%']);
    const fallback = card(page, 'Browser timezone fallback').getByRole('figure');
    await expect(fallback).toHaveAttribute('aria-label', 'Dose timeline in America/Los_Angeles');
    await expect(fallback.locator('time')).toHaveText(['11:30 AM', '11:00 AM']);
    const glyphs = await regular.locator('[tabindex="0"][role="img"] > svg').evaluateAll((elements) => elements.map((element) => element.innerHTML));
    expect(new Set(glyphs).size).toBe(5);
    await page.setViewportSize({ width: 360, height: 800 });
    const mobileFirst = await markers.first().boundingBox(); const mobileLast = await markers.last().boundingBox(); expect(mobileFirst.x).toBe(mobileLast.x); expect(mobileFirst.y).toBeLessThan(mobileLast.y);
    for (const marker of await regular.locator('[tabindex="0"][role="img"]').all()) { await marker.focus(); await expect(marker).toBeFocused(); await expect(marker).toHaveAccessibleName(/Example [1-5].*(taken|missed|skipped|snoozed|pending)/); }
    await save(`${theme}-rail`, { browserTimezone: 'America/Los_Angeles', suppliedTimezone: 'Asia/Kolkata', names, positions, distinctGlyphs: glyphs.length, verticalAt360: true });
    await boundary.screenshot({ path: `test-results/ui1-${theme}-rail-360.png` });
  });
  test(`${theme}: reduced motion disables animations and transitions`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page, theme);
    const motion = await page.evaluate(() => {
      const animated = [...document.querySelectorAll('*')].filter((element) => getComputedStyle(element).animationName !== 'none');
      const transitions = [...document.querySelectorAll('*')].filter((element) => getComputedStyle(element).transitionDuration.split(',').some((duration) => parseFloat(duration) > 0));
      return { running: document.getAnimations().filter((animation) => animation.playState === 'running').length, animated: animated.length, transitions: transitions.length };
    });
    expect(motion).toEqual({ running: 0, animated: 0, transitions: 0 }); await save(`${theme}-motion`, motion);
  });
  test(`${theme}: contrast ratios for every requested token pair`, async ({ page }) => {
    await ready(page, theme);
    const ratios = await page.evaluate(() => {
      const pairs = [
        ['Body / page', '--ink', '--field'], ['Body / surface', '--ink', '--paper'], ['Secondary / page', '--ink-2', '--field'], ['Secondary / surface', '--ink-2', '--paper'],
        ['Disabled', '--ink-2', '--paper-sunk'], ['Primary', '--brand-ink', '--brand'], ['Primary hover', '--brand-ink', '--brand-hover'], ['Danger', '--paper', '--danger'], ['Danger hover', '--paper', '--danger-hover'],
        ['Taken / active / full access', '--taken', '--taken-bg'], ['Missed / revoked', '--missed', '--missed-bg'], ['Skipped / expired / alerts only', '--skipped', '--skipped-bg'], ['Snoozed / view only', '--snoozed', '--snoozed-bg'], ['Pending', '--ink-2', '--pending-bg'],
      ];
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d');
      const probe = document.createElement('span'); document.body.append(probe);
      const rgb = (token) => { probe.style.color = `var(${token})`; context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(probe).color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const luminance = (channels) => channels.map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const results = pairs.map(([name, foreground, background]) => { const fg = rgb(foreground); const bg = rgb(background); const a = luminance(fg); const b = luminance(bg); return { name, foreground, background, fg, bg, ratio: Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2)) }; });
      probe.remove(); return results;
    });
    await save(`${theme}-contrast`, ratios); expect(ratios.filter((pair) => pair.ratio < 4.5)).toEqual([]);
  });
}
test('entire two-theme gallery: real Tab traversal, visible focus rings, no console issues', async ({ page }) => {
  test.setTimeout(60000);
  const issues = []; page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) issues.push(message.text()); }); page.on('pageerror', (error) => issues.push(error.message));
  await page.goto('/dev/ui');
  for (const theme of ['light', 'dark']) {
    const frame = page.frameLocator(`iframe[title="${theme} component preview"]`);
    await expect(frame.getByRole('heading', { name: `${theme === 'light' ? 'Light' : 'Dark'} component gallery` })).toBeVisible();
    while (await frame.getByRole('button', { name: 'Dismiss notification' }).count()) await frame.getByRole('button', { name: 'Dismiss notification' }).first().click();
  }
  const expected = await page.evaluate(() => {
    const documents = [document, ...[...document.querySelectorAll('iframe')].map((frame) => frame.contentDocument)];
    const ids = [];
    for (const [index, doc] of documents.entries()) {
      const elements = [...doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length);
      elements.forEach((element, item) => { element.dataset.audit = `${index}-${item}`; ids.push(element.dataset.audit); });
    }
    document.body.tabIndex = -1; document.body.focus(); return ids;
  });
  const visited = [];
  for (const id of expected) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      let doc = document; let element = doc.activeElement;
      while (element?.tagName === 'IFRAME') { doc = element.contentDocument; element = doc.activeElement; }
      const style = doc.defaultView.getComputedStyle(element);
      return { id: element.dataset.audit, visible: element.matches(':focus-visible'), ring: style.boxShadow !== 'none', theme: doc.documentElement.dataset.theme || 'wrapper' };
    });
    expect(focus.id).toBe(id); expect(focus.visible).toBe(true); expect(focus.ring).toBe(true); visited.push(focus);
  }
  expect(new Set(visited.map((item) => item.id)).size).toBe(expected.length);
  // Roving tabs intentionally expose one tab stop; the other tabs are reached with arrows.
  for (const theme of ['light', 'dark']) {
    const frame = page.frameLocator(`iframe[title="${theme} component preview"]`);
    const first = frame.getByRole('tab', { name: 'First section' }); await first.focus(); await page.keyboard.press('ArrowRight');
    await expect(frame.getByRole('tab', { name: 'Second section' })).toBeFocused();
    await frame.getByRole('button', { name: 'Show success toast' }).click();
    const dismiss = frame.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss notification' }); await dismiss.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await expect(dismiss).toBeFocused();
    expect(await dismiss.evaluate((element) => getComputedStyle(element).boxShadow !== 'none')).toBe(true); await dismiss.click();
    await frame.getByRole('button', { name: 'Asha Rao' }).click();
    await frame.getByRole('menuitemradio', { name: 'Asha Rao' }).focus(); await page.keyboard.press('ArrowDown');
    const nextPatient = frame.getByRole('menuitemradio', { name: 'Ravi Rao' }); await expect(nextPatient).toBeFocused();
    expect(await nextPatient.evaluate((element) => getComputedStyle(element).boxShadow !== 'none')).toBe(true); await page.keyboard.press('Escape');
  }
  expect(issues).toEqual([]); await save('keyboard-console', { count: visited.length, visited, issues });
});
test('browser: three expired requests cause exactly one refresh and leak no token text', async ({ page }) => {
  const output = []; page.on('console', (message) => output.push(message.text()));
  let refreshes = 0; let expired = 0; const replayed = [];
  await page.route('http://127.0.0.1:3000/api/**', async (route) => {
    if (route.request().url().endsWith('/auth/refresh')) { refreshes++; return route.fulfill({ json: { accessToken: 'ui1-new-access', refreshToken: 'ui1-new-refresh' } }); }
    if (route.request().headers().authorization === 'Bearer ui1-expired-access') { expired++; return route.fulfill({ status: 401, json: { error: 'Expired session.' } }); }
    replayed.push(new URL(route.request().url()).pathname); return route.fulfill({ json: { ok: true } });
  });
  await ready(page, 'light');
  const result = await page.evaluate(async () => {
    const api = await import('/src/api/client.js'); api.setSession({ accessToken: 'ui1-expired-access', refreshToken: 'ui1-old-refresh' });
    const results = await Promise.all(['/api/users/me', '/api/relationships', '/api/dashboard/patient'].map((path) => api.request(path)));
    return results.every((response) => response.ok);
  });
  expect(result).toBe(true); expect(expired).toBe(3); expect(refreshes).toBe(1); expect(replayed).toHaveLength(3);
  expect(output.join(' ')).not.toMatch(/ui1-(new|old|expired)-(access|refresh)/);
  expect(await page.locator('body').innerText()).not.toMatch(/ui1-(new|old|expired)-(access|refresh)/);
  await save('browser-refresh', { expired, refreshes, replays: replayed.length, consoleTokenLeak: false, domTokenLeak: false });
});

test('browser: a late old-token 401 reuses the rotated access token', async ({ page }) => {
  let release; const gate = new Promise((resolve) => { release = resolve; }); let refreshes = 0;
  await page.route('http://127.0.0.1:3000/api/**', async (route) => {
    if (route.request().url().endsWith('/auth/refresh')) { refreshes++; return route.fulfill({ json: { accessToken: 'rotated-fixture', refreshToken: 'rotated-refresh-fixture' } }); }
    if (route.request().headers().authorization === 'Bearer expired-fixture') {
      if (route.request().url().endsWith('/relationships')) await gate;
      return route.fulfill({ status: 401, json: { error: 'Expired session.' } });
    }
    if (route.request().url().endsWith('/users/me')) release();
    return route.fulfill({ json: { ok: true } });
  });
  await ready(page, 'light');
  const result = await page.evaluate(async () => {
    const api = await import('/src/api/client.js'); api.setSession({ accessToken: 'expired-fixture', refreshToken: 'refresh-fixture' });
    return Promise.all([api.request('/api/relationships'), api.request('/api/users/me')]);
  });
  expect(result).toEqual([{ ok: true }, { ok: true }]); expect(refreshes).toBe(1);
  await save('browser-stale-401', { refreshes, successfulRequests: result.length });
});
test('browser: failed refresh clears stored auth and redirects with the session-ended notice', async ({ page }) => {
  let refreshes = 0;
  await page.route('http://127.0.0.1:3000/api/**', async (route) => {
    if (route.request().url().endsWith('/auth/refresh')) refreshes++;
    await route.fulfill({ status: 401, json: { error: 'Session expired.' } });
  });
  await ready(page, 'light');
  await page.evaluate(async () => {
    const api = await import('/src/api/client.js'); api.setSession({ accessToken: 'expired-fixture', refreshToken: 'revoked-fixture' });
    await api.request('/api/users/me').catch(() => {});
  });
  await expect(page).toHaveURL(/\/login\?notice=session-ended$/);
  await expect(page.getByText('Your session ended. Sign in again to continue.')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('meditrack.refresh'))).toBeNull(); expect(refreshes).toBe(1);
  expect(await page.locator('body').innerText()).not.toMatch(/expired-fixture|revoked-fixture/);
  await save('browser-refresh-failure', { refreshes, storageCleared: true, loginNoticeVisible: true });
});
