import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { getActiveAlerts, resolveAlert } from '../../api/caregiver.js';
import { useToast } from '../../components/Toast.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import s from './Caregiver.module.css';

function openFor(value, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Open less than a minute';
  if (minutes < 60) return `Open ${minutes} min`;
  if (minutes < 1440) return `Open ${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  return `Open ${Math.floor(minutes / 1440)} days ${Math.floor(minutes % 1440 / 60)} hr`;
}

function AlertFeed({ patients }) {
  const { session } = useAuth();
  const { socket, status } = useSocket();
  const notify = useToast();
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  const refresh = () => setRevision((value) => value + 1);
  // A stable identity also removes stale rows immediately on link/permission changes.
  const identity = patients.map((row) => `${row.patient.id}:${row.permissionLevel}`).join(',');
  useEffect(() => {
    let controller;
    let disposed = false;
    async function load() {
      controller?.abort();
      const pending = new AbortController(); controller = pending;
      const groups = await Promise.all(identity.split(',').filter(Boolean).map(async (entry) => {
        const patientId = Number(entry.split(':')[0]);
        try { return { patientId, alerts: await getActiveAlerts(patientId, { signal: pending.signal }) }; }
        catch (error) { return { patientId, alerts: [], error: error.message, restricted: error.status === 403 }; }
      }));
      if (!disposed && !pending.signal.aborted) setState(groups);
    }
    const missed = (event) => {
      if (identity.split(',').some((entry) => entry.startsWith(`${event.patientId}:`))) void load();
    };
    void load();
    socket?.on('missed-dose-alert', missed);
    socket?.on('connect', load);
    window.addEventListener('focus', load);
    const interval = setInterval(() => { setNow(Date.now()); void load(); }, 30000);
    return () => {
      disposed = true; controller?.abort(); clearInterval(interval);
      socket?.off('missed-dose-alert', missed); socket?.off('connect', load);
      window.removeEventListener('focus', load);
    };
  }, [identity, socket, revision]);
  async function resolve(alert) {
    setBusy(alert.id); setFailure(null);
    try {
      await resolveAlert(alert.id);
      setState((groups) => groups?.map((group) => ({ ...group, alerts: group.alerts.filter((row) => row.id !== alert.id) })));
      notify('Alert resolved.', 'success'); refresh();
    } catch (error) {
      setFailure({ id: alert.id, message: error.message });
      if ([403, 404].includes(error.status)) refresh();
    } finally { setBusy(null); }
  }
  const groups = state && [...state].sort((a, b) => new Date(b.alerts[0]?.triggeredAt || 0) - new Date(a.alerts[0]?.triggeredAt || 0));
  return <>
    <div className={s.actions}><p role="status">{status}</p><Button variant="secondary" onClick={refresh}>Refresh alerts</Button></div>
    <p className={s.muted}>Alerts appear here as they arrive. A dose must be logged as taken before its alert can be resolved.</p>
    {!groups ? <Skeleton label="Loading alerts" /> : <div className={s.groups}>{groups.map((group) => {
      const link = patients.find((row) => row.patient.id === group.patientId);
      return <Card key={group.patientId} title={link.patient.fullName} action={<Link to={`/patients/${group.patientId}`}>View dashboard</Link>}>
        {group.restricted ? <Banner>Restricted access. Alerts require alerts-only or full access for this patient. {group.error}</Banner>
          : group.error ? <ErrorState title="Could not load alerts" onRetry={refresh}>{group.error}</ErrorState>
            : !group.alerts.length ? <p>No open alerts for this patient.</p>
              : <ul className={s.list}>{group.alerts.map((alert) => <li key={alert.id} className={s.row} data-alert-id={alert.id}>
                <div className={s.details}><strong>{alert.doseLog.schedule.medication.medicineName}</strong>
                  <p>{link.patient.fullName} · <span className={s.level}>Level {alert.escalationLevel}</span></p>
                  <p className={s.muted}><time dateTime={alert.triggeredAt}>{openFor(alert.triggeredAt, now)}</time></p></div>
                {alert.caregiverId === session.user.id && ['alerts_only', 'full_access'].includes(link.permissionLevel) &&
                  <Button variant="secondary" loading={busy === alert.id} disabled={busy !== null} onClick={() => resolve(alert)} aria-label={`Resolve alert for ${alert.doseLog.schedule.medication.medicineName}`}>Resolve</Button>}
                {failure?.id === alert.id && <div className={s.error}><Banner tone="danger">{failure.message}</Banner></div>}
              </li>)}</ul>}
      </Card>;
    })}</div>}
  </>;
}

export default function Alerts() {
  const { patients, loading, error, refreshPatients } = useActivePatient();
  const [query] = useSearchParams();
  const patientId = query.get('patientId');
  const selected = patientId ? patients.filter((row) => String(row.patient.id) === patientId) : patients;
  return <div className={`${s.page} tabular-nums`}><PageHeader title="Alerts" description="Open escalation alerts for the people you care for." />
    {patientId && <Link to="/alerts">All patients’ alerts</Link>}
    {loading ? <Skeleton label="Loading linked patients" /> : error ? <ErrorState onRetry={refreshPatients}>{error}</ErrorState>
      : !selected.length ? <EmptyState title={patientId ? 'Patient access unavailable.' : 'No active linked patients.'}>Alerts are available for active caregiver links with alerts-only or full access.</EmptyState>
        : <AlertFeed key={selected.map((row) => `${row.patient.id}:${row.permissionLevel}`).join(',')} patients={selected} />}
  </div>;
}
