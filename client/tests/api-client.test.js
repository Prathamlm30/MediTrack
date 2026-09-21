import { test } from 'node:test';
import assert from 'node:assert/strict';
let instance = 0;
async function client() {
  const storage = new Map();
  globalThis.sessionStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  globalThis.window = { location: { replace: (path) => { globalThis.redirect = path; } } };
  globalThis.redirect = null;
  return import(`../src/api/client.js?test=${++instance}`);
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((done) => setTimeout(done, 0));
test('parallel 401s and new requests queue behind one rotating refresh', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'refresh-old', user: { id: 1 } });
  const gate = deferred(); let refreshes = 0; let replays = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/refresh')) { refreshes++; await gate.promise; return json({ accessToken: 'new', refreshToken: 'refresh-new' }); }
    if (options.headers.get('Authorization') === 'Bearer old') return json({ error: 'Expired' }, 401);
    replays++; return json({ ok: true });
  };
  const first = api.request('/api/users/me'); const second = api.request('/api/relationships');
  const third = api.request('/api/dashboard/patient');
  await tick(); const fourth = api.request('/api/dashboard/my-patients');
  assert.equal(refreshes, 1); assert.equal(replays, 0);
  gate.resolve(); assert.deepEqual(await Promise.all([first, second, third, fourth]), [{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
  assert.equal(refreshes, 1); assert.equal(replays, 4); assert.equal(api.getSession().refreshToken, 'refresh-new');
});
test('late old-token 401 uses the new access token without refreshing again', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'r' });
  const late = deferred(); let refreshes = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/refresh')) { refreshes++; return json({ accessToken: 'new', refreshToken: 'r2' }); }
    if (options.headers.get('Authorization') === 'Bearer old') { if (url.endsWith('/relationships')) await late.promise; return json({}, 401); }
    return json({ ok: true });
  };
  const slow = api.request('/api/relationships'); await api.request('/api/users/me'); late.resolve(); await slow;
  assert.equal(refreshes, 1);
});
test('failed refresh rejects all waiters, clears session, redirects once', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'r' });
  const gate = deferred(); let refreshes = 0;
  globalThis.fetch = async (url) => { if (url.endsWith('/refresh')) { refreshes++; await gate.promise; } return json({}, 401); };
  const work = Promise.allSettled([api.request('/api/users/me'), api.request('/api/relationships')]); await tick(); gate.resolve();
  assert.ok((await work).every((item) => item.status === 'rejected')); assert.equal(refreshes, 1);
  assert.equal(api.getSession(), null); assert.equal(globalThis.redirect, '/login?notice=session-ended');
});
test('replayed 401 terminates without a refresh loop; public 401 never refreshes', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'r' }); let refreshes = 0;
  globalThis.fetch = async (url) => { if (url.endsWith('/refresh')) { refreshes++; return json({ accessToken: 'new', refreshToken: 'r2' }); } return json({}, 401); };
  await assert.rejects(api.request('/api/auth/login', { auth: false }), { status: 401 }); assert.equal(refreshes, 0);
  await assert.rejects(api.request('/api/users/me'), { status: 401 }); assert.equal(refreshes, 1); assert.equal(api.getSession(), null);
});
test('403 does not refresh or clear the session', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'r' });
  globalThis.fetch = async () => json({ error: 'Permission changed' }, 403);
  await assert.rejects(api.request('/api/dashboard/caregiver/2'), { status: 403 }); assert.ok(api.getSession()); assert.equal(globalThis.redirect, null);
});
test('abort removes one waiter without cancelling shared refresh', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'r' }); const gate = deferred();
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/refresh')) { await gate.promise; return json({ accessToken: 'new', refreshToken: 'r2' }); }
    return options.headers.get('Authorization') === 'Bearer old' ? json({}, 401) : json({ ok: true });
  };
  const controller = new AbortController(); const aborted = api.request('/api/users/me', { signal: controller.signal });
  const assertion = assert.rejects(aborted, { name: 'AbortError' }); const alive = api.request('/api/relationships');
  await tick(); controller.abort(); await assertion; gate.resolve(); assert.deepEqual(await alive, { ok: true });
});
test('initial session restoration shares one refresh and loads profile', async () => {
  const api = await client(); sessionStorage.setItem('meditrack.refresh', 'r'); let refreshes = 0;
  globalThis.fetch = async (url) => { if (url.endsWith('/refresh')) { refreshes++; return json({ accessToken: 'new', refreshToken: 'r2' }); } return json({ user: { id: 1 } }); };
  await Promise.all([api.restoreSession(), api.restoreSession()]); assert.equal(refreshes, 1); assert.equal(api.getSession().user.id, 1);
});
test('an in-flight refresh cannot restore a signed-out session', async () => {
  const api = await client(); api.setSession({ accessToken: 'old', refreshToken: 'r' }); const gate = deferred();
  globalThis.fetch = async () => { await gate.promise; return json({ accessToken: 'new', refreshToken: 'r2' }); };
  const work = api.refreshSession(); await tick(); api.setSession(null); gate.resolve(); await assert.rejects(work); assert.equal(api.getSession(), null);
});
