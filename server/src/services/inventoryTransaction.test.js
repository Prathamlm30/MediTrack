import test from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../prismaClient.js';
import { inventoryTransaction } from './inventory.service.js';

test('serializable writes retry P2034 with a bound and propagate other failures', async () => {
  const conflict = Object.assign(new Error('serialization conflict'), { code: 'P2034' });
  let attempts = 0;
  const original = prisma.$transaction;
  try {
  prisma.$transaction = async (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    if (++attempts < 3) throw conflict;
    return work('committed');
  };
  assert.equal(await inventoryTransaction(async (tx) => tx), 'committed');
  assert.equal(attempts, 3);
  attempts = 0;
  prisma.$transaction = async () => { attempts++; throw conflict; };
  await assert.rejects(inventoryTransaction(async () => {}), (error) => error === conflict);
  assert.equal(attempts, 5);
  attempts = 0;
  const other = new Error('unrelated failure');
  prisma.$transaction = async () => { attempts++; throw other; };
  await assert.rejects(inventoryTransaction(async () => {}), (error) => error === other);
  assert.equal(attempts, 1);
  } finally { prisma.$transaction = original; }
});
