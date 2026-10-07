import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Package, TriangleAlert, Calendar, Info } from 'lucide-react';
import { getNotifications, markNotificationRead, isUnread } from '../../api/notifications.js';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import usePagedFeed from '../../hooks/usePagedFeed.js';
import { formatDate } from '../../components/dayTime.js';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Select from '../../components/Select.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Banner from '../../components/Banner.jsx';
import s from './Records.module.css';

const types = { reminder: ['Reminder', Bell], refill: ['Refill', Package], escalation: ['Escalation', TriangleAlert], weekly_summary: ['Weekly summary', Calendar], system: ['System', Info] };
export default function Notifications() {
  const [unread, setUnread] = useState(false), [type, setType] = useState('');
  return <div className={s.page}><PageHeader title="Notifications" description="Your reminders, alerts, and updates." />
    <div className={s.filters}><div className={s.actions} role="group" aria-label="Read status">{[false, true].map((value) => <Button key={String(value)} variant={unread === value ? 'primary' : 'secondary'} aria-pressed={unread === value} onClick={() => setUnread(value)}>{value ? 'Unread' : 'All'}</Button>)}</div>
      <Field label="Notification type"><Select value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option>{Object.entries(types).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div>
    <Inbox key={`${unread}:${type}`} unread={unread} type={type} />
  </div>;
}
function Inbox({ unread, type }) {
  const { session } = useAuth(); const { socket } = useSocket();
  const { acceptCount, refreshCount } = useNotifications();
  const fetchPage = useCallback((cursor, options) => getNotifications({ unread, type, cursor }, options), [unread, type]);
  const feed = usePagedFeed(fetchPage, 'notifications', (data) => acceptCount(data.unreadCount));
  const [busy, setBusy] = useState(null), [notice, setNotice] = useState(''), [failure, setFailure] = useState('');
  useEffect(() => {
    const refresh = () => feed.refresh();
    socket?.on('dose-reminder', refresh); socket?.on('missed-dose-alert', refresh);
    return () => { socket?.off('dose-reminder', refresh); socket?.off('missed-dose-alert', refresh); };
  }, [socket, feed.refresh]);
  async function mark(row) {
    setBusy(row.id); setFailure(''); setNotice('');
    try {
      const { notification } = await markNotificationRead(row.id);
      feed.updateRows((rows) => rows.map((item) => item.id === row.id ? notification : item).filter((item) => !unread || isUnread(item)));
      setNotice('Notification marked as read.');
      await refreshCount();
    } catch (error) {
      if (error.status === 404) {
        feed.updateRows((rows) => rows.filter((item) => item.id !== row.id));
        setNotice('This notification is no longer available.');
        await Promise.all([feed.refresh(), refreshCount()]);
      } else setFailure(error.message);
    } finally { setBusy(null); }
  }
  return <><div className={s.actions}><Button variant="secondary" disabled={feed.busy || busy !== null} onClick={() => feed.refresh()}>Refresh notifications</Button><Link to="/settings/notifications">Notification preferences</Link></div>
    <p className={s.notice} role="status">{notice}</p>
    {failure && <Banner tone="danger">{failure}</Banner>}
    {feed.error && <ErrorState title={feed.rows ? 'Could not refresh notifications' : 'Could not load notifications'} onRetry={feed.retry} loading={feed.busy}>{feed.rows && 'Showing the last successful update. '}{feed.error.message}</ErrorState>}
    {!feed.rows ? !feed.error && <Skeleton height="calc(var(--s10) * 4)" label="Loading notifications" /> : !feed.rows.length ? <EmptyState title={unread ? "You're all caught up." : 'No notifications yet.'} /> :
      <ul className={s.list}>{feed.rows.map((row) => {
        const [label, Icon] = types[row.notificationType] || ['Notification', Bell];
        return <li key={row.id} className={s.row} data-notification-id={row.id}><div className={s.actions}><span className={s.type}><Icon size={18} strokeWidth={1.5} aria-hidden="true" />{label}</span>{isUnread(row) && <span className={s.unread}><span aria-hidden="true">●</span> Unread</span>}</div>
          <h2>{row.title}</h2><p className={s.message}>{row.message}</p>
          <time dateTime={row.sentAt}>{row.sentAt ? formatDate(row.sentAt, session.user.preferences?.timezone, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not sent yet'}</time>
          <div className={s.actions}>{isUnread(row) && <Button variant="secondary" loading={busy === row.id} disabled={busy !== null} onClick={() => mark(row)}>Mark as read</Button>}
            {row.notificationType === 'weekly_summary' && row.relatedPatientId != null && <Link to={`/patients/${encodeURIComponent(row.relatedPatientId)}#weekly-reports`}>View weekly reports</Link>}</div>
        </li>;
      })}</ul>}
    {feed.nextCursor != null && <Button variant="secondary" loading={feed.busy} disabled={busy !== null} onClick={feed.loadMore}>Load more</Button>}
  </>;
}
