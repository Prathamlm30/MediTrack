import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import prisma from '../../prismaClient.js';
import { deliverWeeklyReport } from '../../jobs/weeklyReportDelivery.js';

test('SMTP acceptance marks sent; rejected recipients mark failed without a success timestamp', async () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'MAIL_FROM'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const users = [], messages = [], connections = new Set();
  let rejectRecipient = false;
  const smtp = createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    let buffer = '', body = null;
    socket.write('220 localhost test SMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (body !== null) {
          if (line === '.') { messages.push(body); body = null; socket.write('250 accepted\r\n'); }
          else body += `${line}\r\n`;
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250 localhost\r\n');
        else if (/^RCPT/.test(line) && rejectRecipient) socket.write('550 rejected\r\n');
        else if (line === 'DATA') { body = ''; socket.write('354 send data\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  try {
    await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port),
      SMTP_SECURE: 'false', MAIL_FROM: 'meditrack@example.test' });
    delete process.env.SMTP_USER;
    for (const fullName of ['Email test patient', 'Email test caregiver']) {
      users.push(await prisma.user.create({ data: { fullName, email: `phase9-email-${randomUUID()}@example.test` } }));
    }
    const [patient, caregiver] = users;
    caregiver.preferences = { preferredNotificationChannel: 'email' };
    const report = await prisma.weeklySummaryReport.create({ data: { caregiverId: caregiver.id, patientId: patient.id,
      weekStartDate: new Date('2026-09-20T23:00:00Z'), weekEndDate: new Date('2026-09-27T23:00:00Z'),
      summaryText: 'The patient missed 2 doses during this week.' } });
    const sent = await deliverWeeklyReport(report, caregiver);
    assert.equal(sent.sentStatus, 'sent'); assert.ok(sent.sentAt);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].includes(report.summaryText));
    assert.ok(messages[0].includes(caregiver.email));
    rejectRecipient = true;
    await assert.rejects(deliverWeeklyReport(report, caregiver));
    const failed = await prisma.weeklySummaryReport.findUnique({ where: { id: report.id } });
    assert.equal(failed.sentStatus, 'failed'); assert.equal(failed.sentAt, null);
    assert.equal(messages.length, 1);
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => smtp.close(resolve));
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    const ids = users.map((user) => user.id);
    await prisma.weeklySummaryReport.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
