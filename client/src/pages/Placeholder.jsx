import { Navigate, useLocation, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { SESSION_ENDED } from '../api/client.js';
import { DashboardLogin } from './dashboard/Dashboard.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Banner from '../components/Banner.jsx';
import Skeleton from '../components/Skeleton.jsx';
export default function Placeholder({ title, landing, login, signup, reset, invitation, verification }) {
  const { session, checking } = useAuth(); const [query] = useSearchParams(); const params = useParams();
  const navigate = useNavigate(); const location = useLocation();
  // Read route contracts now; page workflows are intentionally deferred to UI-2–UI-4.
  const inviteToken = (login || signup) ? query.get('inviteToken') : invitation ? params.token : null;
  const actionToken = reset ? query.get('token') : verification ? params.token : null;
  if (checking) return <Skeleton height="calc(var(--s10) * 3)" label="Checking your session" />;
  if (landing && session) return <Navigate to="/dashboard" replace />;
  return <><PageHeader title={title} description="Page foundation. Content will be added in the next UI phase." />
    {login && query.get('notice') === 'session-ended' && <Banner tone="warning">{SESSION_ENDED}</Banner>}
    {inviteToken && <Banner>Invitation context retained for this page.</Banner>}
    {actionToken && <p>Link context received.</p>}
    {login && <DashboardLogin onSuccess={() => navigate(inviteToken ? `/invitations/${encodeURIComponent(inviteToken)}` : location.state?.from || '/dashboard', { replace: true })} />}
  </>;
}
