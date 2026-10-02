import { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import { inventoryTransaction } from '../services/inventory.service.js';
import { dateKey, patientDate, timezoneFor, dayBounds, shiftDate } from './adherenceCalendar.js';
import { startLocalJob, runCli } from './phase7Runtime.js';
import { HttpError } from '../services/authErrors.js';

export const percentage = (taken, total) => total ? new Prisma.Decimal(taken).times(100).div(total).toDecimalPlaces(2) : new Prisma.Decimal(0);

async function saveStat(tx, patientId, periodType, date, end, counts, now) {
  const where = { patientId, periodType, periodStartDate: new Date(date) };
  const old = await tx.adherenceStat.findFirst({ where });
  const data = { ...where, periodEndDate: new Date(end), ...counts, adherencePercentage: percentage(counts.takenCount, counts.totalScheduledDoses), generatedAt: now };
  if (old) return tx.adherenceStat.update({ where: { id: old.id }, data });
  return tx.adherenceStat.create({ data });
}

// One patient/day only. Passing tx makes status, inventory and daily stats atomic.
export async function recomputeDailyStats(patientId, date, { tx, now = new Date(), patient } = {}) {
  dateKey(date);
  const recompute = async (client) => {
    const owner = patient ?? await client.user.findUnique({ where: { id: patientId }, include: { preferences: true } });
    if (!owner) throw new HttpError(404, 'Patient not found.');
    const timezone = timezoneFor(owner);
    const today = patientDate(now, timezone);
    const rows = await client.doseLog.findMany({ where: { patientId, schedule: { medication: { patientId } }, scheduledDatetime: dayBounds(date, timezone) }, select: { status: true } });
    const counts = { totalScheduledDoses: rows.length, takenCount: 0, missedCount: 0, skippedCount: 0 };
    for (const row of rows) {
      if (row.status === 'taken') counts.takenCount++;
      else if (row.status === 'skipped') counts.skippedCount++;
      else if (row.status === 'missed' || date < today) counts.missedCount++;
    }
    return saveStat(client, patientId, 'daily', date, date, counts, now);
  };
  return tx ? recompute(tx) : inventoryTransaction(recompute);
}

export async function runAdherenceJob({ now = new Date(), patientId, date, weekly = false } = {}) {
  if (date !== undefined) dateKey(date);
  const patients = await prisma.user.findMany({ where: { ...(patientId !== undefined ? { id: patientId } : { doseLogsPatient: { some: {} } }) }, include: { preferences: true } });
  const result = { processed: 0, errors: [] };
  for (const patient of patients) {
    try {
      const timezone = timezoneFor(patient);
      const today = patientDate(now, timezone);
      let target = date ?? shiftDate(today, -1);
      if (weekly) {
        // Manual date chooses its containing Monday-Sunday week; cron rolls the completed week.
        target = date === undefined
          ? shiftDate(today, -((new Date(today).getUTCDay() + 6) % 7) - 7)
          : shiftDate(target, -((new Date(target).getUTCDay() + 6) % 7));
      }
      await inventoryTransaction(async (tx) => {
        if (!weekly) return recomputeDailyStats(patient.id, target, { tx, now, patient });
        const counts = { totalScheduledDoses: 0, takenCount: 0, missedCount: 0, skippedCount: 0 };
        const rows = await tx.adherenceStat.findMany({ where: { patientId: patient.id, periodType: 'daily', periodStartDate: { gte: new Date(target), lt: new Date(shiftDate(target, 7)) } } });
        for (const row of rows) for (const key of Object.keys(counts)) counts[key] += row[key];
        // Daily/weekly dates are inclusive calendar labels stored at UTC midnight.
        await saveStat(tx, patient.id, weekly ? 'weekly' : 'daily', target, weekly ? shiftDate(target, 6) : target, counts, now);
      });
      result.processed++;
    } catch (error) { result.errors.push({ patientId: patient.id, error: error.code || error.message }); }
  }
  return result;
}
export const startAdherenceJob = () => startLocalJob('adherenceJob', 5, runAdherenceJob);
await runCli(import.meta.url, runAdherenceJob);
