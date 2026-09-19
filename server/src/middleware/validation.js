import { HttpError } from '../services/authErrors.js';
export function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'A JSON object is required.');
  return req.body;
}
export function text(value, field, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `Invalid ${field}.`);
  return value.trim();
}
export function email(value) {
  const result = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'Invalid email.');
  return result;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value) > 72) throw new HttpError(400, 'Password must contain at least 8 characters and at most 72 UTF-8 bytes.');
  return value;
}
export function profile(data) {
  const result = {};
  for (const key of Object.keys(data)) {
    if (!['fullName', 'phoneNumber', 'address', 'profilePictureUrl'].includes(key)) throw new HttpError(400, `Field ${key} cannot be edited.`);
    result[key] = data[key] === null && key !== 'fullName' ? null : text(data[key], key, key === 'profilePictureUrl' ? 2048 : 255);
    if (key === 'profilePictureUrl' && result[key] !== null) {
      try { if (!['http:', 'https:'].includes(new URL(result[key]).protocol)) throw new Error(); }
      catch { throw new HttpError(400, 'Invalid profilePictureUrl.'); }
    }
  }
  return result;
}
export function preferences(data) {
  const result = {};
  for (const key of Object.keys(data)) {
    if (!['preferredNotificationChannel', 'language', 'theme', 'timezone'].includes(key)) throw new HttpError(400, `Unknown preference ${key}.`);
    result[key] = key === 'timezone' && data[key] === null ? null : text(data[key], key, 100);
  }
  if (result.theme && !['light', 'dark'].includes(result.theme)) throw new HttpError(400, 'Invalid theme.');
  if (result.preferredNotificationChannel && !['email', 'push', 'sms', 'in_app'].includes(result.preferredNotificationChannel)) throw new HttpError(400, 'Invalid notification channel.');
  if (result.timezone) {
    try { new Intl.DateTimeFormat('en', { timeZone: result.timezone }); }
    catch { throw new HttpError(400, 'Invalid timezone.'); }
  }
  return result;
}
