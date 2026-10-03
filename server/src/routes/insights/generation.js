import prisma from '../../prismaClient.js';
import { inventoryTransaction } from '../../services/inventory.service.js';
import { generateText } from '../chat/gemini.js';

const pending = new Map();
export function weekStart(now) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return start;
}
// One cached insight per patient per UTC week. No notes or medication names are
// sent to Gemini; only status counts and local time-of-day counts from DoseLog.
export async function generateAdherenceInsight(patientId, now = new Date()) {
  const start = weekStart(now);
  const key = `${patientId}:${start.toISOString()}`;
  if (pending.has(key)) return pending.get(key);
  const work = async () => {
    const where = { patientId, insightType: 'adherence_pattern', generatedAt: { gte: start, lt: new Date(start.getTime() + 7 * 86400000) } };
    const cached = await prisma.aiInsight.findFirst({ where, orderBy: { id: 'asc' } });
    if (cached) return { status: 'cached', insight: cached };
    const patient = await prisma.user.findUniqueOrThrow({ where: { id: patientId }, select: { timezone: true, preferences: { select: { timezone: true } } } });
    const logs = await prisma.doseLog.findMany({ where: { patientId, schedule: { medication: { patientId } },
      scheduledDatetime: { gte: new Date(now.getTime() - 7 * 86400000), lt: now } }, select: { scheduledDatetime: true, status: true } });
    if (!logs.length) return { status: 'no_data', insight: null };
    let formatter;
    try { formatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: patient.preferences?.timezone || patient.timezone || 'UTC' }); }
    catch { formatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }); }
    const counts = { taken: 0, missed: 0, skipped: 0, pending: 0, snoozed: 0 };
    const hours = {};
    for (const log of logs) {
      counts[log.status]++;
      const hour = formatter.format(log.scheduledDatetime);
      hours[hour] ||= { taken: 0, missed: 0, skipped: 0, pending: 0, snoozed: 0 };
      hours[hour][log.status]++;
    }
    const insightText = await generateText('Write one short line about the recorded dose-taking behavior over the last seven days. Use only these counts. Pending, snoozed and skipped are not missed. Do not infer causes, diagnoses, interactions or treatment changes. A gentle reminder habit is allowed. No bullet lists.', { days: 7, total: logs.length, counts, localHourCounts: hours }, { oneLine: true });
    // Network call is outside the transaction. Recheck under Serializable to
    // prevent duplicates even when several server processes generate at once.
    return inventoryTransaction(async (db) => {
      const existing = await db.aiInsight.findFirst({ where, orderBy: { id: 'asc' } });
      if (existing) return { status: 'cached', insight: existing };
      return { status: 'created', insight: await db.aiInsight.create({ data: { patientId, insightType: 'adherence_pattern', insightText, generatedAt: now } }) };
    });
  };
  const promise = work();
  pending.set(key, promise);
  try { return await promise; } finally { pending.delete(key); }
}
