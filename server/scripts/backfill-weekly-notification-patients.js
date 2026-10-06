import { pathToFileURL } from 'node:url';
import prisma from '../src/prismaClient.js';

// Conservative, repeatable best effort: a delivery timestamp within one minute
// (generation timestamp for legacy unsent rows), plus identical stored summary.
// Ambiguous patients stay null and therefore hidden. Never parse display text.
export async function backfillWeeklyNotificationPatients(userId) {
  const rows = await prisma.notification.findMany({ where: {
    notificationType: 'weekly_summary', relatedPatientId: null,
    ...(userId === undefined ? {} : { userId }),
  }, select: { id: true, userId: true, sentAt: true, message: true } });
  let updated = 0;
  for (const row of rows) {
    const window = { gte: new Date(row.sentAt.getTime() - 60000), lte: new Date(row.sentAt.getTime() + 60000) };
    const reports = await prisma.weeklySummaryReport.findMany({ where: {
      caregiverId: row.userId, summaryText: row.message,
      OR: [{ sentAt: window }, { sentAt: null, generatedAt: window }],
    }, select: { patientId: true } });
    const patients = [...new Set(reports.map((report) => report.patientId))];
    if (patients.length !== 1) continue;
    const result = await prisma.notification.updateMany({ where: { id: row.id, relatedPatientId: null },
      data: { relatedPatientId: patients[0] } });
    updated += result.count;
  }
  return { examined: rows.length, updated, unresolved: rows.length - updated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await backfillWeeklyNotificationPatients()); }
  finally { await prisma.$disconnect(); }
}
