import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { bodyFields, id } from '../medications/access.js';
import { runWeeklyReportJob } from '../../jobs/weeklyReportJob.js';

const router = Router();
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/weekly', (req, _res, next) => {
  req.patientId = id(req.query.patientId, 'patientId'); next();
}, checkPermission('view_only'), async (req, res) => {
  res.json(await prisma.weeklySummaryReport.findMany({ where: { patientId: req.patientId, caregiverId: req.user.id },
    orderBy: [{ weekEndDate: 'desc' }, { id: 'desc' }] }));
});

router.get('/weekly/:id', async (req, _res, next) => {
  req.report = await prisma.weeklySummaryReport.findFirst({ where: { id: id(req.params.id), caregiverId: req.user.id } });
  if (!req.report) throw new HttpError(404, 'Weekly report not found.');
  req.patientId = req.report.patientId;
  next();
}, checkPermission('view_only'), (req, res) => res.json(req.report));

// Only the caller's own recipients are processed; no arbitrary caregiverId.
router.post('/weekly/jobs/run', async (req, res) => {
  if (process.env.NODE_ENV === 'production') throw new HttpError(404, 'Not found.');
  const body = bodyFields(req.body, ['patientId', 'date']);
  const patientId = body.patientId === undefined ? undefined : id(body.patientId, 'patientId');
  if (patientId !== undefined) await checkPermission('view_only')({ user: req.user, patientId, params: {} }, res, () => {});
  const result = await runWeeklyReportJob({ caregiverId: req.user.id, patientId, date: body.date });
  res.status(result.errors.length ? 500 : 200).json(result);
});

export default router;
