import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Avatar from '../../components/Avatar.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import StatusPill from '../../components/StatusPill.jsx';
import DayRail from '../../components/DayRail.jsx';
import { dayMinute, dayNumber, dosePeriod, formatDate, patientZone, quantity } from '../../components/dayTime.js';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, Navigate } from 'react-router-dom';
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

function DashboardData({ patientId }) {
  const { request, session } = useAuth();
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const hasPainted = useRef(false);
  // Permission is response data, never part of the loading identity.
  const key = `${session.user.id}:${patientId || 'self'}`;
  const { refreshPatients } = useActivePatient();
  useEffect(() => {
    let disposed = false;
    let controller;
    async function load() {
      controller?.abort();
      const pending = new AbortController(); controller = pending;
      try {
        const data = await (patientId ? getCaregiverDashboard(patientId, { signal: pending.signal }) : getPatientDashboard({ signal: pending.signal }));
        if (!disposed && !pending.signal.aborted) setState({ key, data });
      } catch (error) {
        if (disposed || pending.signal.aborted || error.name === 'AbortError') return;
        const accessChanged = error.status === 403;
        // Keep the layout on transient failures, but immediately remove data on a denial.
        setState((previous) => ({ key, data: !accessChanged && previous?.key === key ? previous.data : undefined,
          error: error.message, accessChanged }));
        if (accessChanged) refreshPatients();
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [key, patientId, request, revision, refreshPatients]);
  const current = state?.key === key ? state : null;
  const data = current?.data;
  useEffect(() => { if (data) hasPainted.current = true; }, [data]);
  const retry = () => setRevision((value) => value + 1);
  if (!current) return <><PageHeader title={patientId ? 'Patient dashboard' : 'Your day'} /><Skeleton height="var(--dashboard-rail-loading)" label="Loading dashboard" />{['Today’s doses', 'Adherence', 'Refill alerts'].map((title) => <Card key={title} title={title}><Skeleton height="calc(var(--s10) * 2)" label={`Loading ${title.toLowerCase()}`} /></Card>)}</>;
  if (!data) return <ErrorState headingLevel={1} title={current.accessChanged ? 'Access changed' : 'Could not load the dashboard.'} onRetry={retry}>
    {current.accessChanged ? 'This patient’s information is no longer available to you. Your linked patients have been refreshed. You are still signed in.' : current.error}
  </ErrorState>;
  const zone = patientZone(data.timezone);
  const date = (value) => formatDate(value, zone, { dateStyle: 'medium' });
  const time = (value) => formatDate(value, zone, { hour: 'numeric', minute: '2-digit' });
  const hasDoses = Object.hasOwn(data, 'todayDoses');
  return <>
    <PageHeader title={data.readOnly ? `${data.patient.fullName}’s day` : 'Your day'}
      description={`${formatDate(data.generatedAt, zone, { dateStyle: 'full' })} · ${zone}`}
      action={<Button variant="secondary" onClick={retry}>Refresh</Button>} />
    <div className="dashboard-update" role="status">
      {current.error ? <span>Could not refresh. Showing the last successful update. {current.error} <Button variant="secondary" size="sm" onClick={retry}>Retry</Button></span>
        : <span>Updated <time dateTime={data.generatedAt}>{time(data.generatedAt)}</time> · Refreshes every 30 seconds</span>}
    </div>
    {data.readOnly && <div className="dashboard-access"><Banner>Read-only view of {data.patient.fullName}’s dashboard.</Banner><StatusPill status={data.permissionLevel} /></div>}
    {hasDoses ? <>
      <DayRail doses={data.todayDoses} timezone={zone} now={data.generatedAt} animate={!hasPainted.current} />
      <Card title="Today’s doses">
        {data.todayDoses.length ? <div className="dashboard-dose-groups">{['morning', 'midday', 'evening', 'night'].map((period) => {
          const doses = data.todayDoses.filter((dose) => dosePeriod(dayMinute(dose.scheduledDatetime, zone)) === period);
          return doses.length ? <div className={`dashboard-dose-group dashboard-${period}`} key={period}>
            <h3>{period[0].toUpperCase() + period.slice(1)}</h3>
            <ul className="dashboard-list">{doses.map((dose) => <li className="dashboard-dose" key={dose.id}>
              <time dateTime={dose.scheduledDatetime}>{time(dose.scheduledDatetime)}</time>
              <div><strong>{dose.schedule.medication.medicineName}</strong><p>{quantity(dose.schedule.doseAmount)} {dose.schedule.medication.dosageUnit}</p></div>
              <StatusPill status={dose.status} />
            </li>)}</ul>
          </div> : null;
        })}</div> : <p>No doses are scheduled for today.</p>}
      </Card>
      <Card title="Adherence">{data.adherence ? <div className="dashboard-adherence">
        <p className="dashboard-percentage">{quantity(data.adherence.adherencePercentage)}<span>%</span></p>
        <div><p>Daily summary · <time dateTime={data.adherence.periodStartDate}>{date(data.adherence.periodStartDate)}</time> – <time dateTime={data.adherence.periodEndDate}>{date(data.adherence.periodEndDate)}</time></p>
          <dl className="dashboard-counts">{[['Taken', data.adherence.takenCount], ['Missed', data.adherence.missedCount], ['Skipped', data.adherence.skippedCount], ['Scheduled', data.adherence.totalScheduledDoses]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
        </div>
      </div> : <p>Adherence appears once doses have been logged.</p>}</Card>
    </> : <Banner>You have alerts-only access. {data.patient.fullName} has not shared their dose schedule or adherence with you. They can change this from their relationships page.</Banner>}
    <Card title="Refill alerts">{data.refillAlerts.length ? <ul className="dashboard-list dashboard-refills">
      {data.refillAlerts.map((row) => {
        const days = dayNumber(row.estimatedRunoutDate, zone) - dayNumber(data.generatedAt, zone);
        return <li key={row.id}><strong>{row.medication.medicineName}</strong>
          <span>{quantity(row.quantityRemaining)} {row.quantityUnit} remaining</span>
          <span>Estimated runout: <time dateTime={row.estimatedRunoutDate}>{date(row.estimatedRunoutDate)}</time> · {days === 0 ? 'Today' : `In ${days} ${days === 1 ? 'day' : 'days'}`}</span></li>;
      })}
    </ul> : <p>Nothing is running low.</p>}</Card>
  </>;
}

function PatientOverview() {
  const { patients, setActivePatientId, loading, error, refreshPatients } = useActivePatient();
  return <>
    <PageHeader title="Your patients" description="Choose a person to see what they have shared with you."
      action={<Button variant="secondary" onClick={refreshPatients}>Refresh patients</Button>} />
    {loading ? <Skeleton height="calc(var(--s10) * 3)" label="Loading linked patients" />
      : error ? <ErrorState onRetry={refreshPatients}>{error}</ErrorState>
        : patients.length ? <ul className="dashboard-patients">{patients.map((row) => <li key={row.patient.id}>
          <Card><div className="dashboard-patient-name"><Avatar fullName={row.patient.fullName} /><h2>{row.patient.fullName}</h2></div>
            <StatusPill status={row.permissionLevel} />
            {row.relationshipType && <p><span className="dashboard-muted">Relationship type: </span>{row.relationshipType}</p>}
            <Link to={`/patients/${row.patient.id}`} onClick={() => setActivePatientId(row.patient.id)} aria-label={`View dashboard for ${row.patient.fullName}`}>View dashboard</Link>
          </Card></li>)}</ul>
          : <EmptyState title="No active linked patients." action={<Link to="/relationships/invite">Invite someone</Link>}>An invitation is how a link starts.</EmptyState>}
  </>;
}

export default function Dashboard() {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const { patientId } = useParams();
  const { activePatient, setActivePatientId, loading, error, refreshPatients } = useActivePatient();
  useEffect(() => { if (patientId && Number(patientId) !== session?.user.id) setActivePatientId(patientId); }, [patientId, session?.user.id, setActivePatientId]);
  if (!session) return <DashboardLogin />;
  // The caregiver endpoint deliberately rejects self-access.
  if (patientId && Number(patientId) === session.user.id) return <Navigate to="/dashboard" replace />;
  if (pathname === '/dashboard/caregiver') {
    if (loading) return <Skeleton label="Loading linked patients" />;
    if (error) return <ErrorState onRetry={refreshPatients}>{error}</ErrorState>;
    return <Navigate to={activePatient ? `/patients/${activePatient.patient.id}` : '/patients'} replace />;
  }
  return <div className="dashboard tabular-nums">
    {pathname === '/patients' ? <PatientOverview /> : <>
      <nav aria-label="Dose and adherence views"><Link to={`/today?patientId=${patientId || session.user.id}`}>Today</Link>{' · '}<Link to={`/dose-history?patientId=${patientId || session.user.id}`}>Dose log history</Link>{' · '}<Link to={`/adherence?patientId=${patientId || session.user.id}`}>Adherence calendar & stats</Link></nav>
      <DashboardData key={`${session.user.id}:${patientId || 'self'}`} patientId={patientId} />
      {!patientId && activePatient && <Link to={`/patients/${activePatient.patient.id}`}>Caregiver dashboard</Link>}
    </>}
  </div>;
}
