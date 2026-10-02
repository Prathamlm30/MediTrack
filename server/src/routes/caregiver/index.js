import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { listCaregiverPatients } from './patients.js';

const router = Router();
const alertPermission = checkPermission('alerts_only');
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/patients', async (req, res) => res.json(await listCaregiverPatients(req, res)));

// Live changes arrive as missed-dose-alert on the existing authenticated
// Phase 8 connection, in user:<caregiverId>. Refresh this archive on that event.
router.get('/alerts-feed', async (req, res) => {
  const alerts = await prisma.escalationAlert.findMany({
    where: { caregiverId: req.user.id }, orderBy: { triggeredAt: 'desc' },
  });
  const permitted = new Set();
  for (const patientId of new Set(alerts.map((alert) => alert.patientId))) {
    try {
      await alertPermission({ user: req.user, params: {}, patientId }, res, () => {});
      permitted.add(patientId);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 403) throw error;
    }
  }
  res.json(alerts.filter((alert) => permitted.has(alert.patientId)));
});

export default router;
