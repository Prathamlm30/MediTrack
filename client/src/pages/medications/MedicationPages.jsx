import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { request } from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Banner from '../../components/Banner.jsx';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Select from '../../components/Select.jsx';
import MedicationFields from './MedicationFields.jsx';
import { blankMedicine } from './medicineForm.js';
import { usePatientScope, useResource, ManagementLinks, Details } from './Management.jsx';
import s from './Management.module.css';

const statuses = ['active', 'completed', 'discontinued'];
export function MedicationList() {
  const { suffix, selector } = usePatientScope();
  const [status, setStatus] = useState('active');
  const [revision, setRevision] = useState(0);
  const { data, error } = useResource(`/api/medications${suffix}${status ? `&status=${status}` : ''}`, revision);
  return <div className={s.page}><PageHeader title="My medications" description="Manage your medicines, doses, and prescribing doctors." /><ManagementLinks suffix={suffix} />
    <div className={s.fields}>{selector}<Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((v) => <option key={v}>{v}</option>)}</Select></Field></div>
    {error ? <Banner tone="danger">{error} <Button onClick={() => setRevision((v) => v + 1)}>Retry</Button></Banner> : !data ? <p role="status">Loading medicines…</p> : <>
      {data.canEdit && <Link to={`/medications/add${suffix}`}>Add medication</Link>}
      {!data.medications.length && <p>No medications match this status.</p>}
      <ul className={s.list}>{data.medications.map((m) => <li className={s.card} key={m.id}><h2><Link to={`/medications/${m.id}${suffix}`}>{m.medicineName}</Link></h2><p>{m.dosageAmount} {m.dosageUnit} · {m.frequencyText}</p><p>{m.status} · {m.doctor?.doctorName || 'No doctor assigned'}</p>{data.canEdit && <Link to={`/medications/${m.id}/edit${suffix}`}>Edit medication</Link>}</li>)}</ul>
    </>}</div>;
}
export function MedicationEdit() {
  const { id } = useParams();
  const { patientId, suffix } = usePatientScope();
  return <MedicationEditor key={`${id || 'new'}:${patientId}`} id={id} patientId={patientId} suffix={suffix} />;
}
function MedicationEditor({ id, patientId, suffix }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => ({ ...blankMedicine(), doctorId: '', status: 'active' }));
  const [loaded, setLoaded] = useState(!id);
  const [allowed, setAllowed] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    (async () => {
      setError(''); setAllowed(false);
      const medication = id ? await request(`/api/medications/${id}`, options) : null;
      const owner = medication?.patientId ?? patientId;
      const result = await request(`/api/doctors?patientId=${encodeURIComponent(owner)}`, options);
      if (controller.signal.aborted) return;
      setDoctors(result.doctors); setAllowed(result.canEdit && (!medication || medication.canEdit));
      if (medication) setDraft({ ...Object.fromEntries(Object.keys(blankMedicine()).map((key) => [key, medication[key] ?? ''])), startDate: medication.startDate.slice(0, 10), endDate: medication.endDate?.slice(0, 10) || '', doctorId: medication.doctorId ?? '', status: medication.status });
      setLoaded(true);
    })().catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [id, patientId, revision]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request(`/api/medications${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: { ...draft, doctorId: draft.doctorId || null, ...(!id && { patientId }) } });
      navigate(`/medications/${result.id}?patientId=${result.patientId}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={s.page}><PageHeader title={id ? 'Edit medication' : 'Add medication'} /><ManagementLinks suffix={suffix} />
    {error && <Banner tone="danger">{error} <Button onClick={() => setRevision((v) => v + 1)}>Reload form</Button></Banner>}
    {!loaded ? <p role="status">Loading medication…</p> : <form onSubmit={save} className={s.page}><fieldset disabled={busy || !allowed} className={s.card}><legend>Medication details</legend><div className={s.fields}>
      <MedicationFields value={draft} onChange={setDraft} />
      <Field label="Doctor"><Select value={draft.doctorId} onChange={(e) => setDraft({ ...draft, doctorId: e.target.value })}><option value="">No doctor assigned</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.doctorName}</option>)}</Select></Field>
      <Field label="Status" required><Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{statuses.map((v) => <option key={v}>{v}</option>)}</Select></Field>
    </div><Button type="submit" loading={busy}>Save medication</Button></fieldset>{!allowed && !error && <Banner>Full access is required to manage medications.</Banner>}<Link to={`/medications${suffix}`}>Cancel</Link></form>}
  </div>;
}
export function MedicationDetail() {
  const { id } = useParams();
  return <Detail key={id} id={id} />;
}
function Detail({ id }) {
  const [revision, setRevision] = useState(0);
  const { data: m, error } = useResource(`/api/medications/${id}`, revision);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm('Discontinue this medication? Its history will be kept.')) return;
    setBusy(true); setFailure('');
    try { await request(`/api/medications/${id}`, { method: 'DELETE' }); setRevision((v) => v + 1); }
    catch (err) { setFailure(err.message); } finally { setBusy(false); }
  }
  const suffix = m ? `?patientId=${m.patientId}` : '';
  return <div className={s.page}><PageHeader title={m?.medicineName || 'Medication detail'} /><ManagementLinks suffix={suffix} />
    {(error || failure) && <Banner tone="danger">{error || failure} <Button onClick={() => setRevision((v) => v + 1)}>Refresh</Button></Banner>}
    {!m ? !error && <p role="status">Loading medication…</p> : <>
      <section className={s.card}><h2>Medication</h2><Details entries={[
        ['Generic name', m.genericName], ['Form', m.medicineForm], ['Tracking', m.trackingType], ['Dose', `${m.dosageAmount} ${m.dosageUnit}`], ['Frequency', m.frequencyText], ['Instructions', m.instructions], ['Start date', m.startDate.slice(0, 10)], ['End date', m.endDate?.slice(0, 10)], ['Status', m.status], ['Added via', m.addedVia], ['Doctor', m.doctor?.doctorName],
      ]} />{m.canEdit && <div className={s.actions}><Link to={`/medications/${id}/edit${suffix}`}>Edit medication</Link><Button variant="secondary" disabled={m.status === 'discontinued'} loading={busy} onClick={remove}>Discontinue medication</Button></div>}</section>
      <section className={s.card}><h2>Schedules</h2>{!m.schedules.length && <p>No schedules yet.</p>}{m.schedules.map((row) => <p key={row.id}>{row.timeOfDay.slice(11, 16)} · Days: {row.daysOfWeek} · Dose: {row.doseAmount} {m.dosageUnit} · {row.isActive ? 'Active' : 'Inactive'}{row.isTaperSchedule ? ' · Taper schedule' : ''}</p>)}</section>
      <section className={s.card}><h2>Inventory</h2>{!m.inventory.length && <p>No inventory yet.</p>}{m.inventory.map((row) => <p key={row.id}>{row.quantityRemaining} / {row.quantityTotal} {row.quantityUnit} remaining · Refill threshold: {row.refillThreshold}{row.estimatedRunoutDate ? ` · Estimated runout: ${row.estimatedRunoutDate.slice(0, 10)}` : ''}</p>)}</section>
      <section className={s.card}><h2>Recent dose history</h2><p>Up to 20 most recent scheduled doses.</p>{!m.doseLogs.length && <p>No dose history yet.</p>}{m.doseLogs.map((row) => <p key={row.id}>{new Date(row.scheduledDatetime).toLocaleString()} · {row.status}{row.actualActionDatetime ? ` · Action: ${new Date(row.actualActionDatetime).toLocaleString()}` : ''}{row.notes ? ` · ${row.notes}` : ''}</p>)}</section>
      <section className={s.card}><h2>AI insights</h2>{!m.aiInsights.length && <p>No insights yet.</p>}{m.aiInsights.map((row) => <article key={row.id}><p>{row.insightText}</p><p>{new Date(row.generatedAt).toLocaleString()}{row.isDismissed ? ' · Dismissed' : ''}</p></article>)}</section>
    </>}
  </div>;
}
