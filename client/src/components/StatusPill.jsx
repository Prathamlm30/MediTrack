import { Check, Circle, CircleDot, Slash, Clock, Link, Unlink, Hourglass, Eye, Bell, ShieldCheck } from 'lucide-react';
import s from './StatusPill.module.css';
export const statusDefinitions = {
  taken: ['Taken', Check, 'taken'], missed: ['Missed', CircleDot, 'missed'], skipped: ['Skipped', Slash, 'skipped'],
  snoozed: ['Snoozed', Clock, 'snoozed'], pending: ['Pending', Circle, 'pending'],
  active: ['Active', Link, 'taken'], revoked: ['Revoked', Unlink, 'missed'], expired: ['Expired', Hourglass, 'skipped'],
  view_only: ['View only', Eye, 'snoozed'], alerts_only: ['Alerts only', Bell, 'skipped'], full_access: ['Full access', ShieldCheck, 'taken'],
};
export default function StatusPill({ status }) {
  const [label, Icon, tone] = statusDefinitions[status] || statusDefinitions.pending;
  return <span className={`${s.pill} ${s[tone]}`}><Icon size={16} strokeWidth={1.5} aria-hidden="true" />{label}</span>;
}
