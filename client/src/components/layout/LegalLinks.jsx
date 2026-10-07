import { Link } from 'react-router-dom';
import s from './LegalLinks.module.css';
export default function LegalLinks({ onNavigate }) {
  return <nav className={s.links} aria-label="Help and legal">{[['/faq', 'FAQ'], ['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/medical-disclaimer', 'Medical disclaimer'], ['/support', 'Contact support']].map(([to, label]) => <Link key={to} to={to} onClick={onNavigate}>{label}</Link>)}</nav>;
}
