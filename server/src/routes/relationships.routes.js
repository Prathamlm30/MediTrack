import { Router } from 'express';
import prisma from '../prismaClient.js';
import verifyJWT from '../middleware/verifyJWT.js';
import { body } from '../middleware/validation.js';
import { HttpError } from '../services/authErrors.js';

// Only identity information is needed here, never credentials or health/profile data.
export const relationshipUsers = {
  patient: { select: { id: true, fullName: true, email: true } },
  caregiver: { select: { id: true, fullName: true, email: true } },
};
export const withPerspective = (link, userId) => ({
  ...link, perspective: link.patientId === userId ? 'patient' : 'caregiver',
});

const router = Router();
router.use(verifyJWT);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/**
 * @openapi
 * /api/relationships:
 *   get:
 *     summary: List your relationships from both perspectives
 *     tags:
 *       - Relationships
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       Includes every status, ordered by id ascending. Perspective is patient when patientId equals the caller
 *       id, otherwise caregiver.
 *     responses:
 *       '200':
 *         description: Relationships; empty array when none exist.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - relationships
 *               properties:
 *                 relationships:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CaregiverPatientLink'
 *               additionalProperties: false
 *       '400':
 *         description: Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', async (req, res) => {
  const links = await prisma.caregiverPatientLink.findMany({
    where: { OR: [{ patientId: req.user.id }, { caregiverId: req.user.id }] },
    include: relationshipUsers,
    orderBy: { id: 'asc' },
  });
  res.json({ relationships: links.map((link) => withPerspective(link, req.user.id)) });
});

/**
 * @openapi
 * /api/relationships/{linkId}/permissions:
 *   patch:
 *     summary: Change a relationship permission or revoke it
 *     tags:
 *       - Relationships
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: linkId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 9007199254740991
 *         description: Positive safe integer written in decimal digits without leading zeros.
 *     description: >-
 *       Only the patient on this specific link may manage it. Send exactly one field. Updating permissionLevel
 *       does not reactivate an inactive link. Revocation preserves an existing revokedAt timestamp.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required:
 *                   - permissionLevel
 *                 properties:
 *                   permissionLevel:
 *                     type: string
 *                     enum:
 *                       - view_only
 *                       - full_access
 *                       - alerts_only
 *                 additionalProperties: false
 *               - type: object
 *                 required:
 *                   - status
 *                 properties:
 *                   status:
 *                     type: string
 *                     enum:
 *                       - revoked
 *                 additionalProperties: false
 *           example:
 *             permissionLevel: view_only
 *     responses:
 *       '200':
 *         description: Relationship with public patient/caregiver identities and caller perspective.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - relationship
 *               properties:
 *                 relationship:
 *                   $ref: '#/components/schemas/CaregiverPatientLink'
 *               additionalProperties: false
 *       '400':
 *         description: >-
 *           Invalid linkId. / A JSON object is required. / Provide permissionLevel or status: revoked. / Invalid
 *           permissionLevel. / Only revocation is supported. / Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid linkId.
 *               error2:
 *                 value:
 *                   error: A JSON object is required.
 *               error3:
 *                 value:
 *                   error: 'Provide permissionLevel or status: revoked.'
 *               error4:
 *                 value:
 *                   error: Invalid permissionLevel.
 *               error5:
 *                 value:
 *                   error: Only revocation is supported.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         description: Only the patient may manage this relationship.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Only the patient may manage this relationship.
 *       '404':
 *         description: Relationship not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Relationship not found.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/:linkId/permissions', async (req, res) => {
  const id = Number(req.params.linkId);
  if (!/^[1-9]\d*$/.test(req.params.linkId) || !Number.isSafeInteger(id)) throw new HttpError(400, 'Invalid linkId.');
  const data = body(req);
  const keys = Object.keys(data);
  if (keys.length !== 1 || !['permissionLevel', 'status'].includes(keys[0])) {
    throw new HttpError(400, 'Provide permissionLevel or status: revoked.');
  }
  if ('permissionLevel' in data && !['view_only', 'full_access', 'alerts_only'].includes(data.permissionLevel)) {
    throw new HttpError(400, 'Invalid permissionLevel.');
  }
  if ('status' in data && data.status !== 'revoked') throw new HttpError(400, 'Only revocation is supported.');
  const link = await prisma.caregiverPatientLink.findUnique({ where: { id } });
  if (!link) throw new HttpError(404, 'Relationship not found.');
  if (link.patientId !== req.user.id) throw new HttpError(403, 'Only the patient may manage this relationship.');
  const relationship = await prisma.caregiverPatientLink.update({
    where: { id, patientId: req.user.id },
    data: 'permissionLevel' in data ? { permissionLevel: data.permissionLevel } : {
      status: 'revoked', revokedAt: link.revokedAt || new Date(),
    },
    include: relationshipUsers,
  });
  res.json({ relationship: withPerspective(relationship, req.user.id) });
});

export default router;
