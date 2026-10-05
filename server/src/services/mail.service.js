import nodemailer from 'nodemailer';
import { requiredEnv } from '../config/env.js';

let transporter;
export async function sendMail(message) {
  transporter ??= nodemailer.createTransport({
    host: requiredEnv('SMTP_HOST'), port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: requiredEnv('SMTP_PASS') } } : {}),
  });
  const result = await transporter.sendMail({ from: requiredEnv('MAIL_FROM'), ...message });
  if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP did not accept the recipient.');
  return result;
}
export async function sendActionEmail(user, kind, token) {
  const base = kind === 'verify' ? (process.env.API_ORIGIN || 'http://localhost:3000') : (process.env.CLIENT_ORIGIN || 'http://localhost:5173');
  const link = kind === 'verify' ? `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/verify-email/${token}` : `${base}/reset-password?token=${token}`;
  await sendMail({ to: user.email,
    subject: kind === 'verify' ? 'Verify your MediTrack email' : 'Reset your MediTrack password',
    text: `${kind === 'verify' ? 'Verify your email (expires in 24 hours)' : 'Reset your password (expires in 15 minutes)'}: ${link}` });
}
