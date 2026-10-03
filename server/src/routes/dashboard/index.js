import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import { authorizeCaregiver, listCaregiverPatients } from '../caregiver/patients.js';
import { HttpError } from '../../services/authErrors.js';
import { dayWindow } from './dayWindow.js';
import { generateAdherenceInsight } from '../insights/generation.js';

const medicationSummary = { id: true, medicineName: true, medicineForm: true, dosageAmount: true, dosageUnit: true };
async function dashboard(patientId, permissionLevel, readOnly) {
  const patient = await prisma.user.findUnique({ where: { id: patientId }, select: {
    id: true, fullName: true, timezone: true, preferences: { select: { timezone: true } },
  } });
  if (!patient) throw new HttpError(404, 'Patient not found.');
  const now = new Date();
  const { start, end, timezone } = dayWindow(now, patient.preferences?.timezone || patient.timezone);
  const refillAlerts = await prisma.medicineInventory.findMany({
    where: { patientId, medication: { patientId }, estimatedRunoutDate: { lte: new Date(now.getTime() + 7 * 86400000) } },
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
/**
 * @openapi
 * /api/dashboard/patient:
 *   get:
 *     summary: Read your patient dashboard
 *     tags:
 *       - Dashboards
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       Always uses the caller id. Returns full_access and readOnly false, including todayDoses and adherence.
 *       Empty sections are [] and null. Refill alerts include overdue dates as well as dates within the next
 *       seven days.
 *     responses:
 *       '200':
 *         description: Own dashboard.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PatientDashboard'
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
 *       '404':
 *         description: Patient not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Patient not found.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/patient', async (req, res) => {
  const result = await dashboard(req.user.id, 'full_access', false);
  // Cache per UTC week. A provider outage must not hide the patient's dashboard.
  try { await generateAdherenceInsight(req.user.id); }
  catch (error) { console.error('Adherence insight generation failed:', error.code || error.name); }
  res.json(result);
});
/**
 * @openapi
 * /api/dashboard/caregiver/{patientId}:
 *   get:
 *     summary: Read a linked patient dashboard
 *     tags:
 *       - Dashboards
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: patientId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 9007199254740991
 *         description: Positive safe integer written in decimal digits without leading zeros.
 *     description: >-
 *       Reads active relationship permissions on every request. view_only/full_access include doses and
 *       adherence. alerts_only omits both keys entirely, while keeping refill alerts. Always readOnly true. Self
 *       access is rejected. Checks view permission first, then alerts permission; failed access reports
 *       alerts_only required.
 *     responses:
 *       '200':
 *         description: Permission-filtered dashboard.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CaregiverDashboard'
 *       '400':
 *         description: A valid patientId is required. / Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: A valid patientId is required.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         description: 'Use the patient dashboard for your own data. / Insufficient permission: alerts_only required.'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Use the patient dashboard for your own data.
 *               error2:
 *                 value:
 *                   error: 'Insufficient permission: alerts_only required.'
 *       '404':
 *         description: Patient not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Patient not found.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/caregiver/:patientId', authorizeCaregiver, async (req, res) => {
  res.json(await dashboard(req.patientId, req.caregiverPatientLink.permissionLevel, true));
});
/**
 * @openapi
 * /api/dashboard/my-patients:
 *   get:
 *     summary: List patients you can currently access
 *     tags:
 *       - Dashboards
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       Only active links; patient ids are deduplicated and self is excluded. Permissions are rechecked for each
 *       patient. Returns identities without email or health data, with readOnly always true.
 *     responses:
 *       '200':
 *         description: Patient switcher entries, or an empty array.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - patients
 *               properties:
 *                 patients:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PatientListEntry'
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
router.get('/my-patients', async (req, res) => res.json(await listCaregiverPatients(req, res)));

export default router;
