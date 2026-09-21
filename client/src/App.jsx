import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/dashboard/Dashboard.jsx';
import Placeholder from './pages/Placeholder.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ActivePatientProvider } from './context/ActivePatientContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppShell from './components/layout/AppShell.jsx';
import AuthShell from './components/layout/AuthShell.jsx';
import Skeleton from './components/Skeleton.jsx';
const DevUI = import.meta.env.DEV ? lazy(() => import('./pages/dev/DevUI.jsx')) : null;
export default function App() {
  if (import.meta.env.DEV && window.location.pathname === '/dev/ui') return <ToastProvider><Suspense fallback={<Skeleton />}><DevUI /></Suspense></ToastProvider>;
  return <AuthProvider><ActivePatientProvider><ToastProvider><Routes>
    <Route element={<AuthShell />}>
      <Route path="/" element={<Placeholder title="MediTrack" landing />} />
      <Route path="/login" element={<Placeholder title="Log in" login />} />
      <Route path="/signup" element={<Placeholder title="Sign up" signup />} />
      <Route path="/forgot-password" element={<Placeholder title="Forgot password" />} />
      <Route path="/reset-password" element={<Placeholder title="Reset password" reset />} />
      <Route path="/verify-email/:token" element={<Placeholder title="Verify email" verification />} />
      <Route path="/invitations/:token" element={<Placeholder title="Invitation" invitation />} />
    </Route>
    <Route element={<ProtectedRoute />}><Route element={<AppShell />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/patients" element={<Placeholder title="Patients" />} />
      <Route path="/patients/:patientId" element={<Dashboard />} />
      <Route path="/relationships" element={<Placeholder title="Relationships" />} />
      <Route path="/relationships/invite" element={<Placeholder title="Invite someone" />} />
      <Route path="/profile" element={<Placeholder title="Profile" />} />
      <Route path="/profile/edit" element={<Placeholder title="Edit profile" />} />
      <Route path="/settings" element={<Placeholder title="Account settings" />} />
      <Route path="/settings/notifications" element={<Placeholder title="Notification preferences" />} />
      <Route path="/dashboard/my-patients" element={<Navigate to="/patients" replace />} />
      <Route path="/dashboard/caregiver" element={<Dashboard />} />
    </Route></Route>
    <Route path="*" element={<Placeholder title="Page not found" />} />
  </Routes></ToastProvider></ActivePatientProvider></AuthProvider>;
}
