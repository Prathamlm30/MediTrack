import cron from 'node-cron';
import prisma from '../prismaClient.js';
import checkPermission from '../middleware/checkPermission.js';
import { inventoryTransaction } from '../services/inventory.service.js';
import { runCli } from './phase7Runtime.js';
import { collectReportData, generateWeeklySummary, reportWindow } from './weeklyReportData.js';
import { deliverWeeklyReport } from './weeklyReportDelivery.js';

const permission = checkPermission('view_only');
const eligible = { status: 'active', permissionLevel: { in: ['view_only', 'full_access'] },
  patient: { isActive: true }, caregiver: { isActive: true } };

export async function runWeeklyReportJob({ now = new Date(), patientId, caregiverId, date } = {}) {
  const window = reportWindow(now, date);
  const links = await prisma.caregiverPatientLink.findMany({ where: { ...eligible,
    ...(patientId !== undefined && { patientId }), ...(caregiverId !== undefined && { caregiverId }),
  }, orderBy: { id: 'asc' } });
  const result = { window, created: 0, sent: 0, existing: 0, reportIds: [], errors: [] };
  const seen = new Set();
  for (const link of links) {
    const key = `${link.caregiverId}:${link.patientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let report;
    try {
      await permission({ user: { id: link.caregiverId }, params: {}, patientId: link.patientId }, {}, () => {});
      const where = { caregiverId: link.caregiverId, patientId: link.patientId,
        weekStartDate: window.start, weekEndDate: window.end };
      report = await prisma.weeklySummaryReport.findFirst({ where, orderBy: { id: 'asc' } });
      if (!report) {
        const data = await prisma.$transaction((tx) => collectReportData(tx, link.patientId, window), { isolationLevel: 'RepeatableRead' });
        const summaryText = await generateWeeklySummary(data);
        // Serializable predicate reads guard the schema's lack of a unique
        // report key. Gemini/network delivery never runs in a retried transaction.
        const saved = await inventoryTransaction(async (tx) => {
          const existing = await tx.weeklySummaryReport.findFirst({ where, orderBy: { id: 'asc' } });
          if (existing) return { report: existing, created: false };
          if (!await tx.caregiverPatientLink.findFirst({ where: { ...eligible,
            patientId: link.patientId, caregiverId: link.caregiverId } })) throw new Error('Report permission was revoked during generation.');
          const current = await collectReportData(tx, link.patientId, window);
          if (JSON.stringify(current) !== JSON.stringify(data)) throw new Error('Report source data changed during generation; retry the job.');
          return { report: await tx.weeklySummaryReport.create({ data: { ...where, summaryText } }), created: true };
        });
        report = saved.report;
        if (saved.created) result.created++;
        else { result.existing++; result.reportIds.push(report.id); continue; }
      } else {
        result.existing++;
        // Only one runner may claim a failed delivery. Pending may mean another
        // runner is sending, so never automatically resend an uncertain attempt.
        if (report.sentStatus !== 'failed' || !(await prisma.weeklySummaryReport.updateMany({
          where: { id: report.id, sentStatus: 'failed' }, data: { sentStatus: 'pending' },
        })).count) { result.reportIds.push(report.id); continue; }
      }
      result.reportIds.push(report.id);
      await permission({ user: { id: link.caregiverId }, params: {}, patientId: link.patientId }, {}, () => {});
      if (!await prisma.caregiverPatientLink.findFirst({ where: { ...eligible,
        patientId: link.patientId, caregiverId: link.caregiverId } })) throw new Error('Report recipient is no longer eligible.');
      const caregiver = await prisma.user.findUniqueOrThrow({ where: { id: link.caregiverId }, include: { preferences: true } });
      await deliverWeeklyReport(report, caregiver);
      result.sent++;
    } catch (error) {
      if (report) await prisma.weeklySummaryReport.updateMany({ where: { id: report.id, sentStatus: 'pending' }, data: { sentStatus: 'failed', sentAt: null } });
      result.errors.push({ patientId: link.patientId, caregiverId: link.caregiverId,
        ...(report && { reportId: report.id }), error: error.code || error.message });
    }
  }
  return result;
}

export function startWeeklyReportJob({ schedule = '0 23 * * 0', patientId, caregiverId } = {}) {
  let active;
  const job = cron.schedule(schedule, () => {
    active = runWeeklyReportJob({ patientId, caregiverId })
      .then((result) => console.log('Weekly report job:', result))
      .catch((error) => console.error('Weekly report job failed:', error.code || error.message));
    return active;
  }, { timezone: 'UTC', noOverlap: true, name: 'weeklyReportJob' });
  return { async destroy() { await job.destroy(); await active; } };
}

await runCli(import.meta.url, runWeeklyReportJob);
