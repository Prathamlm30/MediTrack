import cron from 'node-cron';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import prisma from '../prismaClient.js';
import { dateKey, localParts, timezoneFor, patientDate } from './adherenceCalendar.js';

// Run immediately on startup and every minute; share an in-flight run so startup
// cannot overlap a tick. The generator resolves each patient's current local day.
export function startCatchUpJob(name, run, { schedule = '* * * * *', ...options } = {}) {
  let active;
  let stopped = false;
  const tick = () => {
    if (stopped) return Promise.resolve();
    if (!active) active = Promise.resolve().then(() => run(options))
      .then((result) => { console.log(`${name}:`, result); return result; })
      .catch((error) => { console.error(`${name} failed:`, error.code || error.message); })
      .finally(() => { active = undefined; });
    return active;
  };
  const job = cron.schedule(schedule, tick, { timezone: 'UTC', noOverlap: true, name });
  const ready = tick();
  return { ready, tick, async destroy() { stopped = true; await job.destroy(); await active; } };
}

export function startLocalJob(name, minute, run, mondayOnly = false) {
  return cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const patients = await prisma.user.findMany({ where: { OR: [{ medications: { some: {} } }, { doseLogsPatient: { some: {} } }] }, include: { preferences: true } });
      for (const patient of patients) {
        const timezone = timezoneFor(patient);
        const parts = localParts(now, timezone);
        if (parts.hour !== '00' || Number(parts.minute) !== minute) continue;
        if (mondayOnly && new Date(patientDate(now, timezone)).getUTCDay() !== 1) continue;
        console.log(`${name}:`, await run({ now, patientId: patient.id }));
      }
    } catch (error) { console.error(`${name} failed:`, error.code || error.message); }
  }, { timezone: 'UTC', noOverlap: true, name });
}

export async function runCli(url, run) {
  if (!process.argv[1] || url !== pathToFileURL(resolve(process.argv[1])).href) return;
  try {
    const [patientId, date, extra] = process.argv.slice(2);
    if (extra || (patientId !== undefined && (!/^[1-9]\d*$/.test(patientId) || !Number.isSafeInteger(Number(patientId))))) throw new Error('Usage: node <job.js> [patientId] [YYYY-MM-DD]');
    const result = await run({ ...(patientId && { patientId: Number(patientId) }), ...(date && { date: dateKey(date) }) });
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
