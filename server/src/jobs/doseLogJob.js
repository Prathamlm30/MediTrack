import prisma from '../prismaClient.js';
import { inventoryTransaction } from '../services/inventory.service.js';
import { dateKey, patientDate, timezoneFor, localDatetime } from './adherenceCalendar.js';
import { startLocalJob, runCli } from './phase7Runtime.js';

export async function runDoseLogJob({ now = new Date(), patientId, date } = {}) {
  if (date !== undefined) dateKey(date);
  const schedules = await prisma.medicationSchedule.findMany({ where: { isActive: true, medication: { status: 'active', ...(patientId !== undefined && { patientId }) } }, select: { id: true } });
  const result = { created: 0, existing: 0, errors: [] };
  for (const { id } of schedules) {
    try {
      const outcome = await inventoryTransaction(async (tx) => {
        const schedule = await tx.medicationSchedule.findUnique({ where: { id }, include: { medication: { include: { patient: { include: { preferences: true } } } } } });
        if (!schedule?.isActive || schedule.medication.status !== 'active') return 'ignored';
        const medication = schedule.medication;
        const timezone = timezoneFor(medication.patient);
        const today = date ?? patientDate(now, timezone);
        if (medication.startDate.toISOString().slice(0, 10) > today || (medication.endDate && medication.endDate.toISOString().slice(0, 10) < today)) return 'ignored';
        if (!schedule.daysOfWeek.split(',').includes(String(new Date(today).getUTCDay()))) return 'ignored';
        if (schedule.isTaperSchedule && !schedule.taperDetails?.some((step) => step.fromDate <= today && step.toDate >= today)) return 'ignored';
        const scheduledDatetime = localDatetime(today, schedule.timeOfDay.toISOString().slice(11, 19), timezone);
        // Serializable predicate reads also protect concurrent runs: schema has no unique key.
        if (await tx.doseLog.findFirst({ where: { scheduleId: id, scheduledDatetime } })) return 'existing';
        await tx.doseLog.create({ data: { scheduleId: id, patientId: medication.patientId, scheduledDatetime, status: 'pending' } });
        return 'created';
      });
      if (outcome !== 'ignored') result[outcome]++;
    } catch (error) { result.errors.push({ scheduleId: id, error: error.code || error.message }); }
  }
  return result;
}
export const startDoseLogJob = () => startLocalJob('doseLogJob', 0, runDoseLogJob);
await runCli(import.meta.url, runDoseLogJob);
