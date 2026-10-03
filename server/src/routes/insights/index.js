import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { bodyFields, id, patientScope } from '../medications/access.js';
import { generateAdherenceInsight } from './generation.js';

const router = Router();
router.use(verifyJWT, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', patientScope, checkPermission('view_only'), async (req, res) => {
  const [insights, interactionFlags] = await Promise.all([
    prisma.aiInsight.findMany({ where: { patientId: req.patientId }, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }] }),
    prisma.medicationInteractionFlag.findMany({ where: { patientId: req.patientId },
      include: { interaction: true, medication1: true, medication2: true }, orderBy: [{ flaggedAt: 'desc' }, { id: 'desc' }] }),
  ]);
  // IDs belong to two separate tables. Explicit kind avoids dismissing the
  // wrong record when their numeric IDs coincide.
  res.json({ insights: insights.map((row) => ({ ...row, kind: 'adherence', dismissId: `adherence-${row.id}` })),
    interactionFlags: interactionFlags.map((row) => ({ ...row, kind: 'interaction', dismissId: `interaction-${row.id}` })) });
});
router.post('/generate', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') throw new HttpError(404, 'Not found.');
  bodyFields(req.body, ['patientId']);
  next();
}, patientScope, checkPermission('full_access'), async (req, res) => {
  res.json(await generateAdherenceInsight(req.patientId));
});
router.patch('/:id/dismiss', async (req, res, next) => {
  bodyFields(req.body ?? {}, ['kind']);
  const match = /^(adherence|interaction)-([1-9]\d*)$/.exec(req.params.id);
  const kind = match?.[1] || req.body?.kind || 'adherence';
  if (!['adherence', 'interaction'].includes(kind) || (match && req.body?.kind && match[1] !== req.body.kind)) throw new HttpError(400, 'Invalid insight kind.');
  req.insightModel = kind === 'adherence' ? 'aiInsight' : 'medicationInteractionFlag';
  req.insightRecord = await prisma[req.insightModel].findUnique({ where: { id: id(match?.[2] || req.params.id) } });
  if (!req.insightRecord) throw new HttpError(404, 'Insight not found.');
  req.patientId = req.insightRecord.patientId;
  next();
}, checkPermission('full_access'), async (req, res) => {
  const isAdherence = req.insightModel === 'aiInsight';
  const row = req.insightRecord;
  if ((isAdherence && row.isDismissed) || (!isAdherence && row.acknowledged)) return res.json(row);
  res.json(await prisma[req.insightModel].update({ where: { id: row.id }, data: isAdherence
    ? { isDismissed: true, dismissedAt: new Date() } : { acknowledged: true, acknowledgedAt: new Date() } }));
});
export default router;
