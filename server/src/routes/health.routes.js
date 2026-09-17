import { Router } from 'express';
import prisma from '../prismaClient.js';
import redis from '../config/redis.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

export default router;
