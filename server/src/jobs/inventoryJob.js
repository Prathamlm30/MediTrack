import cron from 'node-cron';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import { inventoryTransaction } from '../services/inventory.service.js';
import { days, decimal } from '../routes/schedules/validation.js';

export function patientDate(now, timezone = 'UTC') {
  let formatter;
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try { formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: timezone || 'UTC' }); }
  catch { formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }); }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Average across all seven weekdays. Each schedule dose is already in inventory
// units. Tapers use only today's step, held constant for this estimate.
export function dailyUsage(schedules, today) {
  return schedules.filter((row) => row.isActive).reduce((usage, row) => {
    const amount = row.isTaperSchedule
      ? row.taperDetails?.find((step) => step.fromDate <= today && step.toDate >= today)?.doseAmount
      : row.doseAmount;
    if (amount === undefined) return usage; // Outside the taper's active steps.
    const dose = decimal(String(amount), 'schedule doseAmount');
    return usage.plus(new Prisma.Decimal(dose).times(days(row.daysOfWeek).split(',').length).div(7));
  }, new Prisma.Decimal(0));
}

export async function runInventoryJob({ now = new Date(), patientId } = {}) {
  const inventories = await prisma.medicineInventory.findMany({ where: {
    ...(patientId !== undefined && { patientId }), medication: { status: 'active' },
  }, select: { id: true } });
  const result = { processed: 0, notificationsCreated: 0, errors: [] };
  for (const { id } of inventories) {
    try {
      const created = await inventoryTransaction(async (tx) => {
        const row = await tx.medicineInventory.findUnique({ where: { id }, include: {
          medication: { include: { schedules: { where: { isActive: true } } } },
          patient: { include: { preferences: true } },
        } });
        if (!row || row.medication.status !== 'active' || row.patientId !== row.medication.patientId) return null;
        const today = patientDate(now, row.patient.preferences?.timezone || row.patient.timezone || 'UTC');
        const started = row.medication.startDate.toISOString().slice(0, 10) <= today;
        const ended = row.medication.endDate && row.medication.endDate.toISOString().slice(0, 10) < today;
        if (!started || ended) {
          await tx.medicineInventory.update({ where: { id }, data: { estimatedRunoutDate: null } });
          return null;
        }
        const usage = dailyUsage(row.medication.schedules, today);
        const estimatedRunoutDate = row.quantityRemaining.lte(0) ? now : usage.gt(0)
          ? new Date(now.getTime() + row.quantityRemaining.div(usage).times(86400000).toNumber()) : null;
        await tx.medicineInventory.update({ where: { id }, data: { estimatedRunoutDate } });
        if (!row.quantityRemaining.lt(row.refillThreshold)) return false;
        const title = `Refill needed: medication #${row.medicationId}`;
        // Schema has no notification medicationId/dedup key. A stable title plus
        // the patient's local date prevents duplicate notices on manual reruns.
        const last = await tx.notification.findFirst({ where: { userId: row.patientId, notificationType: 'refill', channel: 'in_app', title }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }] });
        if (last && patientDate(last.sentAt, row.patient.preferences?.timezone || row.patient.timezone || 'UTC') === today) return false;
        await tx.notification.create({ data: {
          userId: row.patientId, notificationType: 'refill', channel: 'in_app', title,
          message: `${row.medication.medicineName}: ${row.quantityRemaining} ${row.quantityUnit} remaining, below the refill threshold of ${row.refillThreshold}. Refill amount: ${row.refillAmount} ${row.quantityUnit}.`,
          status: 'sent', sentAt: now,
        } });
        return true;
      });
      if (created !== null) result.processed++;
      if (created) result.notificationsCreated++;
    } catch (error) {
      result.errors.push({ inventoryId: id, error: error.code || error.message });
    }
  }
  return result;
}

export function startInventoryJob() {
  return cron.schedule('0 6 * * *', async () => {
    try { console.log('Inventory job:', await runInventoryJob()); }
    catch (error) { console.error('Inventory job failed:', error.code || error.name); }
  }, { timezone: 'UTC', noOverlap: true, name: 'inventoryJob' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argument = process.argv[2];
    if (argument !== undefined && !/^[1-9]\d*$/.test(argument)) throw new Error('Optional argument must be a patient ID.');
    const result = await runInventoryJob({ ...(argument && { patientId: Number(argument) }) });
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error('Inventory job failed:', error.code || error.message);
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
