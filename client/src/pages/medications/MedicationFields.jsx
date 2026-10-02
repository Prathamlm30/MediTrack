import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import Select from '../../components/Select.jsx';
import { changeMedicine, medicineForms, trackingTypes } from './medicineForm.js';

const fields = [['medicineName', 'Medicine name'], ['genericName', 'Generic name'], ['dosageAmount', 'Dose amount'], ['dosageUnit', 'Dose unit'], ['frequencyText', 'Frequency'], ['instructions', 'Instructions and duration']];
export default function MedicationFields({ value, onChange }) {
  const update = (key) => (event) => onChange(changeMedicine(value, key, event.target.value));
  return <>
    {fields.map(([key, label]) => <Field key={key} label={label} required={['medicineName', 'dosageAmount', 'dosageUnit', 'frequencyText'].includes(key)}>
      <TextInput value={value[key] ?? ''} maxLength={2000} type={key === 'dosageAmount' ? 'number' : 'text'} min={key === 'dosageAmount' ? '0.01' : undefined} max={key === 'dosageAmount' ? '9999.99' : undefined} step={key === 'dosageAmount' ? '0.01' : undefined} onChange={update(key)} />
    </Field>)}
    <Field label="Medicine form" required><Select value={value.medicineForm ?? ''} onChange={update('medicineForm')}><option value="">Choose a form</option>{medicineForms.map((form) => <option key={form}>{form}</option>)}</Select></Field>
    <Field label="Inventory tracking" required help="Selected from the medicine form. Change it if this medicine needs different tracking."><Select value={value.trackingType ?? ''} onChange={update('trackingType')}><option value="">Choose tracking</option>{trackingTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</Select></Field>
    <Field label="Start date" required><TextInput type="date" value={value.startDate ?? ''} onChange={update('startDate')} /></Field>
    <Field label="End date (optional)"><TextInput type="date" value={value.endDate ?? ''} min={value.startDate} onChange={update('endDate')} /></Field>
  </>;
}
