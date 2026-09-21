import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { dayWindow } from './dayWindow.js';

const viewPermission = checkPermission('view_only');
const alertPermission = checkPermission('alerts_only');

// Phase 2 defines separate view and alert capabilities. Try each through the
// existing middleware; only a permission denial may fall back to alert access.
async function authorizeCaregiver(req, res, next) {
  if (Number(req.patientId ?? req.params.patientId) === req.user.id) {
    throw new HttpError(403, 'Use the patient dashboard for your own data.');
  }
  try { await viewPermission(req, res, () => {}); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    await alertPermission(req, res, () => {});
  }
  next();
}

const medicationSummary = { id: true, medicineName: true, medicineForm: true, dosageAmount: true, dosageUnit: true };
async function dashboard(patientId, permissionLevel, readOnly) {
  const patient = await prisma.user.findUnique({ where: { id: patientId }, select: {
    id: true, fullName: true, timezone: true, preferences: { select: { timezone: true } },
  } });
  if (!patient) throw new HttpError(404, 'Patient not found.');
  const now = new Date();
  const { start, end, timezone } = dayWindow(now, patient.preferences?.timezone || patient.timezone);
  const refillAlerts = await prisma.medicineInventory.findMany({
    where: { patientId, medication: { patientId }, estimatedRunoutDate: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } },
    select: { id: true, medicationId: true, quantityRemaining: true, quantityUnit: true, estimatedRunoutDate: true,
      medication: { select: { id: true, medicineName: true } } },
    orderBy: [{ estimatedRunoutDate: 'asc' }, { id: 'asc' }],
  });
  const result = { patient: { id: patient.id, fullName: patient.fullName }, permissionLevel, readOnly,
    timezone, generatedAt: now, refillAlerts };
  // Do not even query dose history or adherence for alerts-only access.
  if (permissionLevel === 'alerts_only') return result;
  const [todayDoses, adherence] = await Promise.all([
    prisma.doseLog.findMany({
      where: { patientId, schedule: { medication: { patientId } }, scheduledDatetime: { gte: start, lt: end } },
      select: { id: true, scheduledDatetime: true, actualActionDatetime: true, status: true,
        schedule: { select: { id: true, doseAmount: true, medication: { select: medicationSummary } } } },
      orderBy: [{ scheduledDatetime: 'asc' }, { id: 'asc' }],
    }),
    prisma.adherenceStat.findFirst({ where: { patientId, periodType: 'daily' },
      orderBy: [{ periodStartDate: 'desc' }, { generatedAt: 'desc' }, { id: 'desc' }],
      select: { periodType: true, periodStartDate: true, periodEndDate: true, totalScheduledDoses: true,
        takenCount: true, missedCount: true, skippedCount: true, adherencePercentage: true, generatedAt: true },
    }),
  ]);
  return { ...result, todayDoses, adherence };
}

const router = Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(verifyJWT);
router.get('/patient', async (req, res) => res.json(await dashboard(req.user.id, 'full_access', false)));
router.get('/caregiver/:patientId', authorizeCaregiver, async (req, res) => {
  res.json(await dashboard(req.patientId, req.caregiverPatientLink.permissionLevel, true));
});
router.get('/my-patients', async (req, res) => {
  // Explicit projection avoids serializing credentials/private profile fields
  // from the roadmap's patient relation. Cards contain identity, not health data.
  const links = await prisma.caregiverPatientLink.findMany({
    where: { caregiverId: req.user.id, status: 'active' },
    include: { patient: { select: { id: true, fullName: true } } }, orderBy: { id: 'asc' },
  });
  const patients = [];
  const seen = new Set();
  for (const link of links) {
    if (seen.has(link.patientId) || link.patientId === req.user.id) continue;
    seen.add(link.patientId);
    const scoped = { user: req.user, params: { patientId: String(link.patientId) } };
    try { await authorizeCaregiver(scoped, res, () => {}); }
    catch (error) {
      if (error instanceof HttpError && error.status === 403) continue; // Revoked since enumeration.
      throw error;
    }
    patients.push({ patient: link.patient, relationshipType: scoped.caregiverPatientLink.relationshipType,
      permissionLevel: scoped.caregiverPatientLink.permissionLevel, readOnly: true });
  }
  res.json({ patients });
});
export default router;
