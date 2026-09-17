import Redis from 'ioredis';
import { requiredEnv } from './env.js';

// Reserved for refresh tokens in Phase 1. Phase 0 only establishes connectivity.
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
