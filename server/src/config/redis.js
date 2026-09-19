import Redis from 'ioredis';
import { requiredEnv } from './env.js';

// Auth sessions and short-lived, hashed verification/reset tokens (Phase 1).
const redis = new Redis(requiredEnv('REDIS_URL'), {
  lazyConnect: true,
  connectTimeout: 5000,
  commandTimeout: 5000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error.message);
});

export default redis;
