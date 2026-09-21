import { Link, Outlet } from 'react-router-dom';
import s from './AuthShell.module.css';
export default function AuthShell() {
  return <div className={s.shell}><aside className={s.brand}><Link to="/" className={s.wordmark}>MediTrack</Link>
    <p>Keep track of your medicines and the people you care for.</p><div className={s.motif} aria-hidden="true"><i /><i /><i /><i /></div></aside>
    <main className={s.main}><Link to="/" className={s.mobileWordmark}>MediTrack</Link><div className={s.column}><Outlet /></div></main></div>;
}
