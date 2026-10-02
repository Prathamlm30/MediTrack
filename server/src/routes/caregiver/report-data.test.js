import test from 'node:test';
import assert from 'node:assert/strict';
import { reportWindow, generateWeeklySummary } from '../../jobs/weeklyReportData.js';

test('report windows end on the latest completed Sunday night and are seven days long', () => {
  for (const instant of ['2026-10-03T10:00:00Z', '2026-10-04T22:59:59Z']) {
    const { start, end } = reportWindow(new Date(instant));
    assert.equal(start.toISOString(), '2026-09-20T23:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-27T23:00:00.000Z');
  }
  assert.equal(reportWindow(new Date('2026-10-04T23:00:00Z')).end.toISOString(), '2026-10-04T23:00:00.000Z');
  assert.throws(() => reportWindow(new Date('2026-10-03'), '2026-10-04'), /finished/);
  assert.throws(() => reportWindow(new Date('2026-10-03'), '2026-02-30'), /real/);
});

test('generic, wrong-count and incomplete Gemini responses are rejected without a fallback', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only';
  const facts = 'The patient missed 2 doses during this week.';
  try {
    for (const [text, finishReason] of [
      ['Adherence was good overall.', 'STOP'],
      ['The patient missed 0 doses during this week.', 'STOP'],
      [facts, 'MAX_TOKENS'],
      [`${facts} Another 4 doses were taken.`, 'STOP'],
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return { ok: true, json: async () => ({ candidates: [{ finishReason,
          content: { parts: [{ text: JSON.stringify({ summaryText: text }) }] } }] }) };
      };
      await assert.rejects(generateWeeklySummary({ facts }), /factual validation/);
      assert.equal(calls, 2);
    }
    const summaryText = `${facts} The missed doses involved Demo medicine 2.`;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: JSON.stringify({ summaryText }) }] } }] }) });
    assert.equal(await generateWeeklySummary({ facts, doseLogs: [{ schedule: { medication: { medicineName: 'Demo medicine 2' } } }] }), summaryText);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});
