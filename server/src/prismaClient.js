import { PrismaClient } from '@prisma/client';
import { requiredEnv } from './config/env.js';

requiredEnv('DATABASE_URL');

// Import this shared instance everywhere; never construct a client per request.
const prisma = new PrismaClient();

export default prisma;
