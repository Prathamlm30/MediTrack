import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { API_BASE_URL, request } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import Select from '../../components/Select.jsx';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import Checkbox from '../../components/Checkbox.jsx';
import s from './PrescriptionScans.module.css';

const base = '/api/prescription-scans';
const doctorFields = [['doctorName', 'Doctor name'], ['specialization', 'Specialization'],
  ['clinicHospitalName', 'Clinic or hospital'], ['contactNumber', 'Contact number'], ['address', 'Address']];
const medicineFields = [['medicineName', 'Medicine name'], ['genericName', 'Generic name'],
  ['dosageAmount', 'Dose amount'], ['dosageUnit', 'Dose unit'], ['frequencyText', 'Frequency'], ['instructions', 'Instructions and duration']];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blankMedicine = () => ({ medicineName: '', genericName: '', medicineForm: '', dosageAmount: '',
  dosageUnit: '', frequencyText: '', instructions: '', trackingType: '', startDate: today(), endDate: '' });

export function UploadPrescription() {
  const { session } = useAuth();
  const { patients } = useActivePatient();
  const [patientId, setPatientId] = useState(session.user.id);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  async function upload(event) {
    event.preventDefault(); setError('');
    if (!file || !['image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError('Choose a JPEG or PNG image up to 10 MB.'); return;
    }
    setBusy(true);
    try {
      const body = new FormData(); body.append('image', file); body.append('patientId', patientId);
      const result = await request(base, { method: 'POST', body });
      navigate(`/prescription-scans/${result.scanId}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={s.page}><PageHeader title="Scan a prescription" description="Upload a clear photo, then review every detail before saving your medicines." />
    <Banner>Every scan needs your review. Recognition accuracy on photographed or handwritten prescriptions is not established.</Banner>
    <form className={s.card} onSubmit={upload}>
      <Field label="Prescription for"><Select value={patientId} disabled={busy} onChange={(e) => setPatientId(e.target.value)}>
        <option value={session.user.id}>Me · {session.user.fullName}</option>
        {patients.filter((p) => p.permissionLevel === 'full_access').map((p) => <option key={p.patient.id} value={p.patient.id}>{p.patient.fullName}</option>)}
      </Select></Field>
      <Field label="Prescription image" required help="JPEG or PNG, up to 10 MB. Keep the whole prescription visible.">
        <TextInput type="file" accept="image/jpeg,image/png" disabled={busy} onChange={(e) => setFile(e.target.files[0] || null)} />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
      <Button type="submit" loading={busy}>Upload and scan</Button>
    </form></div>;
}

export function ReviewPrescription() {
  const { id } = useParams();
  return <Review key={id} id={id} />;
}
function Review({ id }) {
  const { session } = useAuth();
  const [scan, setScan] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting for scan updates…');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    let revision = 0;
    async function load() {
      const current = ++revision;
      try {
        const data = await request(`${base}/${id}`);
        if (!live || current !== revision) return;
        setScan(data); setError('');
        if (data.scanStatus === 'needs_review') setDraft((old) => old || {
          doctor: data.ocrExtractedData.doctor,
          medicines: data.ocrExtractedData.medicines.map((m) => ({ ...blankMedicine(), ...m })),
        });
      } catch (err) {
        if (live && current === revision) {
          setError(err.message);
          if ([403, 404].includes(err.status)) { setScan(null); setDraft(null); }
        }
      }
    }
    const socket = io(API_BASE_URL, { auth: { token: session.accessToken } });
    socket.on('connect', () => { setConnection('Connected for scan updates.'); void load(); });
    socket.on('scan-complete', ({ scanId }) => { if (String(scanId) === id) void load(); });
    socket.on('disconnect', () => setConnection('Connection lost. Reconnecting…'));
    socket.on('connect_error', () => setConnection('Live updates unavailable. Use Refresh status to check the scan.'));
    void load(); // Covers a completed scan opened later or a missed event.
    return () => { live = false; socket.disconnect(); };
  }, [id, session.accessToken, reload]);
  const updateDoctor = (key, value) => { setReviewed(false); setDraft((d) => ({ ...d, doctor: { ...d.doctor, [key]: value } })); };
  const updateMedicine = (index, key, value) => { setReviewed(false); setDraft((d) => ({ ...d, medicines: d.medicines.map((m, i) => i === index ? { ...m, [key]: value } : m) })); };
  async function confirm(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await request(`${base}/${id}/confirm`, { method: 'POST', body: { ...draft, reviewed } });
      setScan((old) => ({ ...old, ...result.scan }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const confidence = scan?.ocrExtractedData?.nativeConfidence ?? (scan?.ocrConfidenceScore == null ? null : Number(scan.ocrConfidenceScore));
  return <div className={s.page}><PageHeader title="Review & confirm" description={`Prescription scan #${id}`} action={<Link to="/prescription-scans">Upload another</Link>} />
    {error && <Banner tone="danger">{error}</Banner>}
    {(!scan || scan.scanStatus === 'processing' || error) && <div className={s.card}>
      <p role="status">{scan ? 'Reading your prescription. This usually takes several seconds.' : 'Loading prescription…'}</p>
      <p>{connection}</p><Button variant="secondary" onClick={() => setReload((r) => r + 1)}>Refresh status</Button>
    </div>}
    {scan?.scanStatus === 'failed' && <Banner tone="danger">This image could not be processed. Upload a clearer photo or retry when the scanning service is available.</Banner>}
    {scan?.scanStatus === 'completed' && <Banner>Confirmed. Your doctor and {scan.ocrExtractedData.confirmedMedicationIds.length} medicine records have been saved.</Banner>}
    {scan?.scanStatus === 'needs_review' && draft && <>
      <Banner>Check the image against every field. Correct missing or incorrect details before confirming.</Banner>
      {(confidence === null || confidence < 0.95) && <Banner tone="warning">Low recognition confidence{confidence !== null ? ` (${(confidence * 100).toFixed(1)}%)` : ''}. Check names, doses, and frequency especially carefully.</Banner>}
      {!scan.canConfirm && <Banner>You can view this prescription. Full access is required to edit and confirm it.</Banner>}
      <div className={s.review}>
        <aside className={s.source}><img src={scan.imageReadUrl} alt="Uploaded prescription to compare with the extracted fields" referrerPolicy="no-referrer" />
          <details><summary>Recognized text{confidence !== null ? ` · ${(confidence * 100).toFixed(1)}% confidence` : ''}</summary><pre>{scan.ocrRawText}</pre></details>
        </aside>
        <form className={s.form} onSubmit={confirm}>
          <fieldset className={s.card} disabled={busy || !scan.canConfirm}><legend>Doctor</legend><div className={s.fields}>
            {doctorFields.map(([key, label]) => <Field key={key} label={label} required={key === 'doctorName'}><TextInput value={draft.doctor[key] ?? ''} maxLength={2000} onChange={(e) => updateDoctor(key, e.target.value)} /></Field>)}
          </div></fieldset>
          {draft.medicines.map((m, index) => <fieldset className={s.card} key={index} disabled={busy || !scan.canConfirm}>
            <legend>Medicine {index + 1}</legend><div className={s.fields}>
              {medicineFields.map(([key, label]) => <Field key={key} label={label} required={['medicineName', 'dosageAmount', 'dosageUnit', 'frequencyText'].includes(key)}>
                <TextInput value={m[key] ?? ''} type={key === 'dosageAmount' ? 'number' : 'text'} min={key === 'dosageAmount' ? '0.01' : undefined} max={key === 'dosageAmount' ? '9999.99' : undefined} step={key === 'dosageAmount' ? '0.01' : undefined}
                  onChange={(e) => updateMedicine(index, key, e.target.value)} />
              </Field>)}
              <Field label="Medicine form" required><Select value={m.medicineForm ?? ''} onChange={(e) => updateMedicine(index, 'medicineForm', e.target.value)}><option value="">Choose a form</option>{scan.medicineForms.map((f) => <option key={f}>{f}</option>)}</Select></Field>
              <Field label="Inventory tracking" required><Select value={m.trackingType} onChange={(e) => updateMedicine(index, 'trackingType', e.target.value)}><option value="">Choose tracking</option>{scan.trackingTypes.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</Select></Field>
              <Field label="Start date" required><TextInput type="date" value={m.startDate} onChange={(e) => updateMedicine(index, 'startDate', e.target.value)} /></Field>
              <Field label="End date (optional)"><TextInput type="date" value={m.endDate} min={m.startDate} onChange={(e) => updateMedicine(index, 'endDate', e.target.value)} /></Field>
            </div><Button variant="ghost" onClick={() => { setReviewed(false); setDraft((d) => ({ ...d, medicines: d.medicines.filter((_, i) => i !== index) })); }}>Remove medicine {index + 1}</Button>
          </fieldset>)}
          {scan.canConfirm && <div className={s.card}><Button variant="secondary" disabled={busy || draft.medicines.length >= 30} onClick={() => { setReviewed(false); setDraft((d) => ({ ...d, medicines: [...d.medicines, blankMedicine()] })); }}>Add missing medicine</Button>
            <label className={s.check}><Checkbox required checked={reviewed} disabled={busy} onChange={(e) => setReviewed(e.target.checked)} />I checked the doctor, medicines, doses, and dates against the prescription.</label>
            <Button type="submit" loading={busy} disabled={!reviewed || !draft.medicines.length}>Confirm and save medicines</Button>
          </div>}
        </form>
      </div>
    </>}
  </div>;
}
