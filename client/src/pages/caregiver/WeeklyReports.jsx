import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getWeeklyReports, getWeeklyReport } from '../../api/caregiver.js';
import { formatDate, patientZone } from '../../components/dayTime.js';
import Card from '../../components/Card.jsx';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import Modal from '../../components/Modal.jsx';
import s from './Caregiver.module.css';

export default function WeeklyReports({ patientId, permissionLevel, timezone }) {
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState(null);
  const [revision, setRevision] = useState(0);
  const section = useRef(null);
  const { hash } = useLocation();
  const allowed = ['view_only', 'full_access'].includes(permissionLevel);
  const key = `${patientId}:${permissionLevel}`;
  const current = state?.key === key ? state : null;
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => { if (hash === '#weekly-reports') section.current?.scrollIntoView(); }, [hash]);
  useEffect(() => {
    let controller;
    let disposed = false;
    async function load() {
      controller?.abort();
      const pending = new AbortController(); controller = pending;
      try {
        // Even a restricted link goes through the real endpoint so a 403 is
        // represented explicitly, rather than being mistaken for an empty archive.
        const reports = await getWeeklyReports(patientId, { signal: pending.signal });
        let report, detailError;
        if (allowed && selected !== null) {
          try { report = await getWeeklyReport(selected, { signal: pending.signal }); }
          catch (error) { if (error.status === 403) throw error; detailError = error.message; }
        }
        if (!disposed && !pending.signal.aborted) setState({ key, reports, report, selected, detailError });
      } catch (error) {
        if (!disposed && !pending.signal.aborted) setState({ key, error: error.message, restricted: error.status === 403 });
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [patientId, key, selected, revision, allowed]);
  const zone = patientZone(timezone);
  const date = (value) => formatDate(value, zone, { dateStyle: 'medium' });
  const range = (row) => `${date(row.weekStartDate)} – ${date(row.weekEndDate)}`;
  const restricted = !allowed || current?.restricted;
  const report = current?.selected === selected ? current?.report : null;
  return <div id="weekly-reports" ref={section} className={s.section}><Card title="Weekly reports"
    action={<Button variant="secondary" onClick={refresh}>Refresh reports</Button>}>
    {restricted ? <Banner>Restricted access. Weekly reports include adherence details and require view-only or full access. Alerts-only access does not include weekly reports.{current?.restricted && <p>{current.error}</p>}</Banner>
      : current?.error ? <ErrorState title="Could not load weekly reports" onRetry={refresh}>{current.error}</ErrorState>
        : !current ? <Skeleton label="Loading weekly reports" />
          : !current.reports.length ? <p>No weekly reports have been generated for this patient yet.</p>
            : <><p className={s.muted}>Newest first · Dates use {zone}. Each week ends at the report’s exclusive end time.</p>
              <ul className={s.list}>{current.reports.map((row) => <li className={s.row} key={row.id}>
                <div className={s.details}><strong>{range(row)}</strong><p>Delivery: {row.sentStatus}{row.sentAt ? ` · ${date(row.sentAt)}` : ''}</p></div>
                <Button variant="secondary" onClick={() => setSelected(row.id)} aria-label={`Open weekly report ${range(row)}`}>Open report</Button>
              </li>)}</ul></>}
  </Card>
    <Modal open={selected !== null && !restricted} onClose={() => setSelected(null)} title={report ? `Weekly report · ${range(report)}` : 'Weekly report'}>
      {current?.error || (current?.selected === selected && current?.detailError)
        ? <ErrorState title="Could not open weekly report" onRetry={refresh}>{current.error || current.detailError}</ErrorState>
        : !report ? <Skeleton label="Loading report text" /> : <>
          <p>Delivery: {report.sentStatus}</p>
          <p className={s.muted}>{formatDate(report.weekStartDate, zone, { dateStyle: 'medium', timeStyle: 'short' })} (inclusive) to {formatDate(report.weekEndDate, zone, { dateStyle: 'medium', timeStyle: 'short' })} (exclusive) · {zone}</p>
          <div className={s.summary}>{report.summaryText}</div>
        </>}
    </Modal>
  </div>;
}
