import prisma from '../prismaClient.js';
import { HttpError } from '../services/authErrors.js';
import { patientDate } from './inventoryJob.js';

export { patientDate };
export function dateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Expected a real YYYY-MM-DD date.');
  return value;
}
export const shiftDate = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
export function timezoneFor(patient) {
  const timezone = patient.preferences?.timezone || patient.timezone || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); return timezone; }
  catch { return 'UTC'; }
}
export async function getPatient(patientId) {
  const patient = await prisma.user.findUnique({ where: { id: patientId }, include: { preferences: true } });
  if (!patient) throw new HttpError(404, 'Patient not found.');
  return patient;
}
export function localParts(now, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(({ type, value }) => [type, value]));
}
// Choose the first occurrence of an ambiguous clock time. In a spring gap,
// move forward by the size of the gap, matching ordinary calendar behavior.
export function localDatetime(date, time, timezone) {
  const wall = Date.parse(`${date}T${time}Z`);
  const offsets = new Set([-36, 0, 36].map((hours) => {
    const instant = wall + hours * 3600000;
    const p = localParts(new Date(instant), timezone);
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - instant;
  }));
  const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  const matches = candidates.filter((instant) => {
    const p = localParts(new Date(instant), timezone);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === `${date}T${time}`;
  });
  return new Date(matches[0] ?? candidates.at(-1));
}
export const dayBounds = (date, timezone) => ({ gte: localDatetime(date, '00:00:00', timezone), lt: localDatetime(shiftDate(date, 1), '00:00:00', timezone) });
