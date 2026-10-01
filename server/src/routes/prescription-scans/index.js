import express, { Router } from 'express';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import checkPermission from '../../middleware/checkPermission.js';
import { HttpError } from '../../services/authErrors.js';
import { storage } from './storage.js';
import { confirmData, medicineForms, trackingTypes } from './validation.js';

const router = Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(verifyJWT);

router.post('/', express.raw({ type: 'multipart/form-data', limit: '11mb' }), async (req, res, next) => {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'Use multipart/form-data with an image field.');
  let form;
  try { form = await new Response(req.body, { headers: { 'Content-Type': req.headers['content-type'] } }).formData(); }
  catch { throw new HttpError(400, 'Invalid multipart upload.'); }
  const image = form.get('image');
  if (!image || typeof image.arrayBuffer !== 'function' || form.getAll('image').length !== 1
    || !image.size || image.size > 10 * 1024 * 1024) throw new HttpError(400, 'Upload one JPEG or PNG image up to 10 MB.');
  req.patientId = form.get('patientId') || req.user.id;
  await checkPermission('full_access')(req, res, () => {});
  const bytes = Buffer.from(await image.arrayBuffer());
  const extension = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'jpg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : null;
  if (!extension) throw new HttpError(415, 'The file must contain a JPEG or PNG image.');
  const imageUrl = await storage.save(bytes, extension);
  let scan;
  try {
    scan = await prisma.prescriptionScan.create({ data: { patientId: req.patientId, imageUrl,
      scanStatus: 'processing', ocrExtractedData: { uploadedByUserId: req.user.id } } });
  } catch (error) { await storage.remove(imageUrl).catch(() => {}); throw error; }
  // Respond before scheduling any OCR HTTP call.
  res.status(202).json({ scanId: scan.id, scanStatus: scan.scanStatus });
  setImmediate(() => req.app.locals.scanRuntime?.kick());
});

async function loadScan(req, res, next) {
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) throw new HttpError(400, 'Invalid scan ID.');
  req.scan = await prisma.prescriptionScan.findUnique({ where: { id: Number(req.params.id) } });
  if (!req.scan) throw new HttpError(404, 'Scan not found.');
  req.patientId = req.scan.patientId;
  next();
}
router.get('/:id', loadScan, checkPermission('view_only'), async (req, res) => {
  const { scan } = req;
  res.json({ ...scan, imageReadUrl: storage.readUrl(scan.imageUrl),
    ocrExtractedData: ['needs_review', 'completed'].includes(scan.scanStatus) ? scan.ocrExtractedData : null,
    medicineForms, trackingTypes, canConfirm: req.patientId === req.user.id || req.caregiverPatientLink?.permissionLevel === 'full_access' });
});

router.post('/:id/confirm', loadScan, checkPermission('full_access'), async (req, res) => {
  const reviewed = confirmData(req.body);
  const result = await prisma.$transaction(async (db) => {
    // Atomic status claim serializes simultaneous confirms; failures roll it back.
    const claim = await db.prescriptionScan.updateMany({ where: { id: req.scan.id, scanStatus: 'needs_review' },
      data: { scanStatus: 'completed', reviewedAt: new Date() } });
    if (claim.count !== 1) throw new HttpError(409, 'Only a scan awaiting review can be confirmed; this scan may already be confirmed.');
    const existing = await db.doctor.findFirst({ where: { patientId: req.patientId,
      doctorName: reviewed.doctor.doctorName, clinicHospitalName: reviewed.doctor.clinicHospitalName }, orderBy: { id: 'asc' } });
    const doctorData = { ...reviewed.doctor, patientId: req.patientId, source: 'ocr_scan' };
    const doctor = existing ? await db.doctor.upsert({ where: { id: existing.id }, update: doctorData, create: doctorData })
      : await db.doctor.create({ data: doctorData });
    const medications = [];
    for (const medicine of reviewed.medicines) medications.push(await db.medication.create({ data: {
      ...medicine, patientId: req.patientId, doctorId: doctor.id, addedVia: 'ocr_scan',
    } }));
    const scan = await db.prescriptionScan.update({ where: { id: req.scan.id }, data: { doctorId: doctor.id,
      medicationId: medications[0].id, ocrExtractedData: { ...req.scan.ocrExtractedData,
        confirmedMedicationIds: medications.map((m) => m.id),
        confirmedData: JSON.parse(JSON.stringify(reviewed)) } } });
    return { scan, doctor, medications };
  });
  res.json(result);
});

export default router;
