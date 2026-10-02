import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { inventoryTransaction, decrementInventory } from '../../services/inventory.service.js';
import { bodyFields, id, loadResource, patientScope } from '../medications/access.js';
import { getPatient, timezoneFor, patientDate, dateKey, dayBounds } from '../../jobs/adherenceCalendar.js';
import { runDoseLogJob } from '../../jobs/doseLogJob.js';
import { runAdherenceJob, recomputeDailyStats } from '../../jobs/adherenceJob.js';
import { runWeeklyAdherenceJob } from '../../jobs/weeklyAdherenceJob.js';

const router = Router();
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

async function list(req, res, today = false) {
  const timezone = timezoneFor(await getPatient(req.patientId));
  let scheduledDatetime;
  if (today) scheduledDatetime = dayBounds(patientDate(new Date(), timezone), timezone);
  else {
    const from = req.query.from === undefined ? undefined : dateKey(req.query.from);
    const to = req.query.to === undefined ? undefined : dateKey(req.query.to);
    if (from && to && from > to) throw new HttpError(400, 'from must be on or before to.');
    if (from || to) scheduledDatetime = { ...(from && { gte: dayBounds(from, timezone).gte }), ...(to && { lt: dayBounds(to, timezone).lt }) };
  }
  const medicationId = req.query.medicationId === undefined ? undefined : id(req.query.medicationId, 'medicationId');
  res.json(await prisma.doseLog.findMany({ where: { patientId: req.patientId, schedule: { medication: { patientId: req.patientId, ...(medicationId && { id: medicationId }) } }, ...(scheduledDatetime && { scheduledDatetime }) }, include: { schedule: { include: { medication: { select: { id: true, medicineName: true } } } } }, orderBy: [{ scheduledDatetime: 'asc' }, { id: 'asc' }] }));
}
router.get('/today', patientScope, checkPermission('view_only'), (req, res) => list(req, res, true));
router.get('/', patientScope, checkPermission('view_only'), (req, res) => list(req, res));

for (const [name, job] of Object.entries({ generate: runDoseLogJob, aggregate: runAdherenceJob, weekly: runWeeklyAdherenceJob })) {
  router.post(`/jobs/${name}`, (req, res, next) => {
    if (process.env.NODE_ENV === 'production') throw new HttpError(404, 'Not found.');
    bodyFields(req.body, ['patientId', 'date']);
    next();
  }, patientScope, checkPermission('full_access'), async (req, res) => {
    const result = await job({ patientId: req.patientId, ...(req.body.date !== undefined && { date: dateKey(req.body.date) }) });
    res.status(result.errors.length ? 500 : 200).json(result);
  });
}

router.patch('/:id', loadResource('doseLog'), checkPermission('full_access'), async (req, res) => {
  const body = bodyFields(req.body, ['status', 'notes']);
  if (!['taken', 'skipped', 'snoozed'].includes(body.status)) throw new HttpError(400, 'status must be taken, skipped, or snoozed.');
  if (body.notes !== undefined && body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 10000)) throw new HttpError(400, 'notes must be text up to 10000 characters or null.');
  const { row, date } = await inventoryTransaction(async (tx) => {
    const current = await tx.doseLog.findUnique({ where: { id: req.record.id }, include: { schedule: true } });
    if (!current || current.patientId !== req.patientId) throw new HttpError(404, 'Dose log not found.');
    const medication = await tx.medication.findUnique({ where: { id: current.schedule.medicationId }, select: { patientId: true } });
    if (medication?.patientId !== req.patientId) throw new HttpError(409, 'Dose log patient does not match medication.');
    const patient = await tx.user.findUnique({ where: { id: current.patientId }, select: { timezone: true, preferences: { select: { timezone: true } } } });
    const scheduledDate = patientDate(current.scheduledDatetime, timezoneFor(patient));
    const updated = await tx.doseLog.update({ where: { id: current.id }, data: { status: body.status, actualActionDatetime: new Date(), loggedByUserId: req.user.id, ...(body.notes !== undefined && { notes: body.notes }) } });
    if (body.status === 'taken' && current.status !== 'taken') {
      let doseAmount = current.schedule.doseAmount;
      if (current.schedule.isTaperSchedule) {
        const step = Array.isArray(current.schedule.taperDetails)
          ? current.schedule.taperDetails.find((step) => step.fromDate <= scheduledDate && step.toDate >= scheduledDate)
          : undefined;
        if (!step) throw new HttpError(409, `Dose log data error: no taper step covers scheduled date ${scheduledDate}.`);
        doseAmount = step.doseAmount;
      }
      await decrementInventory(current.schedule.medicationId, current.patientId, doseAmount, tx);
    }
    await recomputeDailyStats(current.patientId, scheduledDate, { tx, patient });
    return { row: updated, date: scheduledDate };
  });
  // Emit only after commit, never from inside a retried transaction callback.
  req.app.locals.scanRuntime?.emitStatsUpdated(row.patientId, date);
  res.json(row);
});
export default router;
