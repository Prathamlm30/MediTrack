import prisma from '../prismaClient.js';

// io belongs to installScanRuntime: reuse its JWT middleware and user rooms.
export function escalationEmitters(io) {
  return {
    async emitMissedDoseAlert(caregiverId, payload) {
      // Recheck permission immediately before disclosing health data. A link
      // may have been revoked after the escalation transaction committed.
      const link = await prisma.caregiverPatientLink.findFirst({ where: {
        patientId: payload.patientId, caregiverId, status: 'active',
        permissionLevel: { in: ['full_access', 'alerts_only'] }, caregiver: { isActive: true },
      } });
      if (link) io.to(`user:${caregiverId}`).emit('missed-dose-alert', payload);
    },
    async emitDoseReminder(patientId, payload) {
      const patient = await prisma.user.findUnique({ where: { id: patientId }, select: { isActive: true } });
      if (patient?.isActive) io.to(`user:${patientId}`).emit('dose-reminder', payload);
    },
  };
}
