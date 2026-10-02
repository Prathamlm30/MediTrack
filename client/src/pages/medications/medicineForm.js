// Shared by manual entry and OCR review. These are defaults, not restrictions:
// a reviewed trackingType override is preserved until medicineForm changes.
export const trackingByForm = Object.freeze({
  tablet: 'countable', capsule: 'countable', injection: 'countable', inhaler: 'countable', patch: 'countable', other: 'countable',
  syrup: 'volume_ml', liquid: 'volume_ml', drops: 'volume_ml', spray: 'volume_ml',
  ointment: 'weight_grams', cream: 'weight_grams', powder: 'weight_grams',
});
export const medicineForms = ['tablet', 'capsule', 'syrup', 'liquid', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'patch', 'powder', 'spray', 'other'];
export const trackingTypes = ['countable', 'volume_ml', 'weight_grams'];
export function blankMedicine() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { medicineName: '', genericName: '', medicineForm: '', trackingType: '', dosageAmount: '', dosageUnit: '', frequencyText: '', instructions: '', startDate: today, endDate: '' };
}
export function reviewMedicine(value) {
  return { ...blankMedicine(), ...value, trackingType: value.trackingType || trackingByForm[value.medicineForm] || '' };
}
export function changeMedicine(value, key, next) {
  return { ...value, [key]: next, ...(key === 'medicineForm' ? { trackingType: trackingByForm[next] || '' } : {}) };
}
