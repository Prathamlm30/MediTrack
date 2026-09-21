import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import './dashboard.css';
import * as auth from '../../api/auth.js';
import { getPatientDashboard, getCaregiverDashboard } from '../../api/dashboard.js';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import Button from '../../components/Button.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import Banner from '../../components/Banner.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';

export function DashboardLogin({ onSuccess }) {
  const { setSession } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const data = await auth.login({ email: fields.get('email'), password: fields.get('password') });
      setSession(data); onSuccess?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function googleLogin(response) {
    setBusy(true); setError('');
    try { setSession(await auth.google(response.credential)); onSuccess?.(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="dashboard"><p>Phase 3 sign-in controls</p>
    {import.meta.env.VITE_GOOGLE_CLIENT_ID && <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <GoogleLogin onSuccess={googleLogin} onError={() => setError('Google Sign-In failed.')} /></GoogleOAuthProvider>}
    <form onSubmit={login}><Field label="Email" required><TextInput name="email" type="email" autoComplete="username" /></Field>
      <Field label="Password" required><PasswordInput name="password" autoComplete="current-password" /></Field>
      <Button type="submit" loading={busy}>Sign in</Button></form>
    {error && <p role="alert">{error}</p>}</section>;
}

function DashboardData({ patientId, permissionLevel }) {
  const { request, session } = useAuth();
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const key = `${session.user.id}:${patientId || "self"}:${permissionLevel}`;
  const { refreshPatients } = useActivePatient();
  useEffect(() => {
    let disposed = false;
    let controller;
    async function load() {
      controller?.abort(); controller = new AbortController();
      try {
        const data = await (patientId ? getCaregiverDashboard(patientId, { signal: controller.signal }) : getPatientDashboard({ signal: controller.signal }));
        if (!disposed) setState({ key, data });
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') { setState({ key, error: error.status === 403 ? 'Access changed. This patient’s information is no longer available.' : error.message }); if (error.status === 403) refreshPatients(); }
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [key, patientId, request, revision, refreshPatients]);
  const current = state?.key === key ? state : null;
  const data = current?.data;
  if (!current) return <Skeleton height="calc(var(--s10) * 5)" label="Loading dashboard" />;
  if (current.error) return <div><p role="alert">{current.error}</p>
    <button onClick={() => setRevision((value) => value + 1)}>Retry</button></div>;
  const date = (value) => new Intl.DateTimeFormat(undefined, { timeZone: data.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <>
    <div className="dashboard-heading"><div><h2>{data.patient.fullName}</h2>
      <p>{data.readOnly ? 'Caregiver view · Read-only' : 'Your daily overview'} · {data.timezone}</p></div>
      <button onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
    <p className="dashboard-muted">Updated {date(data.generatedAt)} · Refreshes every 30 seconds</p>
    {!Object.hasOwn(data, 'todayDoses') && <Banner>You have alerts-only access. {data.patient.fullName} has not shared their dose schedule or adherence with you. They can change this from their relationships page.</Banner>}
    {Object.hasOwn(data, 'todayDoses') && <section><h3>Today’s doses</h3>
      {data.todayDoses.length ? <ul className="dashboard-list">{data.todayDoses.map((dose) => <li key={dose.id}>
        <strong>{dose.schedule.medication.medicineName}</strong><span>{dose.schedule.doseAmount} {dose.schedule.medication.dosageUnit} · {date(dose.scheduledDatetime)}</span>
        <span>{dose.status}</span></li>)}</ul> : <p>No doses scheduled today.</p>}</section>}
    {Object.hasOwn(data, 'adherence') && <section><h3>Latest daily adherence</h3>{data.adherence ? <>
      <p><strong>{data.adherence.adherencePercentage}%</strong> · {data.adherence.takenCount} taken / {data.adherence.totalScheduledDoses} scheduled</p>
      <p>{data.adherence.missedCount} missed · {data.adherence.skippedCount} skipped</p>
      <p className="dashboard-muted">{date(data.adherence.periodStartDate)} – {date(data.adherence.periodEndDate)}</p>
    </> : <p>No daily adherence summary yet.</p>}</section>}
    <section><h3>Refills in the next seven days</h3>{data.refillAlerts.length ? <ul className="dashboard-list">
      {data.refillAlerts.map((row) => <li key={row.id}><strong>{row.medication.medicineName}</strong>
        <span>{row.quantityRemaining} {row.quantityUnit} remaining</span><span>Estimated runout: {date(row.estimatedRunoutDate)}</span></li>)}
    </ul> : <p>No upcoming refills.</p>}</section>
  </>;
}

export default function Dashboard() {
  const { session, signOut } = useAuth();
  const { pathname } = useLocation();
  const { patientId } = useParams();
  const navigate = useNavigate();
  const [signOutError, setSignOutError] = useState('');
  const { patients, activePatient, setActivePatientId, loading, error, refreshPatients } = useActivePatient();
  useEffect(() => { if (patientId) setActivePatientId(patientId); }, [patientId, setActivePatientId]);
  if (!session) return <DashboardLogin />;
  const caregiver = Boolean(patientId) || pathname === '/dashboard/caregiver';
  const overview = pathname === '/dashboard/my-patients';
  return <div className="dashboard tabular-nums"><div className="dashboard-heading"><h1>MediTrack</h1>
    <button onClick={async () => { try { await signOut(); } catch (err) { setSignOutError(err.message); } }}>Sign out of dashboard</button></div>
    {signOutError && <p role="alert">{signOutError}</p>}
    <nav aria-label="Dashboards"><Link to="/dashboard">My dashboard</Link><Link to="/patients">Linked patients</Link>
      {activePatient && <Link to={`/patients/${activePatient.patient.id}`}>Caregiver dashboard</Link>}</nav>
    {overview ? <><h2>Linked patients</h2><button onClick={refreshPatients}>Refresh patients</button>
      {loading ? <p role="status">Loading linked patients…</p> : error ? <p role="alert">{error}</p> : patients.length ?
        <ul className="dashboard-list">{patients.map((row) => <li key={row.patient.id}><strong>{row.patient.fullName}</strong>
          <span>{row.relationshipType} · {row.permissionLevel.replaceAll('_', ' ')}</span>
          <Link to={`/patients/${row.patient.id}`} onClick={() => setActivePatientId(row.patient.id)}>View dashboard</Link></li>)}</ul>
        : <p>No active linked patients.</p>}</> : caregiver ? <>
      <h2>Caregiver dashboard</h2>{loading ? <p role="status">Loading linked patients…</p> : error ? <p role="alert">{error}</p> : (patientId || activePatient) ? <>
        <label>Active patient<select value={patientId || activePatient?.patient.id} onChange={(event) => { setActivePatientId(event.target.value); navigate(`/patients/${event.target.value}`); }}>
          {patients.map((row) => <option key={row.patient.id} value={row.patient.id}>{row.patient.fullName}</option>)}
        </select></label>
        <DashboardData patientId={patientId || activePatient.patient.id} permissionLevel={patients.find((row) => row.patient.id === Number(patientId))?.permissionLevel || activePatient?.permissionLevel} />
      </> : <p>No active linked patients.</p>}
    </> : <DashboardData />}</div>;
}
