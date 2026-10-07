import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeCoalesced } from '../src/hooks/dataChanged.js';
import { activitySentence } from '../src/pages/account/activityText.js';
import { badgeLabel } from '../src/api/notifications.js';
import { supportOutcome, supportValidation } from '../src/api/support.js';

test('useDataChanged subscription coalesces bursts after the last matching event', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let listener, reads = 0, unsubscribed = false;
  const stop = subscribeCoalesced((fn) => { listener = fn; return () => { unsubscribed = true; }; }, ['dose_log', 'inventory'], 'patient:opaque', () => reads++);
  listener({ patientId: 'patient:opaque', resource: 'dose_log', id: 'not-a-number' });
  t.mock.timers.tick(300);
  listener({ patientId: 'patient:opaque', resource: 'inventory', id: 'another:id' });
  t.mock.timers.tick(399); assert.equal(reads, 0);
  t.mock.timers.tick(1); assert.equal(reads, 1);
  listener({ patientId: 'other', resource: 'dose_log' });
  listener({ patientId: 'patient:opaque', resource: 'insight' });
  t.mock.timers.tick(500); assert.equal(reads, 1);
  listener({ patientId: 'patient:opaque', resource: 'dose_log' }); stop();
  t.mock.timers.tick(500); assert.equal(reads, 1); assert.equal(unsubscribed, true);
});
test('useDataChanged compares URL IDs without numeric parsing and ignores missing scope', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let listener, reads = 0;
  let stop = subscribeCoalesced((fn) => { listener = fn; return () => {}; }, ['schedule'], '007', () => reads++);
  listener({ patientId: 7, resource: 'schedule' }); t.mock.timers.tick(500); assert.equal(reads, 0);
  listener({ patientId: '007', resource: 'schedule' }); t.mock.timers.tick(400); assert.equal(reads, 1); stop();
  stop = subscribeCoalesced((fn) => { listener = fn; return () => {}; }, ['schedule'], undefined, () => reads++);
  listener({ resource: 'schedule' }); t.mock.timers.tick(400); assert.equal(reads, 1); stop();
});
test('badge displays numeric unread counts capped at 99+', () => {
  assert.deepEqual([0, 1, 99, 100, 12345].map(badgeLabel), ['0', '1', '99', '99+', '99+']);
});
test('audit sentences cover sign-ins, actor and subject reads, permissions and revocation', () => {
  const row = { actor: { id: 'me', fullName: 'Alex' }, details: {} };
  assert.equal(activitySentence({ ...row, actionType: 'login_local' }, 'me'), 'You signed in with email and password.');
  assert.equal(activitySentence({ ...row, actionType: 'login_google' }, 'me'), 'You signed in with Google.');
  assert.equal(activitySentence({ ...row, actionType: 'caregiver_read', subjectPatientId: 'someone' }, 'me'), "You viewed a patient's information.");
  assert.equal(activitySentence({ ...row, actionType: 'caregiver_read', subjectPatientId: 'patient', details: { routeGroup: '/api/dashboard' } }, 'patient'), 'Alex viewed your health information (dashboard).');
  assert.equal(activitySentence({ ...row, actionType: 'permission_change', details: { previousPermissionLevel: 'full_access', newPermissionLevel: 'view_only' } }, 'me', 'Caregiver'), 'You changed access for Caregiver: Full access to View only.');
  assert.equal(activitySentence({ ...row, actionType: 'permission_change', details: { previousPermissionLevel: 'alerts_only', newStatus: 'revoked' } }, 'other'), 'Alex changed access: Alerts only to Revoked.');
});
test('unknown audit fields never become raw keys, JSON or health details', () => {
  const row = { actionType: 'caregiver_read', subjectPatientId: 'me', details: { routeGroup: 'SECRET_RAW_KEY', nested: { raw: 'SECRET_JSON' } } };
  assert.equal(activitySentence(row, 'me'), 'Someone viewed your health information (an area of your record).');
  assert.equal(activitySentence({ ...row, actionType: 'UNKNOWN' }, 'me'), 'An account activity was recorded.');
});
for (const status of [201, 400, 429, 502, 503]) test(`support ${status} has a distinct outcome; only 201 is success`, () => {
  const outcome = supportOutcome(status, '121');
  assert.equal(Boolean(outcome.sent), status === 201);
  if (status === 400) assert.equal(outcome.validation, true);
  if (status === 429) assert.match(outcome.message, /Wait 3 minutes/);
  if (status === 502) assert.match(outcome.message, /mail service could not accept/);
  if (status === 503) assert.match(outcome.message, /inbox is not configured/);
});
test('support validates trimmed bounds and handles Retry-After date or absence', () => {
  assert.ok(supportValidation(' ', ' ').subject);
  assert.equal(supportValidation(' a ', ' b ').subject, '');
  assert.ok(supportValidation('x'.repeat(121), 'x'.repeat(2001)).message);
  assert.match(supportOutcome(429).message, /up to one hour/);
  assert.match(supportOutcome(429, 'Tue, 06 Oct 2026 12:02:00 GMT', Date.parse('2026-10-06T12:00:00Z')).message, /2 minutes/);
  assert.equal(Boolean(supportOutcome(200).sent), false);
});
test('shared client preserves support response status and Retry-After without changing normal responses', async () => {
  const { request } = await import('../src/api/client.js');
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ accepted: true }, { status: 201 });
    assert.deepEqual(await request('/api/support-tickets', { auth: false, responseMeta: true }), { data: { accepted: true }, status: 201 });
    assert.deepEqual(await request('/normal', { auth: false }), { accepted: true });
    globalThis.fetch = async () => Response.json({ error: 'Limited' }, { status: 429, headers: { 'Retry-After': '90' } });
    await assert.rejects(request('/api/support-tickets', { auth: false }), (error) => error.status === 429 && error.retryAfter === '90');
  } finally { globalThis.fetch = oldFetch; }
});
