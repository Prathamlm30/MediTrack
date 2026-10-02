import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { request } from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Banner from '../../components/Banner.jsx';
import Button from '../../components/Button.jsx';
import DoctorFields, { doctorFields } from './DoctorFields.jsx';
import { usePatientScope, useResource, ManagementLinks, Details } from '../medications/Management.jsx';
import s from '../medications/Management.module.css';

export function DoctorList() {
  const { suffix, selector } = usePatientScope();
  const [revision, setRevision] = useState(0);
  const { data, error } = useResource(`/api/doctors${suffix}`, revision);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove(doctor) {
    if (!window.confirm(`Delete ${doctor.doctorName}? Linked medications and scans will be kept without this doctor.`)) return;
    setBusy(true); setFailure('');
    try { await request(`/api/doctors/${doctor.id}`, { method: 'DELETE' }); setRevision((v) => v + 1); }
    catch (err) { setFailure(err.message); } finally { setBusy(false); }
  }
  return <div className={s.page}><PageHeader title="My doctors" description="Keep your prescribing doctors and contact details together." /><ManagementLinks suffix={suffix} />{selector}
    {(error || failure) && <Banner tone="danger">{error || failure} <Button onClick={() => setRevision((v) => v + 1)}>Retry</Button></Banner>}
    {!data ? !error && <p role="status">Loading doctors…</p> : <>{data.canEdit && <Link to={`/doctors/add${suffix}`}>Add doctor</Link>}{!data.doctors.length && <p>No doctors yet.</p>}
      <ul className={s.list}>{data.doctors.map((doctor) => <li key={doctor.id} className={s.card}><h2>{doctor.doctorName}</h2><Details entries={[
        ['Specialization', doctor.specialization], ['Clinic or hospital', doctor.clinicHospitalName], ['Contact number', doctor.contactNumber], ['Address', doctor.address], ['Source', doctor.source],
      ]} />{data.canEdit && <div className={s.actions}><Link to={`/doctors/${doctor.id}/edit${suffix}`}>Edit doctor</Link><Button variant="secondary" disabled={busy} onClick={() => remove(doctor)}>Delete doctor</Button></div>}</li>)}</ul></>}
  </div>;
}
export function DoctorEdit() {
  const { id } = useParams();
  const { patientId, suffix } = usePatientScope();
  return <DoctorEditor key={`${id || 'new'}:${patientId}`} id={id} patientId={patientId} suffix={suffix} />;
}
function DoctorEditor({ id, patientId, suffix }) {
  const [draft, setDraft] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setAllowed(false);
    request(id ? `/api/doctors/${id}` : `/api/doctors${suffix}`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (id) setDraft(Object.fromEntries(doctorFields.map((key) => [key, result[key] ?? ''])));
      setAllowed(result.canEdit); setLoaded(true);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [id, suffix, revision]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request(`/api/doctors${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: { ...draft, ...(!id && { patientId }) } });
      navigate(`/doctors?patientId=${result.patientId}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={s.page}><PageHeader title={id ? 'Edit doctor' : 'Add doctor'} /><ManagementLinks suffix={suffix} />
    {error && <Banner tone="danger">{error} <Button onClick={() => setRevision((v) => v + 1)}>Reload form</Button></Banner>}
    {!loaded ? !error && <p role="status">Loading doctor…</p> : <form className={s.page} onSubmit={save}><fieldset disabled={busy || !allowed} className={s.card}><legend>Doctor details</legend><div className={s.fields}><DoctorFields value={draft} onChange={setDraft} /></div><Button type="submit" loading={busy}>Save doctor</Button></fieldset>{!allowed && <Banner>Full access is required to manage doctors.</Banner>}<Link to={`/doctors${suffix}`}>Cancel</Link></form>}
  </div>;
}
