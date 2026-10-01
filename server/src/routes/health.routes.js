import { Router } from 'express';
import prisma from '../prismaClient.js';
import redis from '../config/redis.js';

const router = Router();

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Check PostgreSQL and Redis availability
 *     tags:
 *       - System
 *     security: []
 *     responses:
 *       '200':
 *         description: Both dependencies responded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - status
 *               properties:
 *                 status:
 *                   type: string
 *                   enum:
 *                     - ok
 *               additionalProperties: false
 *             example:
 *               status: ok
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
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '503':
 *         description: A dependency check failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - status
 *               properties:
 *                 status:
 *                   type: string
 *                   enum:
 *                     - unavailable
 *               additionalProperties: false
 *             example:
 *               status: unavailable
 */
router.get('/health', async (_req, res) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

export default router;
