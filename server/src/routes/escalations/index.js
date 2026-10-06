import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { bodyFields, id, loadResource, patientScope } from '../medications/access.js';
import { inventoryTransaction } from '../../services/inventory.service.js';
import { runEscalationJob } from '../../jobs/escalationJob.js';
import { getGracePeriodMinutes } from '../escalation-settings/config.js';

const router = Router();
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// A caregiver supplies patientId; checkPermission always gates patient data.
router.get('/active', patientScope, checkPermission('alerts_only'), async (req, res) => {
  res.json(await prisma.escalationAlert.findMany({ where: {
    patientId: req.patientId, resolutionStatus: 'open', resolvedAt: null,
    ...(req.patientId !== req.user.id && { caregiverId: req.user.id }),
  }, include: { doseLog: { select: { scheduledDatetime: true,
    schedule: { select: { medication: { select: { medicineName: true } } } } } } },
  orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }] }));
});

router.patch('/:id/resolve', loadResource('escalationAlert'), checkPermission('alerts_only'), async (req, res) => {
  bodyFields(req.body ?? {}, []);
  if (req.patientId !== req.user.id && req.record.caregiverId !== req.user.id) {
    throw new HttpError(403, 'Only the patient or the alert recipient can resolve this alert.');
  }
  const alert = await inventoryTransaction(async (tx) => {
    const current = await tx.escalationAlert.findUnique({ where: { id: req.record.id }, include: { doseLog: true } });
    if (!current) throw new HttpError(404, 'Escalation alert not found.');
    if (current.resolutionStatus === 'resolved') {
      const { doseLog, ...alert } = current;
      return alert;
    }
    if (current.doseLog.status !== 'taken') throw new HttpError(409, 'Log the dose as taken before resolving its alert.');
    return tx.escalationAlert.update({ where: { id: current.id }, data: { resolvedAt: new Date(), resolutionStatus: 'resolved' } });
  });
  res.json(alert);
});

function devOnly(_req, _res, next) {
  if (process.env.NODE_ENV === 'production') throw new HttpError(404, 'Not found.');
  next();
}
router.post('/jobs/run', devOnly, (req, _res, next) => {
  bodyFields(req.body, ['patientId']); next();
}, patientScope, checkPermission('full_access'), async (req, res) => {
  const result = await runEscalationJob({ patientId: req.patientId, runtime: req.app.locals.scanRuntime });
  res.status(result.errors.length ? 500 : 200).json(result);
});

router.post('/dev/overdue-dose', devOnly, async (req, _res, next) => {
  const body = bodyFields(req.body, ['scheduleId']);
  req.schedule = await prisma.medicationSchedule.findUnique({ where: { id: id(body.scheduleId, 'scheduleId') }, include: { medication: true } });
  if (!req.schedule) throw new HttpError(404, 'Schedule not found.');
  req.patientId = req.schedule.medication.patientId;
  next();
}, checkPermission('full_access'), async (req, res) => {
  const scheduledDatetime = new Date(Date.now() - getGracePeriodMinutes() * 60000 - 1000);
  const dose = await prisma.doseLog.create({ data: {
    scheduleId: req.schedule.id, patientId: req.patientId, status: 'pending',
    scheduledDatetime, createdAt: new Date(scheduledDatetime.getTime() - 1000),
    notes: 'Phase 8 development overdue-dose fixture',
  } });
  res.status(201).json(dose);
});
export default router;
