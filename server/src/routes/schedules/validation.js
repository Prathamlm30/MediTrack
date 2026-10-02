import { HttpError } from '../../services/authErrors.js';
import { bodyFields } from '../medications/access.js';

export function decimal(value, name, max = 9999.99, allowZero = false) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) > max || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw new HttpError(400, `${name} must be ${allowZero ? 'nonnegative' : 'positive'}, at most ${max}, with at most two decimals.`);
  }
  return Number(value);
}
export function days(value) {
  if (typeof value !== 'string' || !/^[0-6](,[0-6])*$/.test(value)) throw new HttpError(400, 'daysOfWeek must be comma-separated numbers 0 (Sunday) through 6.');
  const entries = value.split(',');
  if (new Set(entries).size !== entries.length) throw new HttpError(400, 'daysOfWeek cannot contain duplicates.');
  return entries.sort().join(',');
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Taper dates must be real YYYY-MM-DD dates.');
  return value;
}
export function scheduleData(body, old) {
  bodyFields(body, ['timeOfDay', 'daysOfWeek', 'doseAmount', 'isTaperSchedule', 'taperDetails', 'isActive']);
  const merged = { isActive: true, isTaperSchedule: false, ...old, ...body };
  const time = merged.timeOfDay instanceof Date ? merged.timeOfDay.toISOString().slice(11, 16) : merged.timeOfDay;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'timeOfDay must be HH:mm (24-hour local time).');
  for (const key of ['isActive', 'isTaperSchedule']) if (typeof merged[key] !== 'boolean') throw new HttpError(400, `${key} must be boolean.`);
  const data = { timeOfDay: new Date(`1970-01-01T${time}:00.000Z`), daysOfWeek: days(merged.daysOfWeek), doseAmount: decimal(String(merged.doseAmount), 'doseAmount'), isActive: merged.isActive, isTaperSchedule: merged.isTaperSchedule };
  if (data.isTaperSchedule) {
    if (!Array.isArray(merged.taperDetails) || !merged.taperDetails.length || merged.taperDetails.length > 100) throw new HttpError(400, 'A taper requires 1–100 steps.');
    data.taperDetails = merged.taperDetails.map((step) => {
      bodyFields(step, ['fromDate', 'toDate', 'doseAmount']);
      const result = { fromDate: date(step.fromDate), toDate: date(step.toDate), doseAmount: decimal(step.doseAmount, 'taper doseAmount') };
      if (result.toDate < result.fromDate) throw new HttpError(400, 'Taper end must follow its start.');
      return result;
    }).sort((a, b) => a.fromDate.localeCompare(b.fromDate));
    for (let i = 1; i < data.taperDetails.length; i++) if (data.taperDetails[i].fromDate <= data.taperDetails[i - 1].toDate) throw new HttpError(400, 'Taper steps cannot overlap (dates are inclusive).');
  } else if (body.taperDetails != null) throw new HttpError(400, 'taperDetails requires isTaperSchedule: true.');
  return data;
}
