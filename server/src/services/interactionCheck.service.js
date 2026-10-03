import { inventoryTransaction } from './inventory.service.js';

const names = (medication) => [...new Set([medication.medicineName, medication.genericName]
  .filter(Boolean).map((name) => name.trim().toLowerCase()))];

// Caller passes its medication-creation transaction, so creation and flags commit
// together. Standalone checks use the existing Serializable/retry helper.
export async function checkMedicationInteractions(medicationId, tx) {
  if (!tx) return inventoryTransaction((db) => checkMedicationInteractions(medicationId, db));
  const medication = await tx.medication.findUniqueOrThrow({ where: { id: medicationId } });
  if (medication.status !== 'active') return [];
  const others = await tx.medication.findMany({ where: { patientId: medication.patientId, status: 'active', id: { not: medicationId } } });
  const ownNames = names(medication);
  // This service ONLY READS DrugInteraction. Never import a model or AI helper.
  const interactions = await tx.drugInteraction.findMany({ where: { OR: ownNames.flatMap((name) => [
    { medicineNameA: { equals: name, mode: 'insensitive' } },
    { medicineNameB: { equals: name, mode: 'insensitive' } },
  ]) } });
  const flags = [];
  for (const other of others) {
    const otherNames = names(other);
    for (const interaction of interactions) {
      const a = interaction.medicineNameA.trim().toLowerCase(), b = interaction.medicineNameB.trim().toLowerCase();
      if (!(ownNames.includes(a) && otherNames.includes(b)) && !(ownNames.includes(b) && otherNames.includes(a))) continue;
      const [medicationId1, medicationId2] = [medication.id, other.id].sort((x, y) => x - y);
      const where = { patientId: medication.patientId, interactionId: interaction.id, OR: [
        { medicationId1, medicationId2 }, { medicationId1: medicationId2, medicationId2: medicationId1 },
      ] };
      // Preserve acknowledged flags; reruns must not resurrect or duplicate them.
      if (!await tx.medicationInteractionFlag.findFirst({ where })) flags.push(await tx.medicationInteractionFlag.create({ data: {
        patientId: medication.patientId, medicationId1, medicationId2, interactionId: interaction.id,
      } }));
    }
  }
  return flags;
}
