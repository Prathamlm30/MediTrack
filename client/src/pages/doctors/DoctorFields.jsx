import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
export const doctorFields = ['doctorName', 'specialization', 'clinicHospitalName', 'contactNumber', 'address'];
const labels = ['Doctor name', 'Specialization', 'Clinic or hospital', 'Contact number', 'Address'];
export default function DoctorFields({ value, onChange }) {
  return doctorFields.map((key, index) => <Field key={key} label={labels[index]} required={key === 'doctorName'}><TextInput value={value[key] ?? ''} maxLength={2000} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></Field>);
}
