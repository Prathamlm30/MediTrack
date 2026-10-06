import { Router } from 'express';
import { NotificationType } from '@prisma/client';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { pagination, positiveId } from './pagination.js';

const router = Router();
const unread = { readAt: null, status: { not: 'read' } };
const alertPermission = checkPermission('alerts_only');
const viewPermission = checkPermission('view_only');
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// A relational predicate applies before pagination/counting, including when the
// cursor row belongs to another user or is no longer visible. Nothing is deleted.
function visibleTo(userId) {
  return { userId, OR: [
    { notificationType: 'weekly_summary', relatedPatient: { patientLinks: { some: {
      caregiverId: userId, status: 'active', permissionLevel: { in: ['full_access', 'view_only'] },
    } } } },
    { notificationType: { not: 'weekly_summary' }, OR: [
    { relatedDoseLogId: null },
    { doseLog: { patientId: userId } },
    { doseLog: { patient: { patientLinks: { some: {
      caregiverId: userId, status: 'active', permissionLevel: { in: ['full_access', 'alerts_only'] },
    } } } } },
    ] },
  ] };
}

/**
 * @openapi
 * /api/notifications:
 *   get:
 *     summary: Read your permission-filtered notification inbox
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: type, schema: { type: string, enum: [reminder, refill, escalation, weekly_summary, system] } }
 *       - { in: query, name: unread, schema: { type: boolean } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: cursor, schema: { type: integer, minimum: 1 } }
 *     description: Descending insertion ID. unreadCount covers the entire visible inbox, independent of page/type filters. nextCursor is an ID or null.
 *     responses:
 *       '200':
 *         description: Permission-filtered inbox
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [notifications, nextCursor, unreadCount]
 *               properties:
 *                 notifications: { type: array, items: { type: object } }
 *                 nextCursor: { type: integer, nullable: true }
 *                 unreadCount: { type: integer }
 *       '400': { description: Invalid query parameter }
 *       '401': { description: Authentication required }
 */
router.get('/', async (req, res) => {
  const { limit, cursor } = pagination(req.query);
  if (req.query.type !== undefined && !Object.values(NotificationType).includes(req.query.type)) throw new HttpError(400, 'Invalid type.');
  if (req.query.unread !== undefined && !['true', 'false'].includes(req.query.unread)) throw new HttpError(400, 'Invalid unread.');
  const visibility = visibleTo(req.user.id);
  const [rows, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({ where: { AND: [visibility,
      ...(req.query.type ? [{ notificationType: req.query.type }] : []),
      ...(req.query.unread === 'true' ? [unread] : []), ...(cursor ? [{ id: { lt: cursor } }] : []),
    ] }, orderBy: { id: 'desc' }, take: limit + 1, include: { doseLog: { select: { patientId: true } } } }),
    prisma.notification.count({ where: { AND: [visibility, unread] } }),
  ], { isolationLevel: 'RepeatableRead' });
  const page = rows.slice(0, limit);
  for (const patientId of new Set(page.filter((row) => row.notificationType === 'weekly_summary').map((row) => row.relatedPatientId))) {
    await viewPermission({ user: req.user, patientId }, res, () => {});
  }
  for (const patientId of new Set(page.filter((row) => row.notificationType !== 'weekly_summary').map((row) => row.doseLog?.patientId).filter((id) => id && id !== req.user.id))) {
    await alertPermission({ user: req.user, patientId }, res, () => {});
  }
  res.json({ notifications: page.map(({ doseLog, ...row }) => row),
    nextCursor: rows.length > limit ? page.at(-1).id : null, unreadCount });
});

/**
 * @openapi
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark your visible notification read, idempotently
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       '200':
 *         description: Original readAt is preserved on repeat requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notification: { type: object }
 *       '400': { description: Invalid id }
 *       '401': { description: Authentication required }
 *       '404': { description: Notification not found, owned by another user, or hidden }
 */
router.patch('/:id/read', async (req, res) => {
  const id = positiveId(req.params.id);
  const where = { AND: [{ id }, visibleTo(req.user.id)] };
  const notification = await prisma.notification.findFirst({ where, include: { doseLog: { select: { patientId: true } } } });
  if (!notification) throw new HttpError(404, 'Notification not found.');
  if (notification.notificationType === 'weekly_summary') {
    await viewPermission({ user: req.user, patientId: notification.relatedPatientId }, res, () => {});
  } else if (notification.doseLog && notification.doseLog.patientId !== req.user.id) {
    await alertPermission({ user: req.user, patientId: notification.doseLog.patientId }, res, () => {});
  }
  await prisma.notification.updateMany({ where: { AND: [where, { readAt: null }] },
    data: { readAt: new Date(), status: 'read' } });
  const updated = await prisma.notification.findFirst({ where });
  if (!updated) throw new HttpError(404, 'Notification not found.');
  res.json({ notification: updated });
});

export default router;
