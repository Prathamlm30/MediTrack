import { Router } from 'express';
import verifyJWT from '../../middleware/verifyJWT.js';
import { HttpError } from '../../services/authErrors.js';
import { bodyFields } from '../medications/access.js';
import { getSettings, validateGracePeriodMinutes } from './config.js';

const router = Router();
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', (_req, res) => res.json(getSettings()));
router.patch('/', (req, res) => {
  if (process.env.NODE_ENV === 'production') throw new HttpError(403, 'Configure ESCALATION_GRACE_PERIOD_MINUTES in the server environment.');
  const body = bodyFields(req.body, ['gracePeriodMinutes']);
  process.env.ESCALATION_GRACE_PERIOD_MINUTES = String(validateGracePeriodMinutes(body.gracePeriodMinutes));
  res.json({ ...getSettings(), persistence: 'process_until_restart' });
});
export default router;
