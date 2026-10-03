import assert from 'node:assert/strict';
import prisma from '../../prismaClient.js';
import { id } from '../medications/access.js';
import { interactions } from '../../../prisma/seed.js';

try {
  const rows = await prisma.drugInteraction.findMany({ orderBy: { id: 'asc' } });
  for (const expected of interactions) assert.ok(rows.some((row) => Object.entries(expected).every(([key, value]) => row[key] === value)), `Missing reviewed seed pair: ${expected.medicineNameA}/${expected.medicineNameB}`);
  console.log(JSON.stringify({ verifiedSeedPairs: interactions.length, rows }, null, 2));
  if (process.argv.length !== 2 && process.argv.length !== 4) throw new Error('Usage: node src/routes/chat/verify-stored.mjs [conversationId patientId]');
  if (process.argv[2]) {
    const conversationId = id(process.argv[2]), patientId = id(process.argv[3]);
    await prisma.aiChatConversation.findFirstOrThrow({ where: { id: conversationId, userId: patientId } });
    const messages = await prisma.aiChatMessage.findMany({ where: { conversationId }, orderBy: { id: 'asc' } });
    assert.ok(messages.length > 0);
    assert.ok(messages.every((row) => row.disclaimerShown === true));
    const flags = await prisma.medicationInteractionFlag.findMany({ where: { patientId }, include: { interaction: true } });
    assert.ok(flags.some((flag) => flag.interaction.medicineNameA === 'simvastatin' && flag.interaction.medicineNameB === 'clarithromycin'));
    console.log(JSON.stringify({ conversationId, patientId, allDisclaimersTrue: true, messages, flags }, null, 2));
  }
} catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
