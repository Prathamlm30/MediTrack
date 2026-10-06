import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { inventoryTransaction } from '../../services/inventory.service.js';
import { checkMedicationInteractions } from '../../services/interactionCheck.service.js';
import { medicineData } from '../prescription-scans/validation.js';
import { id, patientScope, canEdit, loadResource, bodyFields } from './access.js';

const router = Router();
const fields = ['medicineName', 'genericName', 'medicineForm', 'trackingType', 'dosageAmount', 'dosageUnit', 'frequencyText', 'instructions', 'startDate', 'endDate', 'doctorId', 'status'];
const statuses = ['active', 'completed', 'discontinued'];
router.use(verifyJWT, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
function status(value) {
  if (!statuses.includes(value)) throw new HttpError(400, 'Invalid medication status.');
  return value;
}
async function data(body, patientId, old) {
  bodyFields(body, old ? fields : [...fields, 'patientId']);
  const merged = { ...old, ...(old && { dosageAmount: String(old.dosageAmount), startDate: old.startDate.toISOString().slice(0, 10), endDate: old.endDate?.toISOString().slice(0, 10) ?? null }), ...body };
  const result = medicineData(merged);
  result.status = status(merged.status === undefined ? 'active' : merged.status);
  result.doctorId = merged.doctorId == null || merged.doctorId === '' ? null : id(merged.doctorId, 'doctorId');
  if (result.doctorId && !await prisma.doctor.findFirst({ where: { id: result.doctorId, patientId } })) throw new HttpError(400, 'Choose a doctor belonging to this patient.');
  return result;
}
router.get('/', patientScope, checkPermission('view_only'), async (req, res) => {
  const where = { patientId: req.patientId };
  if (req.query.status !== undefined) where.status = status(req.query.status);
  res.json({ medications: await prisma.medication.findMany({ where, include: { doctor: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), canEdit: canEdit(req) });
});
router.post('/', patientScope, checkPermission('full_access'), async (req, res) => {
  const medicationData = { ...await data(req.body, req.patientId), patientId: req.patientId, addedVia: 'manual' };
  const medication = await inventoryTransaction(async (db) => {
    const created = await db.medication.create({ data: medicationData });
    await checkMedicationInteractions(created.id, db);
    return created;
  });
  await req.app.locals.scanRuntime?.emitDataChanged?.({ patientId: req.patientId, resource: 'medication', id: medication.id, action: 'created' });
  res.status(201).json(medication);
});
router.get('/:id', loadResource('medication'), checkPermission('view_only'), async (req, res) => {
  // DoseLog belongs to MedicationSchedule. Select a global recent slice first,
  // then include those logs through the schema's actual relation.
  const doseLogs = await prisma.doseLog.findMany({ where: { patientId: req.patientId, schedule: { medicationId: req.record.id } }, orderBy: [{ scheduledDatetime: 'desc' }, { id: 'desc' }], take: 20 });
  const medication = await prisma.medication.findUnique({ where: { id: req.record.id }, include: {
    doctor: true,
    schedules: { orderBy: { id: 'asc' }, include: { doseLogs: { where: { id: { in: doseLogs.map((row) => row.id) }, patientId: req.patientId }, orderBy: [{ scheduledDatetime: 'desc' }, { id: 'desc' }] } } },
    inventory: { where: { patientId: req.patientId }, orderBy: { id: 'asc' } },
  } });
  if (!medication) throw new HttpError(404, 'Medication not found.');
  const aiInsights = await prisma.aiInsight.findMany({ where: { patientId: req.patientId, relatedMedicationId: medication.id }, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }] });
  res.json({ ...medication, doseLogs, aiInsights, canEdit: canEdit(req) });
});
router.patch('/:id', loadResource('medication'), checkPermission('full_access'), async (req, res) => {
  const medication = await prisma.medication.update({ where: { id: req.record.id }, data: await data(req.body, req.patientId, req.record) });
  await req.app.locals.scanRuntime?.emitDataChanged?.({ patientId: req.patientId, resource: 'medication', id: medication.id, action: 'updated' });
  res.json(medication);
});
router.delete('/:id', loadResource('medication'), checkPermission('full_access'), async (req, res) => {
  const medication = await prisma.medication.update({ where: { id: req.record.id }, data: { status: 'discontinued' } });
  await req.app.locals.scanRuntime?.emitDataChanged?.({ patientId: req.patientId, resource: 'medication', id: medication.id, action: 'deleted' });
  res.json(medication);
});
export default router;
