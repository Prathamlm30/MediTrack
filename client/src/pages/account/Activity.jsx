import { useEffect, useState } from 'react';
import { getActivity } from '../../api/activity.js';
import { getRelationships } from '../../api/relationships.js';
import { useAuth } from '../../context/AuthContext.jsx';
import usePagedFeed from '../../hooks/usePagedFeed.js';
import { activitySentence } from './activityText.js';
import { formatDate } from '../../components/dayTime.js';
import PageHeader from '../../components/PageHeader.jsx';
import Banner from '../../components/Banner.jsx';
import Button from '../../components/Button.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import s from '../notifications/Records.module.css';

export default function Activity() {
  const { session } = useAuth();
  const feed = usePagedFeed(getActivity, 'auditLogs');
  const [links, setLinks] = useState([]);
  // Audit rows identify a link, not its caregiver. Use only the existing caller-
  // scoped relationships response to optionally label that link's current name.
  useEffect(() => {
    const controller = new AbortController();
    getRelationships({ signal: controller.signal }).then(({ relationships }) => { if (!controller.signal.aborted) setLinks(relationships); }).catch(() => {});
    return () => controller.abort();
  }, []);
  return <div className={s.page}><PageHeader title="Account activity" description="Recorded sign-ins, caregiver access, and permission changes." action={<Button variant="secondary" disabled={feed.busy} onClick={() => feed.refresh()}>Refresh activity</Button>} />
    <Banner>Caregiver views are recorded at most once every 10 minutes per person and area. This list shows when access happened, not every request. It is not a complete record of every action.</Banner>
    {feed.error && <ErrorState title={feed.rows ? 'Could not refresh activity' : 'Could not load activity'} onRetry={feed.retry} loading={feed.busy}>{feed.rows && 'Showing the last successful update. '}{feed.error.message}</ErrorState>}
    {!feed.rows ? !feed.error && <Skeleton height="calc(var(--s10) * 4)" label="Loading activity" /> : !feed.rows.length ? <EmptyState title="No activity recorded yet." /> :
      <ul className={s.list}>{feed.rows.map((row) => <li key={row.id} className={s.row} data-activity-id={row.id}>
        <p>{activitySentence(row, session.user.id, links.find((link) => String(link.id) === String(row.entityId) && row.entityType === 'CaregiverPatientLink')?.caregiver?.fullName)}</p>
        <time dateTime={row.timestamp}>{formatDate(row.timestamp, session.user.preferences?.timezone, { dateStyle: 'medium', timeStyle: 'short' })}</time>
      </li>)}</ul>}
    {feed.nextCursor != null && <Button variant="secondary" loading={feed.busy} onClick={feed.loadMore}>Load more</Button>}
  </div>;
}
