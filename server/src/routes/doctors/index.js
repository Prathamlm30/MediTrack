import { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { doctorData } from '../prescription-scans/validation.js';
import { patientScope, canEdit, loadResource, bodyFields } from '../medications/access.js';

const router = Router();
const fields = ['doctorName', 'specialization', 'clinicHospitalName', 'contactNumber', 'address'];
router.use(verifyJWT, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/', patientScope, checkPermission('view_only'), async (req, res) => {
  res.json({ doctors: await prisma.doctor.findMany({ where: { patientId: req.patientId }, orderBy: [{ doctorName: 'asc' }, { id: 'asc' }] }), canEdit: canEdit(req) });
});
router.post('/', patientScope, checkPermission('full_access'), async (req, res) => {
  bodyFields(req.body, [...fields, 'patientId']);
  res.status(201).json(await prisma.doctor.create({ data: { ...doctorData(req.body), patientId: req.patientId, source: 'manual' } }));
});
router.get('/:id', loadResource('doctor'), checkPermission('view_only'), (req, res) => res.json({ ...req.record, canEdit: canEdit(req) }));
router.patch('/:id', loadResource('doctor'), checkPermission('full_access'), async (req, res) => {
  bodyFields(req.body, fields);
  res.json(await prisma.doctor.update({ where: { id: req.record.id }, data: doctorData({ ...req.record, ...req.body }) }));
});
router.delete('/:id', loadResource('doctor'), checkPermission('full_access'), async (req, res) => {
  // Optional doctor relations are SetNull in the authoritative schema. Deleting
  // a doctor preserves the patient's medications and original scan records.
  await prisma.doctor.delete({ where: { id: req.record.id } });
  res.status(204).end();
});
export default router;
