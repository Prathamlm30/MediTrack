import '../../config/env.js';
import { HttpError } from '../../services/authErrors.js';

export function validateGracePeriodMinutes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.001 || value > 1440) {
    throw new HttpError(400, 'gracePeriodMinutes must be a number from 0.001 to 1440.');
  }
  return value;
}

export function getGracePeriodMinutes() {
  return validateGracePeriodMinutes(Number(process.env.ESCALATION_GRACE_PERIOD_MINUTES ?? 30));
}

export function getSettings() {
  return { gracePeriodMinutes: getGracePeriodMinutes(),
    caregiverPermissionLevels: ['full_access', 'alerts_only'], scope: 'global',
    editable: process.env.NODE_ENV !== 'production',
    persistence: process.env.NODE_ENV === 'production' ? 'environment' : 'process_until_restart' };
}
