import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import prisma from '../src/prismaClient.js';
import { inventoryTransaction } from '../src/services/inventory.service.js';

// STATIC, source-backed transcription of explicitly named contraindicated
// combinations. No model calls, generated pairs, class expansion or inference.
// Reviewed against the linked DailyMed prescribing labels on 2026-10-03.
// Scope: these labels' systemic/oral products, not topical formulations.
// Every listed combination is contraindicated in its cited label; the app maps
// that label category to its existing "severe" enum. This is not a complete
// interaction database. Exact ingredient names only; no inferred brand aliases.
const SIM = 'DailyMed simvastatin, Contraindications and sections 5.1, 7.1-7.2: https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=db08460d-5184-42fa-8435-76eefa3569f5&type=display';
const TIZ = 'DailyMed tizanidine, sections 4, 7.1-7.2: https://www.dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=10457e1d-068f-7071-e054-00144ff8d46c&type=display';
const NIT = 'DailyMed nitroglycerin sublingual tablets, sections 4.1, 7.1: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=4e83a438-1ed6-0a86-e063-6294a90adc8c';
const DOF = 'DailyMed dofetilide, Contraindications and Drug-Drug Interactions: https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=28fe0cac-62fd-997d-8065-561aaf1541c4';
const PIM = 'DailyMed pimozide, Contraindications 6-9 and Drug Interactions: https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=70b079e2-a1f7-4a93-8685-d60a4d7c1280';

// Columns: medicineNameA, medicineNameB, severityLevel, description, sourceReference.
export const interactions = [
  ['simvastatin', 'itraconazole', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'ketoconazole', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'posaconazole', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'voriconazole', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'erythromycin', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'clarithromycin', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'telithromycin', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'nefazodone', 'severe', 'Contraindicated: increased simvastatin exposure and risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'gemfibrozil', 'severe', 'Contraindicated: increased risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'cyclosporine', 'severe', 'Contraindicated: increased risk of muscle injury, including rhabdomyolysis.', SIM],
  ['simvastatin', 'danazol', 'severe', 'Contraindicated: increased risk of muscle injury, including rhabdomyolysis.', SIM],
  ['tizanidine', 'fluvoxamine', 'severe', 'Contraindicated: increased tizanidine exposure, low blood pressure, drowsiness and impaired psychomotor function.', TIZ],
  ['tizanidine', 'ciprofloxacin', 'severe', 'Contraindicated: increased tizanidine exposure, low blood pressure, drowsiness and impaired psychomotor function.', TIZ],
  ['nitroglycerin', 'avanafil', 'severe', 'Contraindicated: potentially severe blood-pressure reduction, fainting or myocardial ischemia.', NIT],
  ['nitroglycerin', 'sildenafil', 'severe', 'Contraindicated: potentially severe blood-pressure reduction, fainting or myocardial ischemia.', NIT],
  ['nitroglycerin', 'tadalafil', 'severe', 'Contraindicated: potentially severe blood-pressure reduction, fainting or myocardial ischemia.', NIT],
  ['nitroglycerin', 'vardenafil', 'severe', 'Contraindicated: potentially severe blood-pressure reduction, fainting or myocardial ischemia.', NIT],
  ['nitroglycerin', 'riociguat', 'severe', 'Contraindicated: combined use can cause low blood pressure.', NIT],
  ['dofetilide', 'verapamil', 'severe', 'Contraindicated: increased dofetilide exposure and risk of torsade de pointes.', DOF],
  ['dofetilide', 'cimetidine', 'severe', 'Contraindicated: increased dofetilide exposure and risk of dangerous QT prolongation.', DOF],
  ['dofetilide', 'trimethoprim', 'severe', 'Contraindicated: increased dofetilide exposure and risk of dangerous QT prolongation.', DOF],
  ['dofetilide', 'ketoconazole', 'severe', 'Contraindicated: increased dofetilide exposure and risk of dangerous QT prolongation.', DOF],
  ['dofetilide', 'hydrochlorothiazide', 'severe', 'Contraindicated: increased dofetilide exposure and QT prolongation.', DOF],
  ['pimozide', 'clarithromycin', 'severe', 'Contraindicated: impaired pimozide metabolism and ventricular arrhythmia risk; sudden deaths reported.', PIM],
  ['pimozide', 'erythromycin', 'severe', 'Contraindicated: impaired pimozide metabolism and ventricular arrhythmia risk.', PIM],
  ['pimozide', 'itraconazole', 'severe', 'Contraindicated: inhibited CYP3A4 can impair pimozide metabolism, increasing cardiac risk.', PIM],
  ['pimozide', 'ketoconazole', 'severe', 'Contraindicated: inhibited CYP3A4 can impair pimozide metabolism, increasing cardiac risk.', PIM],
  ['pimozide', 'citalopram', 'severe', 'Contraindicated: combined use increases QT prolongation.', PIM],
  ['pimozide', 'paroxetine', 'severe', 'Contraindicated: CYP2D6 inhibition increases pimozide exposure.', PIM],
  ['pimozide', 'sertraline', 'severe', 'Contraindicated combination according to the pimozide prescribing label.', PIM],
].map(([medicineNameA, medicineNameB, severityLevel, description, sourceReference]) => ({ medicineNameA, medicineNameB, severityLevel, description, sourceReference }));

// Run once via npx prisma db seed. Accidental reruns validate existing rows and
// insert nothing when all 30 are present; never silently rewrite reviewed data.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const keys = new Set(interactions.map((row) => [row.medicineNameA, row.medicineNameB].sort().join('|')));
    if (keys.size !== 30 || interactions.some((row) => !row.sourceReference.includes('https://'))) throw new Error('Invalid static seed.');
    const created = await inventoryTransaction(async (db) => {
      let count = 0;
      for (const data of interactions) {
        const matches = await db.drugInteraction.findMany({ where: { OR: [
          { medicineNameA: { equals: data.medicineNameA, mode: 'insensitive' }, medicineNameB: { equals: data.medicineNameB, mode: 'insensitive' } },
          { medicineNameA: { equals: data.medicineNameB, mode: 'insensitive' }, medicineNameB: { equals: data.medicineNameA, mode: 'insensitive' } },
        ] } });
        if (matches.length > 1 || matches.some((row) => ['severityLevel', 'description', 'sourceReference'].some((field) => row[field] !== data[field]))) {
          throw new Error(`Existing interaction requires manual review: ${data.medicineNameA} / ${data.medicineNameB}`);
        }
        if (!matches.length) { await db.drugInteraction.create({ data }); count++; }
      }
      return count;
    });
    console.log(JSON.stringify({ created, verifiedStaticPairs: interactions.length, totalRows: await prisma.drugInteraction.count() }));
  } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
