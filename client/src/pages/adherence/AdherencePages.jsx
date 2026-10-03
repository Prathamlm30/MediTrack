import { useEffect, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { Link } from 'react-router-dom';
import { request } from '../../api/client.js';
import { inventoryChanged } from '../../api/inventoryUpdates.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import Select from '../../components/Select.jsx';
import InventorySection from '../medications/InventorySection.jsx';
import { usePatientScope, useResource, Details } from '../medications/Management.jsx';
import s from '../medications/Management.module.css';
import h from './AdherencePages.module.css';

export function CareLinks({ suffix }) {
  return <nav aria-label="Dose and adherence views" className={s.actions}><Link to={`/today${suffix}`}>Today</Link><Link to={`/dose-history${suffix}`}>Dose log history</Link><Link to={`/adherence${suffix}`}>Adherence calendar & stats</Link><Link to={`/medications${suffix}`}>Medications</Link></nav>;
}
export default function AdherencePage({ view }) {
  const { patientId, suffix, selector } = usePatientScope();
  const { session } = useAuth();
  const { patients } = useActivePatient();
  const link = patients.find((row) => String(row.patient.id) === patientId);
  const canEdit = String(session.user.id) === patientId || link?.permissionLevel === 'full_access';
  return <div className={s.page}><PageHeader title={{ today: "Today's doses", history: 'Dose log history', adherence: 'Adherence calendar & stats' }[view]} /><CareLinks suffix={suffix} />{selector}
    {!canEdit && <Banner>Read-only access. Dose actions and editing are unavailable.</Banner>}
    <ScopedView key={`${patientId}:${view}`} patientId={patientId} suffix={suffix} view={view} canEdit={canEdit} self={String(session.user.id) === patientId} />
  </div>;
}
function ScopedView({ patientId, suffix, view, canEdit, self }) {
  const [revision, setRevision] = useState(0);
  const { data: medications, error } = useResource(`/api/medications${suffix}`, revision);
  const { data: dashboard, error: timezoneError } = useResource(self ? '/api/dashboard/patient' : `/api/dashboard/caregiver/${patientId}`, revision);
  return <><Button variant="secondary" onClick={() => setRevision((v) => v + 1)}>Refresh data</Button>{error && <Banner tone="danger">{error}</Banner>}{timezoneError && <Banner tone="danger">{timezoneError}</Banner>}
    {dashboard?.timezone && <p>Dates and times use {dashboard.timezone}.</p>}
    {view === 'today' ? <Today suffix={suffix} medications={medications} canEdit={canEdit && medications?.canEdit} revision={revision} timezone={dashboard?.timezone} /> : view === 'history' ? <History suffix={suffix} medications={medications} revision={revision} timezone={dashboard?.timezone} /> : dashboard && <Adherence suffix={suffix} revision={revision} timezone={dashboard.timezone} />}
  </>;
}
function doseTime(value, timezone) { return new Date(value).toLocaleString(undefined, timezone ? { timeZone: timezone } : {}); }
function Today({ suffix, medications, canEdit, revision, timezone }) {
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { data, error: loadError } = useResource(`/api/dose-logs/today${suffix}`, `${revision}:${refresh}`);
  async function act(row, status) {
    setBusy(row.id); setError(''); setMessage('');
    try {
      await request(`/api/dose-logs/${row.id}`, { method: 'PATCH', body: { status } });
      if (status === 'taken') inventoryChanged(row.schedule.medication.id);
      setRefresh((v) => v + 1); setMessage(`Dose marked ${status}.`);
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  }
  const ids = [...new Set(data?.map((row) => row.schedule.medication.id))];
  return <>{(error || loadError) && <Banner tone="danger">{error || loadError}</Banner>}{message && <p role="status">{message}</p>}
    {!data ? !loadError && <p role="status">Loading today's doses…</p> : !data.length ? <p>No doses scheduled for today.</p> : ids.map((id) => <section key={id} className={s.card}><h2><Link to={`/medications/${id}${suffix}`}>{data.find((row) => row.schedule.medication.id === id).schedule.medication.medicineName}</Link></h2>
      {data.filter((row) => row.schedule.medication.id === id).map((row) => <article key={row.id} className={s.card}><p>{doseTime(row.scheduledDatetime, timezone)} · <strong>{row.status}</strong></p>{row.notes && <p>{row.notes}</p>}{canEdit && <div className={s.actions}>{['taken', 'skipped', 'snoozed'].map((status) => <Button key={status} variant={status === 'taken' ? 'primary' : 'secondary'} disabled={busy !== null || row.status === status} onClick={() => act(row, status)}>{status[0].toUpperCase() + status.slice(1)}</Button>)}</div>}</article>)}
      {medications?.medications.find((m) => m.id === id) && <InventorySection medication={medications.medications.find((m) => m.id === id)} compact />}
    </section>)}
  </>;
}
function History({ suffix, medications, revision, timezone }) {
  const [filters, setFilters] = useState({ from: '', to: '', medicationId: '' });
  const [applied, setApplied] = useState('');
  const [error, setError] = useState('');
  const { data, error: loadError } = useResource(`/api/dose-logs${suffix}${applied}`, revision);
  function submit(event) {
    event.preventDefault(); setError('');
    if (filters.from && filters.to && filters.from > filters.to) { setError('From date must be on or before to date.'); return; }
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    setApplied(query.size ? `&${query}` : '');
  }
  return <><form onSubmit={submit} className={s.card}><div className={s.fields}>{[['from', 'From date'], ['to', 'To date']].map(([key, label]) => <Field label={label} key={key}><TextInput type="date" value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} /></Field>)}<Field label="Medication"><Select value={filters.medicationId} onChange={(e) => setFilters({ ...filters, medicationId: e.target.value })}><option value="">All medications</option>{medications?.medications.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}</Select></Field></div><Button type="submit">Apply filters</Button></form>
    {(error || loadError) && <Banner tone="danger">{error || loadError}</Banner>}
    {!data ? !loadError && <p role="status">Loading dose history…</p> : !data.length ? <p>No dose logs match these filters.</p> : <ul className={s.list}>{data.map((row) => <li className={s.card} key={row.id}><Link to={`/medications/${row.schedule.medication.id}${suffix}`}>{row.schedule.medication.medicineName}</Link><p>{doseTime(row.scheduledDatetime, timezone)} · {row.status}</p>{row.actualActionDatetime && <p>Logged: {doseTime(row.actualActionDatetime, timezone)}</p>}{row.notes && <p>{row.notes}</p>}</li>)}</ul>}
  </>;
}
export function AdherenceHeatmap({ data, timezone }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [year, month] = today.split('-').map(Number);
  return <><p>Daily pre-aggregated adherence. Days without an aggregate are shown as “No data”.</p><div className={h.months}>{[-2, -1, 0].map((offset) => {
    const start = new Date(Date.UTC(year, month - 1 + offset, 1));
    const count = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    return <section key={offset}><h3>{start.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3><div className={h.calendar}>{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className={h.weekday}>{d}</span>)}{Array.from({ length: start.getUTCDay() }, (_, i) => <span key={`blank${i}`} />)}{Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), i + 1)).toISOString().slice(0, 10);
      const value = data[date]; const future = date > today;
      const level = future ? 'future' : value == null ? 'empty' : value === 0 ? 'zero' : value < 50 ? 'low' : value < 100 ? 'partial' : 'full';
      const label = `${date}: ${future ? 'Future date' : value == null ? 'No data' : `${value}% adherence`}`;
      return <span key={date} tabIndex={0} aria-label={label} title={label} className={`${h.day} ${h[level]}`}>{i + 1}<small>{future ? '—' : value == null ? 'N/D' : `${value}%`}</small></span>;
    })}</div></section>;
  })}</div><p>No data (N/D) · 0% (red) · 1–49% (amber) · 50–99% (pale green) · 100% (green)</p></>;
}
function Adherence({ suffix, revision, timezone }) {
  const { socket } = useSocket();
  const [liveRevision, setLiveRevision] = useState(0);
  const patientId = new URLSearchParams(suffix).get('patientId');
  useEffect(() => {
    const refresh = () => setLiveRevision((value) => value + 1);
    const statsUpdated = (event) => {
      if (String(event?.patientId) === patientId) refresh();
    };
    socket?.on('stats-updated', statsUpdated);
    socket?.on('connect', refresh); // Also catch up after a reconnect gap.
    const interval = setInterval(refresh, 30000);
    return () => { clearInterval(interval); socket?.off('stats-updated', statsUpdated); socket?.off('connect', refresh); };
  }, [socket, patientId]);
  const refreshKey = `${revision}:${liveRevision}`;
  const { data: heatmap, error: heatmapError } = useResource(`/api/adherence/heatmap${suffix}&months=3`, refreshKey);
  const { data: stats, error: statsError } = useResource(`/api/adherence/stats${suffix}`, refreshKey);
  return <><section className={s.card}><h2>Adherence streaks & stats</h2><p>Stats update when doses are logged and refresh automatically every 30 seconds.</p>{statsError ? <Banner tone="danger">{statsError}</Banner> : !stats ? <p>Loading stats…</p> : <Details entries={[["Current streak", `${stats.currentStreak} days`], ['Best streak', `${stats.bestStreak} days`], ['Rolling 7 days', `${stats.rolling7DayPercentage}%`], ['Rolling 30 days', `${stats.rolling30DayPercentage}%`]]} />}</section>
    <section className={s.card}><h2>Adherence calendar heatmap</h2>{heatmapError ? <Banner tone="danger">{heatmapError}</Banner> : !heatmap ? <p>Loading calendar…</p> : <AdherenceHeatmap data={heatmap} timezone={timezone} />}</section></>;
}
