import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { inventoryTransaction } from '../../services/inventory.service.js';
import { id, loadResource, bodyFields } from '../medications/access.js';
import { scheduleData } from './validation.js';
import { generateSchedules } from './gemini.js';

const router = Router();
router.use(['/medications/:id/schedules', '/schedules/:id'], verifyJWT, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const loadMedication = loadResource('medication');
async function loadSchedule(req, res, next) {
  req.record = await prisma.medicationSchedule.findUnique({ where: { id: id(req.params.id) }, include: { medication: true } });
  if (!req.record) throw new HttpError(404, 'Schedule not found.');
  req.patientId = req.record.medication.patientId;
  next();
}
function data(body, old, medication) {
  const result = scheduleData({ ...(!old && medication?.trackingType === 'countable' && { doseAmount: 1 }), ...body }, old);
  return { ...result, taperDetails: result.taperDetails ?? Prisma.DbNull };
}
router.get('/medications/:id/schedules', loadMedication, checkPermission('view_only'), async (req, res) => {
  res.json(await prisma.medicationSchedule.findMany({ where: { medicationId: req.record.id }, orderBy: [{ timeOfDay: 'asc' }, { id: 'asc' }] }));
});
router.post('/medications/:id/schedules/generate', loadMedication, checkPermission('full_access'), async (req, res) => {
  bodyFields(req.body, ['frequencyText']);
  const text = req.body.frequencyText;
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new HttpError(400, 'frequencyText must contain 1–1000 characters.');
  if (await prisma.medicationSchedule.count({ where: { medicationId: req.record.id, isActive: true } })) throw new HttpError(409, 'Edit or deactivate existing schedules before generation.');
  const rows = await generateSchedules(text, req.record);
  const created = await inventoryTransaction(async (tx) => {
    if (await tx.medicationSchedule.count({ where: { medicationId: req.record.id, isActive: true } })) throw new HttpError(409, 'Active schedules already exist.');
    await tx.medicationSchedule.createMany({ data: rows.map((row) => ({ ...row, medicationId: req.record.id })) });
    return tx.medicationSchedule.findMany({ where: { medicationId: req.record.id, isActive: true }, orderBy: { timeOfDay: 'asc' } });
  });
  res.status(201).json(created);
});
router.post('/medications/:id/schedules', loadMedication, checkPermission('full_access'), async (req, res) => {
  bodyFields(req.body, ['timeOfDay', 'daysOfWeek', 'doseAmount', 'isTaperSchedule', 'taperDetails', 'isActive']);
  res.status(201).json(await prisma.medicationSchedule.create({ data: { ...data(req.body, undefined, req.record), medicationId: req.record.id } }));
});
router.get('/schedules/:id', loadSchedule, checkPermission('view_only'), (req, res) => {
  const { medication, ...row } = req.record;
  res.json(row);
});
router.patch('/schedules/:id', loadSchedule, checkPermission('full_access'), async (req, res) => {
  bodyFields(req.body, ['timeOfDay', 'daysOfWeek', 'doseAmount', 'isTaperSchedule', 'taperDetails', 'isActive']);
  res.json(await prisma.medicationSchedule.update({ where: { id: req.record.id }, data: data(req.body, req.record) }));
});
router.delete('/schedules/:id', loadSchedule, checkPermission('full_access'), async (req, res) => {
  // Preserve historical DoseLog references; deleted schedules no longer consume stock.
  await prisma.medicationSchedule.update({ where: { id: req.record.id }, data: { isActive: false } });
  res.sendStatus(204);
});
export default router;
