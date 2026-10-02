import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { patientScope } from '../medications/access.js';
import { HttpError } from '../../services/authErrors.js';
import { getPatient, patientDate, timezoneFor } from '../../jobs/adherenceCalendar.js';
import { calculateStats } from './service.js';

const router = Router();
router.use(verifyJWT, patientScope, checkPermission('view_only'), (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/stats', async (req, res) => {
  const today = patientDate(new Date(), timezoneFor(await getPatient(req.patientId)));
  const rows = await prisma.adherenceStat.findMany({ where: { patientId: req.patientId, periodType: 'daily', periodStartDate: { lte: new Date(today) } }, orderBy: [{ periodStartDate: 'asc' }, { generatedAt: 'asc' }, { id: 'asc' }] });
  res.json(calculateStats(rows, today));
});
router.get('/heatmap', async (req, res) => {
  const months = req.query.months ?? '3';
  if (!/^[1-9]\d*$/.test(String(months)) || Number(months) > 120) throw new HttpError(400, 'months must be an integer from 1 to 120.');
  const today = patientDate(new Date(), timezoneFor(await getPatient(req.patientId)));
  const start = new Date(today);
  // Calendar months, including the current month.
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - Number(months) + 1);
  const rows = await prisma.adherenceStat.findMany({ where: { patientId: req.patientId, periodType: 'daily', periodStartDate: { gte: start, lte: new Date(today) } }, orderBy: [{ periodStartDate: 'asc' }, { generatedAt: 'asc' }, { id: 'asc' }] });
  res.json(Object.fromEntries(rows.map((row) => [row.periodStartDate.toISOString().slice(0, 10), Number(row.adherencePercentage)])));
});
export default router;
