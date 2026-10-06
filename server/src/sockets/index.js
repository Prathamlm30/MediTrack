import prisma from '../prismaClient.js';

// Same JWT-authenticated user rooms as the existing events. No subscription
// room supplied by a client, health values, or audit writes are involved.
export function dataChangeEmitters(io) {
  return {
    async emitDataChanged({ patientId, resource, id, action }) {
      const payload = { patientId, resource, id, action };
      try {
        io.to(`user:${patientId}`).emit('data-changed', payload);
        const where = { patientId, status: 'active', permissionLevel: { in: ['full_access', 'view_only'] } };
        const links = await prisma.caregiverPatientLink.findMany({ where,
          select: { caregiverId: true }, distinct: ['caregiverId'] });
        for (const { caregiverId } of links) {
          if (caregiverId === patientId) continue;
          // Re-check each recipient immediately before emit, even if a link
          // changed after the write or while other recipients were processed.
          if (await prisma.caregiverPatientLink.findFirst({ where: { ...where, caregiverId }, select: { id: true } })) {
            io.to(`user:${caregiverId}`).emit('data-changed', payload);
          }
        }
      } catch (error) {
        // The write is already committed. A socket/lookup outage cannot turn
        // it into a failed HTTP write, nor authorize a caregiver by fallback.
        console.error('Data-change delivery failed:', error.code || error.name);
      }
    },
  };
}

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
