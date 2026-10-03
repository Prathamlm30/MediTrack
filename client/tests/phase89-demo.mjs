// Drive the existing dev endpoints while the caregiver watches the real UI.
// node client/tests/phase89-demo.mjs trigger [first|second]
// node client/tests/phase89-demo.mjs taken
// node client/tests/phase89-demo.mjs reports
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { requiredEnv } from '../../server/src/config/env.js';

if (process.env.NODE_ENV === 'production') throw new Error('Development demonstration only.');
const [action = 'trigger', target = 'second'] = process.argv.slice(2);
if (!['trigger', 'taken', 'reports'].includes(action) || !['first', 'second'].includes(target)) {
  throw new Error('Usage: node client/tests/phase89-demo.mjs trigger [first|second] | taken | reports');
}
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const jwt = require('jsonwebtoken');
const env = require('dotenv').parse(await readFile(new URL('../.env.phase89-demo', import.meta.url)));
const base = process.env.DEMO_API_URL || 'http://127.0.0.1:3000';
const output = new URL('../.cache/phase89/', import.meta.url);
const lastDose = new URL('last-dose.json', output);
// Local test credentials never enter logs or browser markup, and do not rotate
// the caregiver's refresh session while they are watching the demo.
async function api(userId, path, method = 'GET', body) {
  const token = jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), {
    algorithm: 'HS256', subject: String(userId), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m',
  });
  const response = await fetch(`${base}/api${path}`, { method, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}
if (action === 'trigger') {
  const patientId = Number(target === 'first' ? env.PATIENT_ID : env.SECOND_PATIENT_ID);
  const scheduleId = Number(target === 'first' ? env.FIRST_SCHEDULE_ID : env.SECOND_SCHEDULE_ID);
  const settings = await api(patientId, '/escalation-settings');
  try {
    // Existing Phase 8 setting is process-global; restore it even on failure.
    await api(patientId, '/escalation-settings', 'PATCH', { gracePeriodMinutes: 0.001 });
    const dose = await api(patientId, '/escalations/dev/overdue-dose', 'POST', { scheduleId });
    await mkdir(output, { recursive: true });
    await writeFile(lastDose, JSON.stringify({ patientId, doseLogId: dose.id }));
    await api(patientId, '/escalations/jobs/run', 'POST', { patientId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = await api(patientId, '/escalations/jobs/run', 'POST', { patientId });
    console.log(`Dose ${dose.id}: ${result.level2Created} caregiver alert(s) created. Watch /alerts?patientId=${patientId}; no reload is needed.`);
  } finally {
    await api(patientId, '/escalation-settings', 'PATCH', { gracePeriodMinutes: settings.gracePeriodMinutes });
  }
} else if (action === 'taken') {
  const { patientId, doseLogId } = JSON.parse(await readFile(lastDose, 'utf8'));
  await api(patientId, `/dose-logs/${doseLogId}`, 'PATCH', { status: 'taken' });
  console.log(`Dose ${doseLogId} was logged taken by patient ${patientId}. Click Resolve on its newest alert in the caregiver UI.`);
} else {
  const result = await api(env.CAREGIVER_ID, '/reports/weekly/jobs/run', 'POST', { patientId: Number(env.PATIENT_ID) });
  console.log(`Report IDs: ${result.reportIds.join(', ')}. Open /patients/${env.PATIENT_ID}#weekly-reports. Existing weeks are reused.`);
}
