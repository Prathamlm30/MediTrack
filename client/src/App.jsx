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
import { Landing, SignInPage, ForgotPassword, ResetPassword, VerifyEmail } from './pages/account/AuthPages.jsx';
import { AccountPage } from './pages/account/ProfilePages.jsx';
import { RelationshipsPage, InvitePage, InvitationPage } from './pages/relationships/RelationshipPages.jsx';
import { UploadPrescription, ReviewPrescription } from './pages/prescription-scans/PrescriptionScans.jsx';
import { MedicationList, MedicationEdit, MedicationDetail } from './pages/medications/MedicationPages.jsx';
import { DoctorList, DoctorEdit } from './pages/doctors/DoctorPages.jsx';
import AdherencePage from './pages/adherence/AdherencePages.jsx';
const DevUI = import.meta.env.DEV ? lazy(() => import('./pages/dev/DevUI.jsx')) : null;
export default function App() {
  if (import.meta.env.DEV && window.location.pathname === '/dev/ui') return <ToastProvider><Suspense fallback={<Skeleton />}><DevUI /></Suspense></ToastProvider>;
  return <AuthProvider><ActivePatientProvider><ToastProvider><Routes>
    <Route element={<AuthShell />}>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<SignInPage key="login" />} />
      <Route path="/signup" element={<SignInPage key="signup" signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/invitations/:token" element={<InvitationPage />} />
    </Route>
    <Route element={<ProtectedRoute />}><Route element={<AppShell />}>
      <Route path="/medications" element={<MedicationList />} />
      <Route path="/medications/add" element={<MedicationEdit />} />
      <Route path="/medications/:id" element={<MedicationDetail />} />
      <Route path="/medications/:id/edit" element={<MedicationEdit />} />
      <Route path="/doctors" element={<DoctorList />} />
      <Route path="/doctors/add" element={<DoctorEdit />} />
      <Route path="/doctors/:id/edit" element={<DoctorEdit />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/today" element={<AdherencePage view="today" />} />
      <Route path="/dose-history" element={<AdherencePage view="history" />} />
      <Route path="/adherence" element={<AdherencePage view="adherence" />} />
      <Route path="/prescription-scans" element={<UploadPrescription />} />
      <Route path="/prescription-scans/:id" element={<ReviewPrescription />} />
      <Route path="/patients" element={<Dashboard />} />
      <Route path="/patients/:patientId" element={<Dashboard />} />
      <Route path="/relationships" element={<RelationshipsPage />} />
      <Route path="/relationships/invite" element={<InvitePage />} />
      <Route path="/profile" element={<AccountPage page="profile" />} />
      <Route path="/profile/edit" element={<AccountPage page="edit" />} />
      <Route path="/settings" element={<AccountPage page="settings" />} />
      <Route path="/settings/notifications" element={<AccountPage page="preferences" />} />
      <Route path="/dashboard/my-patients" element={<Navigate to="/patients" replace />} />
      <Route path="/dashboard/caregiver" element={<Dashboard />} />
    </Route></Route>
    <Route path="*" element={<Placeholder title="Page not found" />} />
  </Routes></ToastProvider></ActivePatientProvider></AuthProvider>;
}
