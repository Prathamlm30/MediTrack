// Only route groups established by app.js and checkPermission.js are named.
const areas = {
  '/api/dashboard': 'dashboard', '/api/medications': 'medications', '/api/doctors': 'doctors',
  '/api/prescription-scans': 'prescriptions', '/api/schedules': 'schedules', '/api/inventory': 'inventory',
  '/api/dose-logs': 'dose history', '/api/adherence': 'adherence', '/api/escalations': 'alerts',
  '/api/reports': 'weekly reports', '/api/insights': 'insights', '/api/notifications': 'notifications',
  '/api/caregiver/patients': 'linked patient list', '/api/caregiver/alerts-feed': 'alert feed',
};
const levels = { full_access: 'Full access', view_only: 'View only', alerts_only: 'Alerts only' };
const permission = (level, status) => status === 'revoked' ? 'Revoked' : levels[level] || 'Unknown access';
export function activitySentence(row, viewerId, caregiverName) {
  const own = row.actor?.id != null && String(row.actor.id) === String(viewerId);
  const actor = own ? 'You' : row.actor?.fullName || 'Someone';
  const details = row.details || {};
  switch (row.actionType) {
    case 'login_local': return `${actor} signed in with email and password.`;
    case 'login_google': return `${actor} signed in with Google.`;
    case 'caregiver_read':
      return String(row.subjectPatientId) === String(viewerId)
        ? `${actor} viewed your health information (${areas[details.routeGroup] || 'an area of your record'}).`
        : `${actor} viewed a patient's information.`;
    case 'permission_change': return `${actor} changed access${caregiverName ? ` for ${caregiverName}` : ''}: ${permission(details.previousPermissionLevel, details.previousStatus)} to ${permission(details.newPermissionLevel, details.newStatus)}.`;
    default: return 'An account activity was recorded.';
  }
}
