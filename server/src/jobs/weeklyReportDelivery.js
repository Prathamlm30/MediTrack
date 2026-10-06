import nodemailer from 'nodemailer';
import prisma from '../prismaClient.js';
import { requiredEnv } from '../config/env.js';

let transporter;

// Caller must recheck the recipient's current permission before invoking this.
export async function deliverWeeklyReport(report, caregiver) {
  const channel = caregiver.preferences?.preferredNotificationChannel || 'in_app';
  const title = `Weekly adherence summary for patient ${report.patientId}`;
  try {
    if (channel === 'in_app') {
      // Persisting the inbox message and successful delivery is one operation.
      return await prisma.$transaction(async (tx) => {
        await tx.notification.create({ data: { userId: caregiver.id, notificationType: 'weekly_summary',
          relatedPatientId: report.patientId, channel, title, message: report.summaryText, status: 'sent' } });
        return tx.weeklySummaryReport.update({ where: { id: report.id }, data: { sentStatus: 'sent', sentAt: new Date() } });
      });
    }
    if (channel !== 'email') throw new Error(`Weekly report delivery channel ${channel} is not configured.`);
    transporter ??= nodemailer.createTransport({
      host: requiredEnv('SMTP_HOST'), port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: requiredEnv('SMTP_PASS') } } : {}),
    });
    const delivery = await transporter.sendMail({ from: requiredEnv('MAIL_FROM'), to: caregiver.email,
      subject: title, text: report.summaryText });
    if (!delivery.accepted?.length) throw new Error('SMTP did not accept the weekly report recipient.');
    return await prisma.weeklySummaryReport.update({ where: { id: report.id }, data: { sentStatus: 'sent', sentAt: new Date() } });
  } catch (error) {
    await prisma.weeklySummaryReport.update({ where: { id: report.id }, data: { sentStatus: 'failed', sentAt: null } });
    throw error;
  }
}
