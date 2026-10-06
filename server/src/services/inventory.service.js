import { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import { HttpError } from './authErrors.js';
import { setTimeout as delay } from 'node:timers/promises';

// Serializable retries protect read/modify/write operations across server processes.
export async function inventoryTransaction(work) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error.code !== 'P2034' || attempt >= 4) throw error;
      // Avoid exhausting all retries while the competing transaction is still
      // committing. Keep the same five-attempt bound and retry only P2034.
      await delay(100 * 2 ** attempt + Math.floor(Math.random() * 50));
    }
  }
}

/**
 * doseAmount is already in inventory units: count, mL, or grams. No conversion here.
 * A supplied tx joins the caller's atomic operation; existing three-argument
 * callers retain their own Serializable transaction and retry behavior.
 */
export async function decrementInventory(medicationId, patientId, doseAmount, tx) {
  let amount;
  try { amount = new Prisma.Decimal(doseAmount); } catch { throw new HttpError(400, 'Invalid doseAmount.'); }
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2) throw new HttpError(400, 'doseAmount must be positive with at most two decimal places.');
  const decrement = async (tx) => {
    const rows = await tx.medicineInventory.findMany({ where: { medicationId, patientId } });
    if (!rows.length) throw new HttpError(404, 'Inventory not found.');
    if (rows.length !== 1) throw new HttpError(409, 'Duplicate inventory rows require correction.');
    const row = rows[0];
    return tx.medicineInventory.update({ where: { id: row.id }, data: {
      quantityRemaining: Prisma.Decimal.max(0, row.quantityRemaining.minus(amount)),
    } });
  };
  return tx ? decrement(tx) : inventoryTransaction(decrement);
}
