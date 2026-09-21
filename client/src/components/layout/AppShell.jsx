import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Menu, Moon, Sun } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import Button from '../Button.jsx';
import Avatar from '../Avatar.jsx';
import Modal from '../Modal.jsx';
import PatientSwitcher from '../PatientSwitcher.jsx';
import { useToast } from '../Toast.jsx';
import s from './AppShell.module.css';
export default function AppShell() {
  const { session, signOut, setTheme } = useAuth();
  const { patients, activePatientId, setActivePatientId, loading, error } = useActivePatient();
  const [menu, setMenu] = useState(false); const [busy, setBusy] = useState(false);
  const notify = useToast(); const navigate = useNavigate(); const { pathname } = useLocation(); const { patientId } = useParams();
  const links = [['/dashboard', 'Dashboard'], ...(patients.length ? [['/patients', 'Patients']] : []), ['/relationships', 'Relationships'], ['/profile', 'Profile']];
  const title = pathname.startsWith('/patients') ? 'Patients' : pathname.startsWith('/relationships') ? 'Relationships' : pathname.startsWith('/settings') ? 'Settings' : pathname.startsWith('/profile') ? 'Profile' : 'Dashboard';
  async function toggleTheme() {
    setBusy(true);
    const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    try { await setTheme(dark ? 'light' : 'dark'); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); }
  }
  async function logout() { setBusy(true); try { await signOut(); navigate('/login'); } catch (err) { notify(err.message, 'error'); } finally { setBusy(false); } }
  const navigation = <nav aria-label="Main navigation" className={s.navigation}>{links.map(([path, label]) => <NavLink key={path} to={path} onClick={() => setMenu(false)}>{label}</NavLink>)}</nav>;
  const user = <div className={s.user}><div className={s.identity}><Avatar {...session.user} /><span>{session.user?.fullName || 'Your account'}</span></div>
    <Button variant="ghost" onClick={toggleTheme} disabled={busy}><Moon size={16} strokeWidth={1.5} aria-hidden="true" /><Sun size={16} strokeWidth={1.5} aria-hidden="true" />Toggle theme</Button>
    <Button variant="ghost" onClick={logout} disabled={busy}>Sign out</Button></div>;
  return <div className={s.shell}><a href="#main-content" className={s.skip}>Skip to content</a><aside className={s.rail}>
    <NavLink to="/dashboard" className={s.wordmark}>MediTrack</NavLink>{navigation}{user}</aside>
    <div className={s.workspace}><header className={s.topbar}><Button className={s.menuButton} variant="ghost" onClick={() => setMenu(true)} aria-label="Open navigation menu"><Menu size={18} strokeWidth={1.5} aria-hidden="true" /></Button>
      <span className={s.mobileTitle}>{title}</span>{patientId && <PatientSwitcher patients={patients} activePatientId={patientId || activePatientId} loading={loading} error={error}
        onChange={(id) => { setActivePatientId(id); navigate(`/patients/${id}`); }} />}</header>
      <main id="main-content" className={s.content} tabIndex={-1}><Outlet /></main></div>
    <nav className={s.bottom} aria-label="Mobile navigation">{links.filter(([path]) => path !== '/patients').map(([path, label]) => <NavLink key={path} to={path}>{label}</NavLink>)}</nav>
    <Modal open={menu} onClose={() => setMenu(false)} title="MediTrack">{navigation}{user}</Modal>
  </div>;
}
