import prisma from '../prismaClient.js';
import { inventoryTransaction } from '../services/inventory.service.js';
import { dateKey, patientDate, timezoneFor, localDatetime } from './adherenceCalendar.js';
import { startCatchUpJob, runCli } from './phase7Runtime.js';

// Shared by the scheduler and schedule writes, inside a serializable transaction.
export async function ensureScheduleDoseLog(tx, id, { now = new Date(), date, remainingOnly = false } = {}) {
  const schedule = await tx.medicationSchedule.findUnique({ where: { id }, include: { medication: { include: { patient: { include: { preferences: true } } } } } });
  if (!schedule?.isActive || schedule.medication.status !== 'active' || !schedule.medication.patient.isActive) return 'ignored';
  const medication = schedule.medication;
  const timezone = timezoneFor(medication.patient);
  const today = date ?? patientDate(now, timezone);
  if (medication.startDate.toISOString().slice(0, 10) > today || (medication.endDate && medication.endDate.toISOString().slice(0, 10) < today)) return 'ignored';
  if (!schedule.daysOfWeek.split(',').includes(String(new Date(today).getUTCDay()))) return 'ignored';
  if (schedule.isTaperSchedule && !schedule.taperDetails?.some((step) => step.fromDate <= today && step.toDate >= today)) return 'ignored';
  const scheduledDatetime = localDatetime(today, schedule.timeOfDay.toISOString().slice(11, 19), timezone);
  if (scheduledDatetime < schedule.createdAt || (remainingOnly && scheduledDatetime < now)) return 'ignored';
  // Serializable predicate reads protect concurrent processes without a schema change.
  if (await tx.doseLog.findFirst({ where: { scheduleId: id, scheduledDatetime } })) return 'existing';
  const row = await tx.doseLog.create({ data: { scheduleId: id, patientId: medication.patientId, scheduledDatetime, status: 'pending' },
    select: { id: true, patientId: true } });
  return { status: 'created', ...row };
}

export async function runDoseLogJob({ now = new Date(), patientId, date, runtime } = {}) {
  if (date !== undefined) dateKey(date);
  const schedules = await prisma.medicationSchedule.findMany({ where: { isActive: true, medication: { status: 'active', ...(patientId !== undefined && { patientId }) } }, select: { id: true } });
  const result = { created: 0, existing: 0, errors: [] };
  const changedPatients = new Map();
  for (const { id } of schedules) {
    try {
      const outcome = await inventoryTransaction((tx) => ensureScheduleDoseLog(tx, id, { now, date }));
      if (outcome.status === 'created') {
        result.created++;
        if (!changedPatients.has(outcome.patientId)) changedPatients.set(outcome.patientId, outcome.id);
      } else if (outcome === 'existing') result.existing++;
    } catch (error) { result.errors.push({ scheduleId: id, error: error.code || error.message }); }
  }
  // One invalidation per changed patient per run, only for committed rows.
  // The id identifies one created row; consumers re-fetch the whole resource.
  for (const [patientId, id] of changedPatients) {
    await runtime?.emitDataChanged?.({ patientId, resource: 'dose_log', id, action: 'created' });
  }
  return result;
}
export const startDoseLogJob = (options) => startCatchUpJob('doseLogJob', runDoseLogJob, options);
await runCli(import.meta.url, runDoseLogJob);
