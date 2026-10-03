import prisma from '../../prismaClient.js';
import { id } from '../medications/access.js';
import { generateAdherenceInsight } from './generation.js';

// Manual equivalent of the dashboard's weekly cached job; available in all
// environments to an operator with server access. No force/duplicate mode.
try {
  if (process.argv.length > 3) throw new Error('Usage: node src/routes/insights/generate.mjs [patientId]');
  const patients = process.argv[2] ? [{ id: id(process.argv[2], 'patientId') }]
    : await prisma.user.findMany({ where: { isActive: true, doseLogsPatient: { some: {} } }, select: { id: true } });
  for (const patient of patients) {
    try { console.log(JSON.stringify({ patientId: patient.id, ...await generateAdherenceInsight(patient.id) })); }
    catch (error) { console.error(JSON.stringify({ patientId: patient.id, error: error.code || error.message })); process.exitCode = 1; }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
