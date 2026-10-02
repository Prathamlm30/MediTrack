import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { inventoryTransaction } from '../../services/inventory.service.js';
import { loadResource, bodyFields } from '../medications/access.js';
import { decimal } from '../schedules/validation.js';

const router = Router();
router.use('/medications/:id/inventory', verifyJWT, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/medications/:id/inventory', loadResource('medication'), checkPermission('view_only'), async (req, res) => {
  const row = await prisma.medicineInventory.findFirst({ where: { medicationId: req.record.id, patientId: req.patientId } });
  if (!row) throw new HttpError(404, 'Inventory not set up.');
  res.json(row);
});
router.post('/medications/:id/inventory', loadResource('medication'), checkPermission('full_access'), async (req, res) => {
  const body = bodyFields(req.body, ['quantityUnit', 'quantityTotal', 'refillThreshold', 'refillAmount', 'estimatedUsagePerDose']);
  const quantityUnit = { countable: 'units', volume_ml: 'ml', weight_grams: 'g' }[req.record.trackingType];
  if (body.quantityUnit !== undefined && body.quantityUnit !== quantityUnit) throw new HttpError(400, `quantityUnit must be ${quantityUnit}, derived from trackingType.`);
  const total = decimal(body.quantityTotal, 'quantityTotal', 999999.99, true);
  const data = {
    medicationId: req.record.id, patientId: req.patientId, quantityUnit,
    quantityTotal: total, quantityRemaining: total,
    refillThreshold: decimal(body.refillThreshold, 'refillThreshold', 999999.99, true),
    refillAmount: decimal(body.refillAmount, 'refillAmount', 999999.99),
    estimatedUsagePerDose: body.estimatedUsagePerDose === undefined ? (req.record.trackingType === 'countable' ? 1 : null) : decimal(body.estimatedUsagePerDose, 'estimatedUsagePerDose'),
  };
  const row = await inventoryTransaction(async (tx) => {
    if (await tx.medicineInventory.count({ where: { medicationId: data.medicationId, patientId: data.patientId } })) throw new HttpError(409, 'Inventory is already set up.');
    return tx.medicineInventory.create({ data });
  });
  res.status(201).json(row);
});

router.patch('/medications/:id/inventory', loadResource('medication'), checkPermission('full_access'), async (req, res) => {
  const body = bodyFields(req.body, ['refillThreshold', 'refillAmount']);
  const data = {};
  if (body.refillThreshold !== undefined) data.refillThreshold = decimal(body.refillThreshold, 'refillThreshold', 999999.99, true);
  if (body.refillAmount !== undefined) data.refillAmount = decimal(body.refillAmount, 'refillAmount', 999999.99);
  const row = await inventoryTransaction(async (tx) => {
    const current = await tx.medicineInventory.findFirst({ where: { medicationId: req.record.id, patientId: req.patientId } });
    if (!current) throw new HttpError(404, 'Inventory not set up.');
    return tx.medicineInventory.update({ where: { id: current.id }, data });
  });
  res.json(row);
});

// Read only Phase 6 refill notifications scoped through the medication owner.
router.get('/medications/:id/inventory/notifications', loadResource('medication'), checkPermission('view_only'), async (req, res) => {
  res.json(await prisma.notification.findMany({ where: {
    userId: req.patientId, notificationType: 'refill', title: `Refill needed: medication #${req.record.id}`,
  }, orderBy: { sentAt: 'desc' }, take: 100 }));
});
export default router;
