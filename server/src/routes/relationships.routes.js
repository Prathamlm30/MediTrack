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

router.get('/', async (req, res) => {
  const links = await prisma.caregiverPatientLink.findMany({
    where: { OR: [{ patientId: req.user.id }, { caregiverId: req.user.id }] },
    include: relationshipUsers,
    orderBy: { id: 'asc' },
  });
  res.json({ relationships: links.map((link) => withPerspective(link, req.user.id)) });
});

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
