// Run: node --test src/routes/medications/phase5.integration.test.js (from server)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { MedicineForm } from '@prisma/client';
import app from '../../app.js';
import prisma from '../../prismaClient.js';
import { requiredEnv } from '../../config/env.js';
import { trackingByForm, reviewMedicine, changeMedicine } from '../../../../client/src/pages/medications/medicineForm.js';

test('all Prisma medicine forms have defaults; initialization and human overrides', () => {
  assert.deepEqual(Object.keys(trackingByForm).sort(), Object.values(MedicineForm).sort());
  for (const form of Object.values(MedicineForm)) {
    const review = reviewMedicine({ medicineForm: form });
    assert.equal(review.trackingType, trackingByForm[form]);
    const overridden = changeMedicine(review, 'trackingType', 'weight_grams');
    assert.equal(reviewMedicine(overridden).trackingType, 'weight_grams');
    assert.equal(changeMedicine(overridden, 'instructions', 'Reviewed').trackingType, 'weight_grams');
    assert.equal(changeMedicine(overridden, 'medicineForm', 'syrup').trackingType, 'volume_ml');
  }
});

test('Phase 5 real CRUD, ownership, caregiver permissions, joins and provenance', async () => {
  const users = []; let server;
  try {
    for (const name of ['Patient', 'Other', 'Caregiver']) users.push(await prisma.user.create({ data: { fullName: name, email: `phase5-${randomUUID()}@example.test`, emailVerified: true } }));
    const [patient, other, caregiver] = users;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(path, method = 'GET', body, expected = 200, user = patient) {
      const token = user && jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(user.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m' });
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
      const raw = await response.text(); assert.equal(response.status, expected, `${method} ${path}: ${raw}`);
      return raw ? JSON.parse(raw) : null;
    }
    await call('/medications', 'GET', undefined, 401, null);
    await call('/doctors', 'GET', undefined, 401, null);
    const doctor = await call('/doctors', 'POST', { doctorName: 'Phase Five Doctor', specialization: 'General', contactNumber: '123', address: 'Test address', clinicHospitalName: 'Test clinic' }, 201);
    assert.equal(doctor.source, 'manual');
    assert.equal((await call('/doctors')).doctors.length, 1);
    assert.equal((await call(`/doctors/${doctor.id}`, 'PATCH', { doctorName: 'Updated Doctor' })).doctorName, 'Updated Doctor');
    const foreignDoctor = await call('/doctors', 'POST', { doctorName: 'Other doctor' }, 201, other);
    const meds = [];
    for (const [form, expected] of [['tablet', 'countable'], ['syrup', 'volume_ml'], ['ointment', 'weight_grams']]) {
      const input = { medicineName: `Test ${form}`, medicineForm: form, trackingType: trackingByForm[form], dosageAmount: '1.25', dosageUnit: 'unit', frequencyText: 'Once daily', startDate: '2026-10-02', doctorId: doctor.id };
      const med = await call('/medications', 'POST', input, 201); meds.push(med);
      const read = await call(`/medications/${med.id}`);
      assert.equal(read.trackingType, expected); assert.equal(read.addedVia, 'manual'); assert.equal(read.doctor.id, doctor.id);
      console.log(`Persisted ${form} -> ${read.trackingType}`);
    }
    const med = meds[0];
    assert.equal((await call('/medications?status=active')).medications.length, 3);
    assert.equal((await call(`/medications/${med.id}`, 'PATCH', { trackingType: 'weight_grams', instructions: 'Human override' })).trackingType, 'weight_grams');
    await call(`/medications/${med.id}`, 'PATCH', { doctorId: foreignDoctor.id }, 400);
    for (const body of [{ trackingType: '' }, { dosageAmount: 0 }, { dosageAmount: '10000' }, { dosageAmount: '1.234' }, { medicineForm: 'unknown' }, { endDate: '2026-01-01' }, { startDate: '2026-02-30' }, { status: 'invalid' }, { status: null }, { endDate: false }, { endDate: 0 }, { patientId: other.id }, { addedVia: 'ocr_scan' }]) await call(`/medications/${med.id}`, 'PATCH', body, 400);
    await call('/medications?status=unknown', 'GET', undefined, 400);
    await call('/medications?patientId=0', 'GET', undefined, 400);
    await call('/medications/nope', 'GET', undefined, 400);
    await call('/doctors', 'POST', { doctorName: '   ' }, 400);
    await call(`/doctors/${doctor.id}`, 'PATCH', { source: 'ocr_scan' }, 400);
    for (const resource of [`/medications/${med.id}`, `/doctors/${doctor.id}`]) {
      for (const method of ['GET', 'PATCH', 'DELETE']) await call(resource, method, method === 'PATCH' ? {} : undefined, 403, other);
    }
    for (const resource of ['medications', 'doctors']) {
      await call(`/${resource}?patientId=${patient.id}`, 'GET', undefined, 403, other);
      await call(`/${resource}`, 'POST', { patientId: patient.id }, 403, other);
    }
    const link = await prisma.caregiverPatientLink.create({ data: { patientId: patient.id, caregiverId: caregiver.id, relationshipType: 'family', permissionLevel: 'view_only', status: 'active', invitedByUserId: patient.id } });
    for (const resource of ['medications', 'doctors']) {
      assert.equal((await call(`/${resource}?patientId=${patient.id}`, 'GET', undefined, 200, caregiver)).canEdit, false);
      await call(`/${resource}`, 'POST', { patientId: patient.id }, 403, caregiver);
    }
    await call(`/medications/${med.id}`, 'GET', undefined, 200, caregiver);
    await call(`/medications/${med.id}`, 'PATCH', {}, 403, caregiver);
    await call(`/doctors/${doctor.id}`, 'DELETE', undefined, 403, caregiver);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'alerts_only' } });
    for (const resource of [`/medications/${med.id}`, `/doctors/${doctor.id}`, `/medications?patientId=${patient.id}`, `/doctors?patientId=${patient.id}`]) await call(resource, 'GET', undefined, 403, caregiver);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'full_access' } });
    assert.equal((await call(`/medications/${med.id}`, 'PATCH', { status: 'completed' }, 200, caregiver)).status, 'completed');
    await call(`/doctors/${doctor.id}`, 'PATCH', { address: 'Caregiver edit' }, 200, caregiver);
    const cgDoctor = await call('/doctors', 'POST', { patientId: patient.id, doctorName: 'Caregiver added' }, 201, caregiver);
    await call(`/doctors/${cgDoctor.id}`, 'DELETE', undefined, 204, caregiver);
    // Populated joined detail, including corrupt cross-patient relation fixtures.
    const schedules = [];
    for (let i = 0; i < 2; i++) schedules.push(await prisma.medicationSchedule.create({ data: { medicationId: med.id, timeOfDay: new Date('1970-01-01T08:00:00Z'), daysOfWeek: '0,1,2,3,4,5,6', doseAmount: 1 } }));
    await prisma.doseLog.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ patientId: patient.id, scheduleId: schedules[i % 2].id, scheduledDatetime: new Date(Date.UTC(2026, 8, i + 1)), status: 'taken' })) });
    await prisma.doseLog.create({ data: { patientId: other.id, scheduleId: schedules[0].id, scheduledDatetime: new Date('2026-12-01') } });
    for (const person of [patient, other]) {
      await prisma.medicineInventory.create({ data: { patientId: person.id, medicationId: med.id, quantityUnit: 'tablets', quantityTotal: 30, quantityRemaining: 10, refillThreshold: 5, refillAmount: 30 } });
      await prisma.aiInsight.create({ data: { patientId: person.id, relatedMedicationId: med.id, insightType: 'adherence_pattern', insightText: 'Fixture insight' } });
    }
    const detail = await call(`/medications/${med.id}`);
    assert.equal(detail.schedules.length, 2); assert.equal(detail.inventory.length, 1); assert.equal(detail.aiInsights.length, 1);
    assert.equal(detail.doseLogs.length, 20); assert.equal(detail.schedules.flatMap((s) => s.doseLogs).length, 20);
    assert.ok(detail.doseLogs.every((row) => row.patientId === patient.id));
    assert.equal(detail.doseLogs[0].scheduledDatetime, '2026-09-25T00:00:00.000Z');
    // Phase 4 review still requires human confirmation and accepts an override.
    const scan = await prisma.prescriptionScan.create({ data: { patientId: patient.id, imageUrl: 'test-only', scanStatus: 'needs_review', ocrExtractedData: {} } });
    const review = { reviewed: true, doctor: { doctorName: 'OCR Doctor' }, medicines: [{ ...reviewMedicine({ medicineForm: 'syrup' }), medicineName: 'OCR syrup', dosageAmount: '5', dosageUnit: 'ml', frequencyText: 'Daily', trackingType: 'countable' }] };
    await call(`/prescription-scans/${scan.id}/confirm`, 'POST', { ...review, reviewed: false }, 400);
    const confirmed = await call(`/prescription-scans/${scan.id}/confirm`, 'POST', review);
    assert.equal(confirmed.medications[0].trackingType, 'countable');
    assert.equal((await call(`/medications/${confirmed.medications[0].id}`, 'PATCH', { instructions: 'Edited manually' })).addedVia, 'ocr_scan');
    assert.equal((await call(`/doctors/${confirmed.doctor.id}`, 'PATCH', { specialization: 'Updated' })).source, 'ocr_scan');
    await call(`/prescription-scans/${scan.id}/confirm`, 'POST', review, 409);
    await call(`/doctors/${confirmed.doctor.id}`, 'DELETE', undefined, 204);
    assert.equal((await prisma.prescriptionScan.findUnique({ where: { id: scan.id } })).doctorId, null);
    await call(`/doctors/${doctor.id}`, 'DELETE', undefined, 204);
    await call(`/doctors/${doctor.id}`, 'GET', undefined, 404);
    assert.equal((await call(`/medications/${med.id}`)).doctorId, null);
    for (const medication of meds) assert.equal((await call(`/medications/${medication.id}`, 'DELETE')).status, 'discontinued');
    assert.equal((await call('/medications?status=discontinued')).medications.length, 3);
    assert.equal((await call(`/medications/${med.id}`)).doseLogs.length, 20);
    console.log('CRUD, permissions, validation, joined detail, soft deletion, and OCR provenance verified.');
    const curlToken = jwt.sign({ kind: 'access' }, requiredEnv('JWT_ACCESS_SECRET'), { algorithm: 'HS256', subject: String(patient.id), issuer: 'meditrack', audience: 'meditrack', expiresIn: '5m' });
    const curl = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./verify-crud.ps1', import.meta.url)), '-Base', base.replace(/\/api$/, '')], { env: { ...process.env, MEDITRACK_ACCESS_TOKEN: curlToken }, windowsHide: true });
    console.log(curl.stdout.trim());

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await prisma.prescriptionScan.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.aiInsight.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.medicineInventory.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.doseLog.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.medicationSchedule.deleteMany({ where: { medication: { patientId: { in: ids } } } });
      await prisma.medication.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.doctor.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.caregiverPatientLink.deleteMany({ where: { patientId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  }
});
