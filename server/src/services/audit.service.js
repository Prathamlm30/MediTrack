import prisma from '../prismaClient.js';

export const CAREGIVER_READ_THROTTLE_MS = 10 * 60 * 1000;
const metadataKeys = ['route', 'routeGroup', 'method', 'patientId', 'permissionLevel',
  'previousPermissionLevel', 'newPermissionLevel', 'previousStatus', 'newStatus'];

// Only explicitly allowed scalar metadata crosses this boundary, never a request.
export async function recordAudit({ actorUserId, actionType, subjectPatientId, details = {}, entityId }, { tx } = {}) {
  const db = tx || prisma;
  try {
    const metadata = Object.fromEntries(metadataKeys.filter((key) =>
      ['string', 'number'].includes(typeof details[key])).map((key) => [key, details[key]]));
    if (actionType === 'caregiver_read') {
      const configured = Number(process.env.CAREGIVER_READ_THROTTLE_MS);
      const windowMs = Number.isFinite(configured) && configured >= 0 && process.env.CAREGIVER_READ_THROTTLE_MS
        ? configured : CAREGIVER_READ_THROTTLE_MS;
      const last = await db.auditLog.findFirst({ where: {
        userId: actorUserId, subjectPatientId, actionType,
        details: { path: ['routeGroup'], equals: metadata.routeGroup },
      }, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }] });
      if (last && Date.now() - last.timestamp.getTime() < windowMs) return null;
      // DB-based throttling works across processes. Concurrent duplicates are
      // acceptable: this lookup and insert intentionally do not serialize reads.
    }
    return await db.auditLog.create({ data: {
      userId: actorUserId, actionType, subjectPatientId: subjectPatientId ?? null,
      entityType: actionType === 'permission_change' ? 'CaregiverPatientLink' : subjectPatientId ? 'User' : 'Session',
      entityId: entityId ?? subjectPatientId ?? actorUserId, details: metadata,
      // ipAddress is deliberately not collected.
    } });
  } catch (error) {
    if (tx) throw error; // Permission changes must roll back with their audit.
    console.error('Audit write failed:', actionType, error.code || error.name);
    return null; // Login and caregiver reads remain available if auditing fails.
  }
}
