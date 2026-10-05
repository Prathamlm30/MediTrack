import { Router } from 'express';
import verifyJWT from '../../middleware/verifyJWT.js';
import { body } from '../../middleware/validation.js';
import { HttpError } from '../../services/authErrors.js';
import { sendMail } from '../../services/mail.service.js';

const router = Router();
const attempts = new Map();
const HOUR = 60 * 60 * 1000;
router.use(verifyJWT, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
/**
 * @openapi
 * /api/support-tickets:
 *   post:
 *     summary: Email support with your account email as Reply-To
 *     tags: [Support]
 *     security: [{ bearerAuth: [] }]
 *     description: Subject control characters are removed. Five valid attempts per user per rolling hour, including SMTP failures. No database ticket is created.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, message]
 *             properties:
 *               subject: { type: string, minLength: 1, maxLength: 120 }
 *               message: { type: string, minLength: 1, maxLength: 2000 }
 *     responses:
 *       '201': { description: SMTP accepted the email for delivery }
 *       '400': { description: Invalid subject or message }
 *       '401': { description: Authentication required }
 *       '429': { description: Hourly limit reached; Retry-After specifies seconds }
 *       '502': { description: SMTP failed or rejected the recipient }
 *       '503': { description: Support email is not configured }
 */
router.post('/', async (req, res) => {
  const data = body(req);
  if (typeof data.subject !== 'string' || typeof data.message !== 'string') throw new HttpError(400, 'Subject and message are required.');
  const subject = data.subject.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim();
  const message = data.message.trim();
  if (!subject || subject.length > 120 || !message || message.length > 2000) {
    throw new HttpError(400, 'Subject must be 1-120 characters and message 1-2000 characters.');
  }
  const now = Date.now();
  // MVP single-process limit; resets on restart and is not shared by replicas.
  // Count valid attempts, including SMTP failures, to prevent retry abuse.
  for (const [id, times] of attempts) {
    const recent = times.filter((time) => now - time < HOUR);
    if (recent.length) attempts.set(id, recent); else attempts.delete(id);
  }
  const times = attempts.get(req.user.id) || [];
  if (times.length >= 5) {
    res.set('Retry-After', String(Math.ceil((times[0] + HOUR - now) / 1000)));
    throw new HttpError(429, 'Support ticket limit reached. Try again within an hour.');
  }
  const to = process.env.SUPPORT_INBOX || (process.env.NODE_ENV !== 'production' ? 'support@meditrack.local' : null);
  if (!to) throw new HttpError(503, 'Support email is not configured.');
  attempts.set(req.user.id, [...times, now]);
  try {
    await sendMail({ to, replyTo: req.user.email, subject, text: message });
  } catch {
    throw new HttpError(502, 'Support email could not be delivered. Please try again later.');
  }
  res.status(201).json({ message: 'Support email accepted for delivery.' });
});
export default router;
