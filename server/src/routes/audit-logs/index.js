import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import { HttpError } from '../../services/authErrors.js';
import { pagination, positiveId } from '../notifications/pagination.js';

const router = Router();
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
/**
 * @openapi
 * /api/audit-logs:
 *   get:
 *     summary: Read audit rows where you are actor or subject patient
 *     tags: [Audit logs]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: userId, description: Defaults to caller; another user is forbidden, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: cursor, schema: { type: integer, minimum: 1 } }
 *     description: Ordered by timestamp then id descending. Each row includes actor with id and fullName. An inaccessible cursor returns an empty page.
 *     responses:
 *       '200':
 *         description: Your audit trail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [auditLogs, nextCursor]
 *               properties:
 *                 auditLogs: { type: array, items: { type: object } }
 *                 nextCursor: { type: integer, nullable: true }
 *       '400': { description: Invalid query parameter }
 *       '401': { description: Authentication required }
 *       '403': { description: Only your own audit trail is available }
 */
router.get('/', async (req, res) => {
  if (req.query.userId !== undefined && positiveId(req.query.userId, 'userId') !== req.user.id) {
    throw new HttpError(403, 'Only your own audit trail is available.');
  }
  const { limit, cursor } = pagination(req.query);
  const access = { OR: [{ userId: req.user.id }, { subjectPatientId: req.user.id }] };
  // Resolve only a caller-visible cursor; another user's id reveals no metadata.
  const anchor = cursor ? await prisma.auditLog.findFirst({ where: { AND: [access, { id: cursor }] } }) : null;
  if (cursor && !anchor) return res.json({ auditLogs: [], nextCursor: null });
  const rows = await prisma.auditLog.findMany({ where: { AND: [access, ...(anchor ? [{ OR: [
    { timestamp: { lt: anchor.timestamp } }, { timestamp: anchor.timestamp, id: { lt: anchor.id } },
  ] }] : [])] }, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }], take: limit + 1,
  include: { user: { select: { id: true, fullName: true } } } });
  res.json({ auditLogs: rows.slice(0, limit).map(({ user, ...row }) => ({ ...row, actor: user })),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null });
});
export default router;
