import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { request } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import Field from '../../components/Field.jsx';
import Select from '../../components/Select.jsx';
import s from './Management.module.css';

export function usePatientScope() {
  const { session } = useAuth();
  const { patients } = useActivePatient();
  const [query, setQuery] = useSearchParams();
  const patientId = query.get('patientId') || String(session.user.id);
  const suffix = `?patientId=${encodeURIComponent(patientId)}`;
  const selector = <Field label="Patient"><Select value={patientId} onChange={(event) => setQuery({ patientId: event.target.value })}>
    <option value={session.user.id}>Me · {session.user.fullName}</option>
    {patients.filter((row) => row.permissionLevel !== 'alerts_only').map((row) => <option key={row.patient.id} value={row.patient.id}>{row.patient.fullName}</option>)}
  </Select></Field>;
  return { patientId, suffix, selector };
}
export function useResource(path, revision = 0) {
  const [state, setState] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    setState({ path, revision });
    request(path, { signal: controller.signal }).then((data) => setState({ path, revision, data })).catch((error) => {
      if (!controller.signal.aborted) setState({ path, revision, error: error.message });
    });
    return () => controller.abort();
  }, [path, revision]);
  return state.path === path && state.revision === revision ? state : {};
}
export function ManagementLinks({ suffix = '' }) {
  return <nav className={s.actions} aria-label="Medication and doctor management"><Link to={`/medications${suffix}`}>Medications</Link><Link to={`/doctors${suffix}`}>Doctors</Link><Link to="/prescription-scans">Scan prescription</Link></nav>;
}
export function Details({ entries }) {
  return <dl className={s.details}>{entries.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value == null || value === '' ? '—' : String(value)}</dd></div>)}</dl>;
}
