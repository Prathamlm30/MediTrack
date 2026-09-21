import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import './dashboard.css';

function DashboardLogin() {
  const { setSession } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fields.get('email'), password: fields.get('password') }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sign-in failed.');
      setSession(data);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="dashboard"><h1>Your MediTrack dashboard</h1><p>Sign in to view your medicines or linked patients.</p>
    <form onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>
    {error && <p role="alert">{error}</p>}</section>;
}

function DashboardData({ path, permissionLevel }) {
  const { request, session } = useAuth();
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const key = `${session.accessToken}:${path}:${permissionLevel}`;
  useEffect(() => {
    let disposed = false;
    let controller;
    async function load() {
      controller?.abort(); controller = new AbortController();
      try {
        const data = await request(path, { signal: controller.signal });
        if (!disposed) setState({ key, data });
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') setState({ key, error: error.message });
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [key, path, request, revision]);
  const current = state?.key === key ? state : null;
  const data = current?.data;
  if (!current) return <p role="status">Loading dashboard…</p>;
  if (current.error) return <div><p role="alert">{current.error} Sign in again if your session has expired.</p>
    <button onClick={() => setRevision((value) => value + 1)}>Retry</button></div>;
  const date = (value) => new Date(value).toLocaleString(undefined, { timeZone: data.timezone });
  return <>
    <div className="dashboard-heading"><div><h2>{data.patient.fullName}</h2>
      <p>{data.readOnly ? 'Caregiver view · Read-only' : 'Your daily overview'} · {data.timezone}</p></div>
      <button onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
    <p className="dashboard-muted">Updated {date(data.generatedAt)} · Refreshes every 30 seconds</p>
    {data.permissionLevel === 'alerts_only' && <p role="status">Alerts-only access. Dose and adherence details are not shared.</p>}
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
  const { session, setSession } = useAuth();
  const { pathname } = useLocation();
  const { patients, activePatient, setActivePatientId, loading, error, refreshPatients } = useActivePatient();
  if (!session) return <DashboardLogin />;
  const caregiver = pathname === '/dashboard/caregiver';
  const overview = pathname === '/dashboard/my-patients';
  return <div className="dashboard"><div className="dashboard-heading"><h1>MediTrack</h1>
    <button onClick={() => setSession(null)}>Sign out of dashboard</button></div>
    <nav aria-label="Dashboards"><Link to="/dashboard">My dashboard</Link><Link to="/dashboard/my-patients">Linked patients</Link>
      <Link to="/dashboard/caregiver">Caregiver dashboard</Link></nav>
    {overview ? <><h2>Linked patients</h2><button onClick={refreshPatients}>Refresh patients</button>
      {loading ? <p role="status">Loading linked patients…</p> : error ? <p role="alert">{error}</p> : patients.length ?
        <ul className="dashboard-list">{patients.map((row) => <li key={row.patient.id}><strong>{row.patient.fullName}</strong>
          <span>{row.relationshipType} · {row.permissionLevel.replaceAll('_', ' ')}</span>
          <Link to="/dashboard/caregiver" onClick={() => setActivePatientId(row.patient.id)}>View dashboard</Link></li>)}</ul>
        : <p>No active linked patients.</p>}</> : caregiver ? <>
      <h2>Caregiver dashboard</h2>{loading ? <p role="status">Loading linked patients…</p> : error ? <p role="alert">{error}</p> : activePatient ? <>
        <label>Active patient<select value={activePatient.patient.id} onChange={(event) => setActivePatientId(event.target.value)}>
          {patients.map((row) => <option key={row.patient.id} value={row.patient.id}>{row.patient.fullName}</option>)}
        </select></label>
        <DashboardData path={`/api/dashboard/caregiver/${activePatient.patient.id}`} permissionLevel={activePatient.permissionLevel} />
      </> : <p>No active linked patients.</p>}
    </> : <DashboardData path="/api/dashboard/patient" />}</div>;
}
