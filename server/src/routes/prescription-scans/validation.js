import { MedicineForm, TrackingType } from '@prisma/client';
import { HttpError } from '../../services/authErrors.js';

export const medicineForms = Object.values(MedicineForm);
export const trackingTypes = Object.values(TrackingType);
const fail = (message) => { throw new HttpError(400, message); };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
function text(value, name, required = false) {
  if (value == null || value === '') { if (required) fail(`${name} is required.`); return null; }
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) fail(`Invalid ${name}.`);
  return value.trim() || null;
}
function date(value, name, required = false) {
  if (!value && !required) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} must be YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`Invalid ${name}.`);
  return parsed;
}
export function confirmData(body) {
  if (!object(body) || body.reviewed !== true) fail('Confirm that you reviewed the prescription.');
  if (!object(body.doctor) || !Array.isArray(body.medicines) || body.medicines.length < 1 || body.medicines.length > 30) {
    fail('A doctor and 1–30 reviewed medicines are required.');
  }
  const doctor = Object.fromEntries(['doctorName', 'specialization', 'clinicHospitalName', 'contactNumber', 'address']
    .map((key) => [key, text(body.doctor[key], key, key === 'doctorName')]));
  const medicines = body.medicines.map((m) => {
    if (!object(m) || !medicineForms.includes(m.medicineForm) || !trackingTypes.includes(m.trackingType)) fail('Select a valid medicine form and tracking type.');
    if (!['number', 'string'].includes(typeof m.dosageAmount) || !/^\d{1,4}(\.\d{1,2})?$/.test(String(m.dosageAmount)) || Number(m.dosageAmount) <= 0) fail('Dose must be positive with at most 2 decimal places (maximum 9999.99).');
    const startDate = date(m.startDate, 'startDate', true);
    const endDate = date(m.endDate, 'endDate');
    if (endDate && endDate < startDate) fail('End date cannot precede start date.');
    return { medicineName: text(m.medicineName, 'medicineName', true), genericName: text(m.genericName, 'genericName'),
      medicineForm: m.medicineForm, trackingType: m.trackingType, dosageAmount: String(m.dosageAmount),
      dosageUnit: text(m.dosageUnit, 'dosageUnit', true), frequencyText: text(m.frequencyText, 'frequencyText', true),
      instructions: text(m.instructions, 'instructions'), startDate, endDate };
  });
  return { doctor, medicines };
}

export function validateExtraction(data) {
  if (!object(data) || !object(data.doctor) || !Array.isArray(data.medicines) || data.medicines.length > 30
    || typeof data.ocrRawText !== 'string' || data.ocrRawText.length > 100000
    || (data.ocrConfidenceScore !== null && (typeof data.ocrConfidenceScore !== 'number'
      || !Number.isFinite(data.ocrConfidenceScore) || data.ocrConfidenceScore < 0 || data.ocrConfidenceScore > 1))) throw new Error('Invalid OCR contract');
  for (const m of data.medicines) {
    if (!object(m) || (m.medicineForm !== null && !medicineForms.includes(m.medicineForm))) throw new Error('Invalid OCR medicine form');
  }
  return data;
}
