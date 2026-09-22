import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ErrorState from './ErrorState.jsx';
import Skeleton from './Skeleton.jsx';
import PageHeader from './PageHeader.jsx';
import s from './ProtectedRoute.module.css';
export default function ProtectedRoute() {
  const { checking, session, error, retrySession } = useAuth(); const location = useLocation();
  if (checking) return <main className={s.boot}><PageHeader title="Loading your account" /><Skeleton height="calc(var(--s10) * 4)" label="Checking your session" /></main>;
  if (session && !session.user) return <main className={s.boot}><ErrorState headingLevel={1} onRetry={retrySession}>{error || "Could not load your profile."}</ErrorState></main>;
  return session ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}
