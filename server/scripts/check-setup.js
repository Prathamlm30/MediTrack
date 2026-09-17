import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import prisma from '../src/prismaClient.js';
import redis from '../src/config/redis.js';
import { requiredEnv } from '../src/config/env.js';

try {
  const expected = Prisma.dmmf.datamodel.models.map((model) => model.dbName || model.name).sort();
  assert.equal(expected.length, 20);
  const tables = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name
  `;
  assert.deepEqual(tables.map((table) => table.table_name), expected);
  console.log(`All ${tables.length} application tables exist:\n${expected.join('\n')}`);

  const columns = await prisma.$queryRaw`
    SELECT column_name, is_nullable, udt_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name IN ('authProvider', 'googleId', 'passwordHash')
  `;
  const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
  assert.equal(byName.passwordHash?.is_nullable, 'YES');
  assert.equal(byName.googleId?.is_nullable, 'YES');
  assert.equal(byName.authProvider?.udt_name, 'AuthProvider');
  assert.equal(byName.authProvider?.is_nullable, 'NO');
  assert.match(byName.authProvider.column_default, /local/);
  const providers = await prisma.$queryRaw`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'AuthProvider' ORDER BY e.enumsortorder
  `;
  assert.deepEqual(providers.map((provider) => provider.enumlabel), ['local', 'google']);
  console.log('Google-auth fields and AuthProvider enum verified.');

  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');
  console.log('Redis: PONG');

  const url = new URL('/health', requiredEnv('OCR_SERVICE_URL'));
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  console.log(`Server-to-OCR HTTP ping: OK (${url})`);
} catch (error) {
  console.error('Phase 0 verification failed:', error.message);
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
