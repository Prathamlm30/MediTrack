import prisma from '../../prismaClient.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';

const viewPermission = checkPermission('view_only');
const alertPermission = checkPermission('alerts_only');

// Phase 2 defines separate view and alert capabilities. Try each through the
// existing middleware; only a permission denial may fall back to alert access.
export async function authorizeCaregiver(req, res, next) {
  if (Number(req.patientId ?? req.params.patientId) === req.user.id) {
    throw new HttpError(403, 'Use the patient dashboard for your own data.');
  }
  try { await viewPermission(req, res, () => {}); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    await alertPermission(req, res, () => {});
  }
  next();
}

export async function listCaregiverPatients(req, res) {
  // Explicit projection avoids serializing credentials/private profile fields
  // from the roadmap's patient relation. Cards contain identity, not health data.
  const links = await prisma.caregiverPatientLink.findMany({
    where: { caregiverId: req.user.id, status: 'active' },
    include: { patient: { select: { id: true, fullName: true } } }, orderBy: { id: 'asc' },
  });
  const patients = [];
  const seen = new Set();
  for (const link of links) {
    if (seen.has(link.patientId) || link.patientId === req.user.id) continue;
    seen.add(link.patientId);
    const scoped = { user: req.user, params: { patientId: String(link.patientId) } };
    try { await authorizeCaregiver(scoped, res, () => {}); }
    catch (error) {
      if (error instanceof HttpError && error.status === 403) continue; // Revoked since enumeration.
      throw error;
    }
    patients.push({ patient: link.patient, relationshipType: scoped.caregiverPatientLink.relationshipType,
      permissionLevel: scoped.caregiverPatientLink.permissionLevel, readOnly: true });
  }
  return { patients };
}

