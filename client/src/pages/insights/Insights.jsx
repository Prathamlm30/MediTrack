import useDataChanged from '../../hooks/useDataChanged.js';
import { useEffect, useRef, useState } from 'react';
import { getInsights, dismissInsight } from '../../api/insights.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import Card from '../../components/Card.jsx';
import Banner from '../../components/Banner.jsx';
import Button from '../../components/Button.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import textStyles from '../caregiver/Caregiver.module.css';
import s from './Insights.module.css';

function SourceReference({ reference }) {
  // Seed references contain a human label followed by an HTTPS URL.
  const match = typeof reference === 'string' && /https?:\/\/[^\s<>]+/i.exec(reference);
  if (!match) return <p>{reference || 'No source reference provided.'}</p>;
  return <p>Source: <a href={match[0]} target="_blank" rel="noopener noreferrer">{reference}</a></p>;
}

export default function Insights(props) {
  const { session } = useAuth();
  return <InsightsData key={`${session.user.id}:${props.patientId}:${props.permissionLevel}`} {...props} />;
}

function InsightsData({ patientId, permissionLevel, medicationIds, interactionsOnly = false, revision: parentRevision = 0 }) {
  const { refreshPatients } = useActivePatient();
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [writeDenied, setWriteDenied] = useState(false);
  const pending = useRef(null);
  const mutation = useRef(false);
  const alive = useRef(false);
  const allowed = ['view_only', 'full_access'].includes(permissionLevel);
  const canDismiss = permissionLevel === 'full_access' && !writeDenied;
  const refresh = () => setRevision((value) => value + 1);
  useDataChanged(['insight', 'medication', 'dose_log'], patientId, refresh);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let disposed = false;
    async function load() {
      if (mutation.current) return;
      pending.current?.abort();
      const controller = new AbortController(); pending.current = controller;
      try {
        const data = await getInsights(patientId, { signal: controller.signal });
        if (!disposed && !controller.signal.aborted) setState({ data });
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          setState((old) => ({ data: error.status === 403 ? undefined : old?.data, error: error.message, restricted: error.status === 403 }));
          if (error.status === 403) refreshPatients();
        }
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; pending.current?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [patientId, revision, parentRevision, refreshPatients]);
  async function dismiss(row) {
    if (mutation.current) return;
    mutation.current = true; pending.current?.abort(); setBusy(row.dismissId); setFailure(''); setNotice('');
    try {
      const updated = await dismissInsight(row.dismissId, row.kind);
      if (!alive.current) return;
      const field = row.kind === 'adherence' ? 'insights' : 'interactionFlags';
      setState((previous) => previous?.data ? { data: { ...previous.data,
        [field]: previous.data[field].map((item) => item.dismissId === row.dismissId ? { ...item, ...updated } : item),
      } } : previous);
      setNotice(row.kind === 'adherence' ? 'Adherence insight dismissed.' : 'Interaction flag acknowledged.');
    } catch (error) {
      if (!alive.current) return;
      setFailure(error.message);
      if (error.status === 403) { setWriteDenied(true); refreshPatients(); refresh(); }
    } finally { mutation.current = false; if (alive.current) setBusy(null); }
  }
  const flags = (state?.data?.interactionFlags || []).filter((row) => row.kind === 'interaction' && !row.acknowledged
    && (!medicationIds || medicationIds.some((id) => Number(id) === row.medication1.id || Number(id) === row.medication2.id)));
  // The endpoint sorts newest first. Keep the weekly supplementary text quiet.
  const insight = state?.data?.insights.find((row) => row.kind === 'adherence' && row.insightType === 'adherence_pattern' && !row.isDismissed);
  return <div id={interactionsOnly ? undefined : 'insights'} className={s.section}>
    <Card title={interactionsOnly ? 'Medication interactions' : 'Insights'} action={<Button variant="secondary" onClick={refresh} disabled={Boolean(busy)}>Refresh insights</Button>}>
      {!allowed || state?.restricted ? <Banner>Restricted access. Insights include adherence details and interaction flags and require view-only or full access. Alerts-only access does not include Insights.{state?.restricted && <p>{state.error}</p>}</Banner>
        : state?.error && !state.data ? <ErrorState title="Could not load insights" onRetry={refresh}>{state.error}</ErrorState>
          : !state ? <Skeleton label="Loading insights" /> : <div className={s.content}>
            {state?.error && <ErrorState title="Could not refresh insights" onRetry={refresh}>Showing the last successful update. {state.error}</ErrorState>}
            {failure && <Banner tone="danger">{failure}</Banner>}
            {permissionLevel === 'view_only' || writeDenied ? <p className={s.muted}>Full access is required to dismiss insights or acknowledge interaction flags.</p> : null}
            {flags.map((flag) => <article key={flag.dismissId} data-insight-id={flag.dismissId}>
              <Banner tone={flag.interaction.severityLevel === 'severe' ? 'danger' : 'warning'}>
                <h3>Interaction warning · {flag.interaction.severityLevel}</h3>
                <p><strong>{flag.medication1.medicineName} + {flag.medication2.medicineName}</strong></p>
                <div className={textStyles.summary}>{flag.interaction.description}</div>
                <SourceReference reference={flag.interaction.sourceReference} />
                {canDismiss && <Button variant="secondary" loading={busy === flag.dismissId} disabled={Boolean(busy)} onClick={() => dismiss(flag)}>Acknowledge interaction</Button>}
              </Banner>
            </article>)}
            {!flags.length && <p>No unacknowledged interaction flags{medicationIds ? ' for these medications' : ''}.</p>}
            {!interactionsOnly && <div className={s.adherence}>
              <h3>Weekly adherence insight</h3>
              {insight ? <div data-insight-id={insight.dismissId}><p className={textStyles.summary}>{insight.insightText}</p>
                {canDismiss && <Button variant="ghost" size="sm" loading={busy === insight.dismissId} disabled={Boolean(busy)} onClick={() => dismiss(insight)}>Dismiss adherence insight</Button>}
              </div> : <p>No undismissed weekly adherence insight yet.</p>}
            </div>}
          </div>}
      <p role="status" className={s.notice}>{notice}</p>
    </Card>
  </div>;
}
