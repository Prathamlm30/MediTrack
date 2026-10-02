import cron from 'node-cron';
import prisma from '../prismaClient.js';
import { inventoryTransaction } from '../services/inventory.service.js';
import { getGracePeriodMinutes } from '../routes/escalation-settings/config.js';

// The canonical schema has no escalation unique key. Serializable predicate
// reads + retries protect dose/level/recipient across processes, not just ticks.
export async function runEscalationJob({ now = new Date(), patientId, runtime } = {}) {
  const graceMs = getGracePeriodMinutes() * 60000;
  const cutoff = new Date(now.getTime() - graceMs);
  const doses = await prisma.doseLog.findMany({ where: {
    status: 'pending', scheduledDatetime: { lte: cutoff },
    ...(patientId !== undefined && { patientId }),
  }, select: { id: true }, orderBy: { id: 'asc' } });
  const result = { level1Created: 0, level2Created: 0, notificationsCreated: 0, errors: [] };
  for (const { id } of doses) {
    try {
      const deliveries = await inventoryTransaction(async (tx) => {
        const dose = await tx.doseLog.findUnique({ where: { id }, include: {
          escalationAlerts: true, schedule: { include: { medication: true } }, patient: true,
        } });
        if (!dose || dose.status !== 'pending' || dose.scheduledDatetime > cutoff ||
            !dose.patient.isActive || dose.schedule.medication.patientId !== dose.patientId) return [];
        const alerts = dose.escalationAlerts;
        const level1 = alerts.find((alert) => alert.escalationLevel === 1);
        const payload = { patientId: dose.patientId, medicineName: dose.schedule.medication.medicineName,
          scheduledDatetime: dose.scheduledDatetime.toISOString() };
        const deliveries = [];
        async function create(escalationLevel, caregiverId) {
          const alert = await tx.escalationAlert.create({ data: {
            doseLogId: id, patientId: dose.patientId, caregiverId, escalationLevel, triggeredAt: now,
          } });
          const notification = await tx.notification.create({ data: {
            userId: caregiverId ?? dose.patientId, relatedDoseLogId: id,
            notificationType: escalationLevel === 1 ? 'reminder' : 'escalation',
            channel: escalationLevel === 1 ? 'push' : 'in_app',
            title: escalationLevel === 1 ? 'Dose reminder' : 'Missed dose alert',
            message: `${payload.medicineName}: dose scheduled for ${payload.scheduledDatetime} is still pending.`,
            status: 'sent', sentAt: now,
          } });
          deliveries.push({ alert, notification, payload });
        }
        if (!level1) {
          // Do not restart an existing chain, even if its alerts were resolved.
          if (!alerts.length) await create(1, null);
          return deliveries;
        }
        // Give the patient a full second window from the actual re-reminder.
        if (level1.resolutionStatus !== 'open' || level1.resolvedAt ||
            level1.triggeredAt.getTime() + graceMs > now.getTime()) return [];
        const links = await tx.caregiverPatientLink.findMany({ where: {
          patientId: dose.patientId, status: 'active',
          permissionLevel: { in: ['full_access', 'alerts_only'] }, caregiver: { isActive: true },
        }, select: { caregiverId: true }, orderBy: { caregiverId: 'asc' } });
        for (const caregiverId of new Set(links.map((link) => link.caregiverId))) {
          // All historical rows count, so resolving an alert cannot recreate it.
          if (!alerts.some((alert) => alert.escalationLevel === 2 && alert.caregiverId === caregiverId)) {
            await create(2, caregiverId);
          }
        }
        return deliveries;
      });
      for (const { alert, notification, payload } of deliveries) {
        result[alert.escalationLevel === 1 ? 'level1Created' : 'level2Created']++;
        result.notificationsCreated++;
        // Socket sends are deliberately outside the retried transaction.
        try {
          if (alert.escalationLevel === 1) await runtime?.emitDoseReminder(alert.patientId, { ...payload, notificationId: notification.id });
          else await runtime?.emitMissedDoseAlert(alert.caregiverId, payload);
        } catch (error) {
          // A failed send must not prevent delivery to the other recipients.
          result.errors.push({ doseLogId: id, notificationId: notification.id, error: error.code || error.message });
        }
      }
    } catch (error) { result.errors.push({ doseLogId: id, error: error.code || error.message }); }
  }
  return result;
}

export function startEscalationJob(runtime, { schedule = '*/2 * * * *', patientId } = {}) {
  // Validate config at startup rather than discovering a typo at the first tick.
  getGracePeriodMinutes();
  let active;
  const job = cron.schedule(schedule, () => {
    active = runEscalationJob({ runtime, patientId })
      .then((result) => console.log('Escalation job:', result))
      .catch((error) => console.error('Escalation job failed:', error.code || error.message));
    return active;
  }, { timezone: 'UTC', noOverlap: true, name: 'escalationJob' });
  return { async destroy() { await job.destroy(); await active; } };
}
