import prisma from '../prismaClient.js';
import { HttpError } from '../services/authErrors.js';
import { recordAudit } from '../services/audit.service.js';

const allowed = {
  view_only: ['view_only', 'full_access'],
  alerts_only: ['alerts_only', 'full_access'],
  full_access: ['full_access'],
};

// Run after verifyJWT. Resource controllers must use this same patientId when
// querying data: never authorize a supplied patientId then fetch an unrelated id.
// Routes use :patientId, or set req.patientId from a server-side resource lookup.
export default function checkPermission(requiredLevel) {
  if (!Object.hasOwn(allowed, requiredLevel)) throw new TypeError('Invalid required permission level.');
  return async (req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Authentication required.');
    const target = req.patientId ?? req.params.patientId;
    const patientId = Number(target);
    if (!/^[1-9]\d*$/.test(String(target)) || !Number.isSafeInteger(patientId)) {
      throw new HttpError(400, 'A valid patientId is required.');
    }
    req.patientId = patientId;
    if (patientId === req.user.id) return next();
    const link = await prisma.caregiverPatientLink.findFirst({
      where: { patientId, caregiverId: req.user.id, status: 'active',
        permissionLevel: { in: allowed[requiredLevel] } },
      orderBy: { id: 'asc' },
    });
    if (!link) throw new HttpError(403, `Insufficient permission: ${requiredLevel} required.`);
    req.caregiverPatientLink = link;
    // Aggregated feeds pass a small scoped request; res.req retains the real
    // HTTP route/method, including for each patient in those feeds.
    const source = req.method ? req : res.req || req;
    if (['GET', 'HEAD'].includes(source.method)) {
      const base = source.baseUrl || '/permission-check';
      const route = base + (typeof source.route?.path === 'string' ? source.route.path : '');
      // Inventory/schedules mount at /api, so baseUrl alone would merge them.
      // Aggregate caregiver endpoints also have distinct polling groups.
      const routeGroup = /\/inventory(?:\/|$)/.test(route) ? '/api/inventory'
        : /\/schedules(?:\/|$)/.test(route) ? '/api/schedules'
          : base === '/api/caregiver' ? route : base;
      await recordAudit({ actorUserId: req.user.id, actionType: 'caregiver_read', subjectPatientId: patientId,
        details: { route, routeGroup, method: source.method, patientId, permissionLevel: link.permissionLevel } });
    }
    next();
  };
}
