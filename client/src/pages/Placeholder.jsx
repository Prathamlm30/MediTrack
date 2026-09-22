import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
export default function Placeholder() {
  return <main className="not-found"><PageHeader title="Page not found" description="This page does not exist. Return to your dashboard to continue." /><Link to="/dashboard">Go to dashboard</Link></main>;
}
