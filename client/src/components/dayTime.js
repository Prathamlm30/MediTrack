// All dashboard calendar calculations use the response's patient timezone.
export const patientZone = (timezone) => timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
export function formatDate(value, timezone, options) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: patientZone(timezone) }).format(new Date(value));
}
export function dayMinute(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: patientZone(timezone), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return Number(fields.hour) * 60 + Number(fields.minute);
}
export function dayNumber(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: patientZone(timezone), year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  // Convert local calendar fields to a day ordinal; elapsed hours fail across DST.
  return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day)) / 86400000;
}
export const dosePeriod = (minute) => minute >= 300 && minute < 720 ? 'morning' : minute >= 720 && minute < 1020 ? 'midday' : minute >= 1020 && minute < 1260 ? 'evening' : 'night';
export const quantity = (value) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value));
